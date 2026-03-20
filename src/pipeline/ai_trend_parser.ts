// AI Trend Parser — Hacker News, Reddit, arxiv daily trend collection
// Parses open APIs/RSS feeds, filters by configured keywords, generates daily reports.
// Pure function library: no side effects except HTTP fetches.

// === Types ===

export type TrendSource = 'hackernews' | 'reddit' | 'arxiv';

export type TrendItem = {
  source: TrendSource;
  title: string;
  url: string;
  score?: number;
  comments?: number;
  matched_keywords: string[];
  fetched_at: string;
  metadata?: Record<string, unknown>;
};

export type AiTrendConfig = {
  keywords?: string[];
  hn_fetch_limit?: number;
  reddit_subreddits?: string[];
  reddit_post_limit?: number;
  arxiv_max_results?: number;
};

export type AiTrendResult = {
  items: TrendItem[];
  report: string;
  sources_status: Record<TrendSource, 'ok' | 'error'>;
  generated_at: string;
};

// === Constants ===

export const DEFAULT_KEYWORDS = [
  // English keywords
  'edutech',
  'nvc',
  'automation',
  'local llm',
  'solopreneur',
  'one-person startup',
  // Korean keywords
  '에듀테크',
  '1인창업',
  '자동화',
  '로컬llm',
];

const DEFAULT_SUBREDDITS = ['MachineLearning', 'LocalLLaMA'];
const DEFAULT_HN_FETCH_LIMIT = 30;
const DEFAULT_REDDIT_POST_LIMIT = 25;
const DEFAULT_ARXIV_MAX_RESULTS = 20;

const HN_API_BASE = 'https://hacker-news.firebaseio.com/v0';
const REDDIT_BASE = 'https://www.reddit.com';
const ARXIV_API_BASE = 'http://export.arxiv.org/api/query';

// User-Agent for Reddit (Reddit blocks default fetch UA)
const REDDIT_USER_AGENT = 'FAS-Operations/1.0 (AI Trend Research Bot)';

// === Keyword Filter ===

export const create_keyword_filter = () => {
  // Check if text matches any keyword (case-insensitive)
  const matches = (text: string, keywords: string[]): boolean => {
    const lower_text = text.toLowerCase();
    return keywords.some(kw => lower_text.includes(kw.toLowerCase()));
  };

  // Return all matched keywords from the text
  const matched_keywords = (text: string, keywords: string[]): string[] => {
    const lower_text = text.toLowerCase();
    return keywords.filter(kw => lower_text.includes(kw.toLowerCase()));
  };

  return { matches, matched_keywords };
};

// === Hacker News Parser ===

export type HnParserConfig = {
  fetch_limit?: number;
};

export const create_hn_parser = (config: HnParserConfig = {}) => {
  const fetch_limit = config.fetch_limit ?? DEFAULT_HN_FETCH_LIMIT;
  const filter = create_keyword_filter();

  // Throws on top-level network error (orchestrator catches for status tracking).
  // Individual item fetch failures are silently skipped.
  const parse = async (keywords: string[]): Promise<TrendItem[]> => {
    // Fetch top story IDs — let network errors propagate
    const ids_response = await fetch(`${HN_API_BASE}/topstories.json`);
    if (!ids_response.ok) {
      throw new Error(`HN API returned ${ids_response.status}`);
    }

    const all_ids = await ids_response.json() as number[];
    const limited_ids = all_ids.slice(0, fetch_limit);

    // Fetch individual items in parallel
    const item_promises = limited_ids.map(async (id) => {
      try {
        const item_response = await fetch(`${HN_API_BASE}/item/${id}.json`);
        if (!item_response.ok) return null;
        return await item_response.json() as {
          id: number;
          title: string;
          url?: string;
          score: number;
          descendants?: number;
          by: string;
          time: number;
          type: string;
        };
      } catch {
        // Skip individual item fetch failures
        return null;
      }
    });

    const items = await Promise.all(item_promises);
    const fetched_at = new Date().toISOString();

    // Filter by keywords and convert to TrendItem
    return items
      .filter((item): item is NonNullable<typeof item> => {
        if (!item || item.type !== 'story') return false;
        const searchable = `${item.title} ${item.url ?? ''}`;
        return filter.matches(searchable, keywords);
      })
      .map((item) => ({
        source: 'hackernews' as const,
        title: item.title,
        url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
        score: item.score,
        comments: item.descendants ?? 0,
        matched_keywords: filter.matched_keywords(
          `${item.title} ${item.url ?? ''}`,
          keywords,
        ),
        fetched_at,
      }));
  };

  return { parse };
};

// === Reddit Parser ===

export type RedditParserConfig = {
  subreddits?: string[];
  post_limit?: number;
};

export const create_reddit_parser = (config: RedditParserConfig = {}) => {
  const subreddits = config.subreddits ?? DEFAULT_SUBREDDITS;
  const post_limit = config.post_limit ?? DEFAULT_REDDIT_POST_LIMIT;
  const filter = create_keyword_filter();

  // Fetch hot posts from a single subreddit
  const fetch_subreddit = async (
    subreddit: string,
    keywords: string[],
  ): Promise<TrendItem[]> => {
    const url = `${REDDIT_BASE}/r/${subreddit}/hot.json?limit=${post_limit}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': REDDIT_USER_AGENT,
      },
    });

    if (!response.ok) {
      console.warn(`[Reddit Parser] Failed to fetch r/${subreddit}: ${response.status}`);
      return [];
    }

    const data = await response.json() as {
      data: {
        children: Array<{
          data: {
            title: string;
            url: string;
            permalink: string;
            score: number;
            num_comments: number;
            subreddit: string;
            created_utc: number;
          };
        }>;
      };
    };

    const fetched_at = new Date().toISOString();

    return data.data.children
      .filter((child) => {
        const searchable = `${child.data.title} ${child.data.url}`;
        return filter.matches(searchable, keywords);
      })
      .map((child) => ({
        source: 'reddit' as const,
        title: child.data.title,
        url: child.data.url.startsWith('http')
          ? child.data.url
          : `${REDDIT_BASE}${child.data.permalink}`,
        score: child.data.score,
        comments: child.data.num_comments,
        matched_keywords: filter.matched_keywords(
          `${child.data.title} ${child.data.url}`,
          keywords,
        ),
        fetched_at,
        metadata: { subreddit: child.data.subreddit },
      }));
  };

  // Throws when ALL subreddits fail (orchestrator tracks status).
  // Partial failures are handled gracefully — results from working subreddits are returned.
  const parse = async (keywords: string[]): Promise<TrendItem[]> => {
    // Fetch all subreddits in parallel, handle individual failures
    const results = await Promise.allSettled(
      subreddits.map(sub => fetch_subreddit(sub, keywords)),
    );

    const items: TrendItem[] = [];
    let failure_count = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        items.push(...result.value);
      } else {
        failure_count++;
        console.warn(`[Reddit Parser] Subreddit fetch failed: ${result.reason}`);
      }
    }

    // If ALL subreddits failed, throw so orchestrator marks source as error
    if (failure_count === subreddits.length) {
      throw new Error(`All ${failure_count} subreddit(s) failed`);
    }

    return items;
  };

  return { parse };
};

// === arxiv Parser ===

export type ArxivParserConfig = {
  max_results?: number;
};

// Simple XML tag extractor (avoids external XML library dependency)
const extract_tag_content = (xml: string, tag: string): string => {
  // Match tag content, handling potential namespace prefix
  const regex = new RegExp(`<(?:[a-z]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-z]+:)?${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
};

// Extract all occurrences of a tag
const extract_all_tag_contents = (xml: string, tag: string): string[] => {
  const regex = new RegExp(`<(?:[a-z]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-z]+:)?${tag}>`, 'gi');
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    matches.push(match[1].trim());
  }
  return matches;
};

// Extract href from link tag with rel="alternate"
const extract_link_href = (xml: string): string => {
  const regex = /<link[^>]*href="([^"]*)"[^>]*rel="alternate"[^>]*/i;
  const match = xml.match(regex);
  return match ? match[1] : '';
};

export const create_arxiv_parser = (config: ArxivParserConfig = {}) => {
  const max_results = config.max_results ?? DEFAULT_ARXIV_MAX_RESULTS;
  const filter = create_keyword_filter();

  // Throws on network/API errors (orchestrator catches for status tracking).
  const parse = async (keywords: string[]): Promise<TrendItem[]> => {
    // Build search query from English keywords only (arxiv does not support Korean)
    const english_keywords = keywords.filter(kw => /^[a-zA-Z0-9\s-]+$/.test(kw));
    const search_terms = english_keywords
      .map(kw => `all:"${kw}"`)
      .join('+OR+');

    const url = `${ARXIV_API_BASE}?search_query=${search_terms}&sortBy=submittedDate&sortOrder=descending&max_results=${max_results}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`arxiv API returned ${response.status}`);
    }

    const xml = await response.text();
    const fetched_at = new Date().toISOString();

    // Split XML into entry blocks
    const entry_regex = /<entry>([\s\S]*?)<\/entry>/gi;
    const entries: TrendItem[] = [];
    let entry_match: RegExpExecArray | null;

    while ((entry_match = entry_regex.exec(xml)) !== null) {
      const entry_xml = entry_match[1];

      const title = extract_tag_content(entry_xml, 'title').replace(/\s+/g, ' ');
      const summary = extract_tag_content(entry_xml, 'summary').replace(/\s+/g, ' ');
      const link = extract_link_href(entry_xml);
      const published = extract_tag_content(entry_xml, 'published');

      // Extract author names from nested <name> tags within <author> blocks
      const author_blocks = extract_all_tag_contents(entry_xml, 'author');
      const authors = author_blocks.map(block => extract_tag_content(block, 'name'));

      // Filter: check title + summary against keywords
      const searchable = `${title} ${summary}`;
      if (!filter.matches(searchable, keywords)) continue;

      entries.push({
        source: 'arxiv',
        title,
        url: link,
        matched_keywords: filter.matched_keywords(searchable, keywords),
        fetched_at,
        metadata: {
          authors,
          abstract: summary,
          published,
        },
      });
    }

    return entries;
  };

  return { parse };
};

// === Report Generator ===

export const generate_trend_report = (items: TrendItem[]): string => {
  const now = new Date().toISOString().split('T')[0];
  const lines: string[] = [];

  lines.push(`=== AI Trend Daily Report (${now}) ===`);
  lines.push('');

  if (items.length === 0) {
    lines.push('No matching items found for configured keywords.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`Total: ${items.length} items`);
  lines.push('');

  // Group by source
  const by_source = new Map<TrendSource, TrendItem[]>();
  for (const item of items) {
    const existing = by_source.get(item.source) ?? [];
    existing.push(item);
    by_source.set(item.source, existing);
  }

  // Render each source section
  const source_labels: Record<TrendSource, string> = {
    hackernews: 'Hacker News',
    reddit: 'Reddit',
    arxiv: 'arxiv',
  };

  for (const source of ['hackernews', 'reddit', 'arxiv'] as TrendSource[]) {
    const source_items = by_source.get(source);
    if (!source_items || source_items.length === 0) continue;

    lines.push(`--- ${source_labels[source]} (${source_items.length}) ---`);
    lines.push('');

    // Sort by score descending (if available)
    const sorted = [...source_items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    for (const item of sorted) {
      lines.push(`  * ${item.title}`);
      lines.push(`    URL: ${item.url}`);
      if (item.score !== undefined) {
        lines.push(`    Score: ${item.score} | Comments: ${item.comments ?? 0}`);
      }
      if (item.metadata?.authors) {
        const authors = item.metadata.authors as string[];
        lines.push(`    Authors: ${authors.join(', ')}`);
      }
      if (item.metadata?.abstract) {
        const abstract = (item.metadata.abstract as string).slice(0, 200);
        lines.push(`    Abstract: ${abstract}${(item.metadata.abstract as string).length > 200 ? '...' : ''}`);
      }
      lines.push(`    Keywords: [${item.matched_keywords.join(', ')}]`);
      lines.push('');
    }
  }

  return lines.join('\n');
};

// === Main Orchestrator ===

export const run_ai_trend_research = async (
  config: AiTrendConfig = {},
): Promise<AiTrendResult> => {
  const keywords = config.keywords ?? DEFAULT_KEYWORDS;

  const sources_status: Record<TrendSource, 'ok' | 'error'> = {
    hackernews: 'ok',
    reddit: 'ok',
    arxiv: 'ok',
  };

  // Create parsers with config
  const hn_parser = create_hn_parser({
    fetch_limit: config.hn_fetch_limit,
  });
  const reddit_parser = create_reddit_parser({
    subreddits: config.reddit_subreddits,
    post_limit: config.reddit_post_limit,
  });
  const arxiv_parser = create_arxiv_parser({
    max_results: config.arxiv_max_results,
  });

  // Helper: run a parser with error handling and status tracking
  const safe_parse = async (
    source: TrendSource,
    parser: { parse: (kw: string[]) => Promise<TrendItem[]> },
  ): Promise<TrendItem[]> => {
    try {
      return await parser.parse(keywords);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[AI Trend] ${source} parser error: ${msg}`);
      sources_status[source] = 'error';
      return [];
    }
  };

  // Run parsers sequentially (HN -> Reddit -> arxiv) for deterministic fetch ordering.
  // Total API calls are few (3-5), so sequential overhead is negligible.
  const hn_items = await safe_parse('hackernews', hn_parser);
  const reddit_items = await safe_parse('reddit', reddit_parser);
  const arxiv_items = await safe_parse('arxiv', arxiv_parser);

  const all_items = [...hn_items, ...reddit_items, ...arxiv_items];
  const report = generate_trend_report(all_items);

  return {
    items: all_items,
    report,
    sources_status,
    generated_at: new Date().toISOString(),
  };
};
