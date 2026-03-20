// Blind Monitor Pipeline — Parse hunter chatgpt_task results for Naver-related Blind posts
// This module is a PURE result processor: no HTTP requests, no scraping.
// Input: raw text output from hunter's chatgpt_task
// Output: filtered, scored, and formatted alerts for Slack notification

// ============================================================
// Types
// ============================================================

export type BlindPost = {
  title: string;
  url?: string;
  comment_count: number;
  like_count: number;
  summary: string;
  keywords_matched: string[];
  category: 'hot' | 'trending' | 'normal';
};

export type BlindMonitorConfig = {
  hot_comment_threshold?: number;      // Default: 50
  hot_like_threshold?: number;         // Default: 100
  trending_comment_threshold?: number; // Default: 30
  trending_like_threshold?: number;    // Default: 50
  keywords?: string[];                 // Additional keywords beyond defaults
};

export type BlindMonitorResult = {
  alerts: FormattedAlert[];
  stats: { total: number; hot: number; trending: number; filtered_out: number };
};

export type FormattedAlert = {
  text: string;       // Slack-formatted message
  severity: 'high' | 'medium' | 'low';
  post: BlindPost;
};

// ============================================================
// Constants
// ============================================================

// Default popularity thresholds
export const DEFAULT_BLIND_MONITOR_CONFIG: Required<Omit<BlindMonitorConfig, 'keywords'>> & { keywords: string[] } = {
  hot_comment_threshold: 50,
  hot_like_threshold: 100,
  trending_comment_threshold: 30,
  trending_like_threshold: 50,
  keywords: [],
};

// Naver-specific keywords that indicate important/provocative content
const NAVER_KEYWORDS = [
  '구조조정', '퇴사', '연봉', '인사평가', '복지', '조직문화', '레이오프', '대량해고',
] as const;

// General corporate keywords
const GENERAL_KEYWORDS = [
  '폭로', '내부고발', '실적', '주가',
] as const;

// Combined default keyword list
const DEFAULT_KEYWORDS: readonly string[] = [...NAVER_KEYWORDS, ...GENERAL_KEYWORDS];

// Maximum summary length in alert messages
const MAX_SUMMARY_LENGTH = 150;

// ============================================================
// HTML / text normalization helpers
// ============================================================

// Strip HTML tags from a string
const strip_html_tags = (text: string): string =>
  text.replace(/<[^>]*>/g, '');

// Decode common HTML entities
const decode_html_entities = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

// Normalize a text field: strip HTML, decode entities, trim whitespace
const normalize_text = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return decode_html_entities(strip_html_tags(value)).trim();
};

// Coerce a value to a non-negative integer, defaulting to 0
const to_safe_number = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
};

// ============================================================
// JSON extraction helper
// ============================================================

// Extract JSON array from raw text that may contain markdown code fences or prose
const extract_json_array = (raw: string): unknown[] | null => {
  // Strategy 1: Try direct JSON.parse (most common case)
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    // If it's a single object, wrap in array
    if (parsed && typeof parsed === 'object') return [parsed];
  } catch {
    // Not direct JSON, try extraction strategies
  }

  // Strategy 2: Extract from markdown code fences (```json ... ``` or ``` ... ```)
  const fence_match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fence_match) {
    try {
      const parsed = JSON.parse(fence_match[1].trim());
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') return [parsed];
    } catch {
      // Code fence content wasn't valid JSON
    }
  }

  // Strategy 3: Find the first [ ... ] block in the text
  const bracket_match = raw.match(/\[[\s\S]*\]/);
  if (bracket_match) {
    try {
      const parsed = JSON.parse(bracket_match[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Bracket content wasn't valid JSON
    }
  }

  return null;
};

// ============================================================
// Core functions
// ============================================================

// Parse raw hunter output into normalized BlindPost-like objects (without category/keywords yet)
type RawParsedPost = {
  title: string;
  url?: string;
  comment_count: number;
  like_count: number;
  summary: string;
};

export const parse_blind_results = (raw_output: string): RawParsedPost[] => {
  // Guard against null/undefined/empty input
  if (!raw_output || typeof raw_output !== 'string') return [];

  const trimmed = raw_output.trim();
  if (!trimmed) return [];

  const raw_array = extract_json_array(trimmed);
  if (!raw_array) return [];

  return raw_array
    .map((item): RawParsedPost | null => {
      if (!item || typeof item !== 'object') return null;

      const obj = item as Record<string, unknown>;
      const title = normalize_text(obj.title);

      // Filter out posts with empty titles
      if (!title) return null;

      const url_raw = typeof obj.url === 'string' ? obj.url.trim() : undefined;

      return {
        title,
        url: url_raw || undefined,
        comment_count: to_safe_number(obj.comment_count),
        like_count: to_safe_number(obj.like_count),
        summary: normalize_text(obj.summary),
      };
    })
    .filter((post): post is RawParsedPost => post !== null);
};

// Categorize a post based on popularity thresholds
export const categorize_post = (
  post: Pick<RawParsedPost, 'comment_count' | 'like_count'>,
  config: BlindMonitorConfig,
): 'hot' | 'trending' | 'normal' => {
  const hot_comments = config.hot_comment_threshold ?? DEFAULT_BLIND_MONITOR_CONFIG.hot_comment_threshold;
  const hot_likes = config.hot_like_threshold ?? DEFAULT_BLIND_MONITOR_CONFIG.hot_like_threshold;
  const trending_comments = config.trending_comment_threshold ?? DEFAULT_BLIND_MONITOR_CONFIG.trending_comment_threshold;
  const trending_likes = config.trending_like_threshold ?? DEFAULT_BLIND_MONITOR_CONFIG.trending_like_threshold;

  // Hot: comments >= threshold OR likes >= threshold
  if (post.comment_count >= hot_comments || post.like_count >= hot_likes) {
    return 'hot';
  }

  // Trending: comments >= threshold AND likes >= threshold
  if (post.comment_count >= trending_comments && post.like_count >= trending_likes) {
    return 'trending';
  }

  return 'normal';
};

// Detect keywords in post title and summary
export const detect_keywords = (
  title: string,
  summary: string,
  additional_keywords: string[] = [],
): string[] => {
  const all_keywords = [...DEFAULT_KEYWORDS, ...additional_keywords];
  const combined_text = `${title} ${summary}`;

  // Find all matching keywords, deduplicated
  const matched = new Set<string>();
  for (const keyword of all_keywords) {
    if (combined_text.includes(keyword)) {
      matched.add(keyword);
    }
  }

  return [...matched];
};

// Format a single post into a Slack-friendly alert message
export const format_alert = (post: BlindPost): FormattedAlert => {
  const severity: FormattedAlert['severity'] =
    post.category === 'hot' ? 'high' : post.category === 'trending' ? 'medium' : 'low';

  const category_emoji = post.category === 'hot' ? '🔥' : '📈';
  const category_label = post.category === 'hot' ? 'HOT' : 'TRENDING';

  // Build the message lines
  const lines: string[] = [];

  // Header line
  lines.push(`${category_emoji} *[${category_label}]* ${post.title}`);

  // Stats line
  lines.push(`💬 ${post.comment_count} comments | 👍 ${post.like_count} likes`);

  // Summary line (truncated if too long)
  if (post.summary) {
    const truncated_summary = post.summary.length > MAX_SUMMARY_LENGTH
      ? `${post.summary.slice(0, MAX_SUMMARY_LENGTH)}...`
      : post.summary;
    lines.push(`> ${truncated_summary}`);
  }

  // URL line (only if present)
  if (post.url) {
    lines.push(`🔗 ${post.url}`);
  }

  // Keyword tags (only if any matched)
  if (post.keywords_matched.length > 0) {
    const tags = post.keywords_matched.map((k) => `#${k}`).join(' ');
    lines.push(`🏷️ ${tags}`);
  }

  return {
    text: lines.join('\n'),
    severity,
    post,
  };
};

// ============================================================
// Main pipeline function
// ============================================================

// Process raw hunter output through the full pipeline: parse → categorize → detect keywords → format
export const process_blind_results = (
  raw_output: string,
  config: BlindMonitorConfig = {},
): BlindMonitorResult => {
  // Step 1: Parse raw output into structured posts
  const parsed_posts = parse_blind_results(raw_output);

  // Step 2: Categorize, detect keywords, and build full BlindPost objects
  const full_posts: BlindPost[] = parsed_posts.map((post) => ({
    ...post,
    category: categorize_post(post, config),
    keywords_matched: detect_keywords(post.title, post.summary, config.keywords),
  }));

  // Step 3: Separate hot/trending from normal
  const hot_posts = full_posts.filter((p) => p.category === 'hot');
  const trending_posts = full_posts.filter((p) => p.category === 'trending');
  const filtered_out = full_posts.filter((p) => p.category === 'normal').length;

  // Step 4: Format alerts for hot and trending posts
  const alerts: FormattedAlert[] = [
    ...hot_posts.map(format_alert),
    ...trending_posts.map(format_alert),
  ];

  // Step 5: Sort by severity (high first)
  const severity_order = { high: 0, medium: 1, low: 2 } as const;
  alerts.sort((a, b) => severity_order[a.severity] - severity_order[b.severity]);

  return {
    alerts,
    stats: {
      total: full_posts.length,
      hot: hot_posts.length,
      trending: trending_posts.length,
      filtered_out,
    },
  };
};
