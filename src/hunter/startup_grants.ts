// K-Startup grant crawler: parse announcements, detect new grants,
// match qualifications, calculate deadline alerts, generate reports.
// All functions are pure except detect_new_grants which reads/writes seen_grants.json.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// === Types ===

export type GrantAnnouncement = {
  id: string;
  title: string;
  organization: string;
  deadline: string | null;
  description: string;
  url: string;
  category: string;
  discovered_at: string;
};

export type UserProfile = {
  age: number;
  is_startup_founder: boolean;
  tech_stack: string[];
  education: string;
  years_experience: number;
};

export type GrantMatchResult = {
  grant: GrantAnnouncement;
  priority: 'high' | 'medium' | 'low' | 'skip';
  match_reasons: string[];
  disqualify_reasons: string[];
};

export type DeadlineAlert = {
  grant: GrantAnnouncement;
  days_remaining: number;
  alert_level: 'D-7' | 'D-3' | 'D-1' | 'overdue';
};

export type GrantReport = {
  generated_at: string;
  total_grants: number;
  new_grants: number;
  matches: GrantMatchResult[];
  deadline_alerts: DeadlineAlert[];
  summary: string;
};

// === Default Profile ===

export const DEFAULT_PROFILE: UserProfile = {
  age: 34,
  is_startup_founder: true,
  tech_stack: ['typescript', 'react', 'nodejs', 'python'],
  education: 'masters_physics',
  years_experience: 6,
};

// === Configurable selectors for K-Startup HTML parsing ===
// K-Startup uses table-based listing; columns vary by page version.

export type KStartupSelectors = {
  row: string;
  title: string;
  organization: string;
  period: string;
  link: string;
  category: string;
};

export const DEFAULT_SELECTORS: KStartupSelectors = {
  row: 'table tbody tr',
  title: 'td.title a, td:nth-child(2) a, td:nth-child(2)',
  organization: 'td.org, td:nth-child(3)',
  period: 'td.period, td:nth-child(4)',
  link: 'td.title a, td:nth-child(2) a',
  category: 'td.category, td:nth-child(1)',
};

// === K-Startup URL patterns ===

const KSTARTUP_PATTERNS = [
  /k-startup\.go\.kr/i,
  /kstartup\.go\.kr/i,
  /k-startup\.or\.kr/i,
];

// Check if a URL matches k-startup.go.kr patterns
export const is_kstartup_url = (url: string): boolean => {
  return KSTARTUP_PATTERNS.some((pattern) => pattern.test(url));
};

// === HTML Parsing ===

// Minimal HTML tag stripper — extracts text content from an HTML string.
// Handles <br>, <br/> as newlines and strips all other tags.
const strip_html = (html: string): string => {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
};

// Extract a deadline date string from a period text like "2026.03.01 ~ 2026.04.15"
// Returns the end date in ISO format, or null if unparseable.
const extract_deadline = (period_text: string): string | null => {
  // Match patterns: YYYY.MM.DD, YYYY-MM-DD, YYYY/MM/DD
  const date_matches = period_text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/g);
  if (!date_matches || date_matches.length === 0) return null;

  // Take the last date as deadline (end of period)
  const last_date = date_matches[date_matches.length - 1];
  const parts = last_date.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!parts) return null;

  const [, year, month, day] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

// Parse K-Startup HTML page into structured grant announcements.
// Uses a simple regex-based approach since we don't have a DOM parser in Node.
// The HTML structure is table-based: <table><tbody><tr>... columns ...</tr></tbody></table>
export const parse_grant_announcements = (
  html: string,
  _selectors: KStartupSelectors = DEFAULT_SELECTORS,
): GrantAnnouncement[] => {
  const grants: GrantAnnouncement[] = [];
  const now = new Date().toISOString();

  // Extract table rows using regex — matches <tr>...</tr> blocks
  // Supports both tbody rows and direct table rows
  const row_regex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row_match: RegExpExecArray | null;

  while ((row_match = row_regex.exec(html)) !== null) {
    const row_html = row_match[1];

    // Extract all <td> cells from the row
    const cell_regex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let cell_match: RegExpExecArray | null;

    while ((cell_match = cell_regex.exec(row_html)) !== null) {
      cells.push(cell_match[1]);
    }

    // Need at least 3 columns (category/num, title, organization)
    if (cells.length < 3) continue;

    // Skip header-like rows (contain <th> or all cells are short/numeric headers)
    const first_cell_text = strip_html(cells[0]);
    if (first_cell_text.toLowerCase() === 'no' || first_cell_text === '번호') continue;

    // Extract link from the title cell (usually cell index 1 or 2)
    const title_cell = cells.length > 2 ? cells[1] : cells[0];
    const link_match = title_cell.match(/href=["']([^"']+)["']/i);
    const title_text = strip_html(title_cell);

    // Skip rows with empty title
    if (!title_text) continue;

    // Build full URL from relative link
    let url = '';
    if (link_match) {
      const href = link_match[1];
      url = href.startsWith('http')
        ? href
        : `https://www.k-startup.go.kr${href.startsWith('/') ? '' : '/'}${href}`;
    }

    // Extract grant ID from URL or generate from title hash
    const id_from_url = url.match(/[?&](?:no|idx|seq|id)=(\d+)/i);
    const id = id_from_url
      ? `kstartup-${id_from_url[1]}`
      : `kstartup-${simple_hash(title_text)}`;

    const organization = cells.length > 2 ? strip_html(cells[2]) : '';
    const period_text = cells.length > 3 ? strip_html(cells[3]) : '';
    const category = strip_html(cells[0]);
    const deadline = extract_deadline(period_text);

    grants.push({
      id,
      title: title_text,
      organization,
      deadline,
      description: period_text, // period text serves as brief description
      url,
      category,
      discovered_at: now,
    });
  }

  return grants;
};

// Simple string hash for generating IDs from titles
const simple_hash = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36);
};

// === New Grant Detection ===

// Compare current grants against a seen_grants.json file.
// Returns only the grants not previously seen. Updates the file with all current IDs.
export const detect_new_grants = (
  current: GrantAnnouncement[],
  seen_path: string,
): GrantAnnouncement[] => {
  let seen_ids: string[] = [];

  if (existsSync(seen_path)) {
    try {
      const raw = readFileSync(seen_path, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      seen_ids = Array.isArray(parsed) ? parsed as string[] : [];
    } catch {
      // Corrupted file — treat as empty
      seen_ids = [];
    }
  }

  const seen_set = new Set(seen_ids);
  const new_grants = current.filter((g) => !seen_set.has(g.id));

  // Update seen file with all current IDs (union of old + new)
  const all_ids = [...new Set([...seen_ids, ...current.map((g) => g.id)])];
  writeFileSync(seen_path, JSON.stringify(all_ids, null, 2), 'utf-8');

  return new_grants;
};

// === Grant Matching ===

// Keywords that indicate high relevance for a tech startup founder
const HIGH_PRIORITY_KEYWORDS = [
  '창업', '예비창업', '초기창업', '스타트업', 'startup',
  'ai', 'it', 'ict', '소프트웨어', 'sw', '기술', 'tech',
  '1인', '소셜벤처', '소셜',
];

const MEDIUM_PRIORITY_KEYWORDS = [
  '지원', '사업화', '멘토', '액셀러레이터', '투자', '펀드',
  '교육', '연수', '성장', '혁신',
];

// Keywords that suggest disqualification
const DISQUALIFY_KEYWORDS = [
  '농업', '농촌', '수산', '축산', '임업',
  '60대', '시니어', '은퇴',
  '여성 전용', '여성전용',
  '제조업', '제조 전용',
];

// Age restrictions sometimes appear in grant titles/descriptions
const AGE_RESTRICTION_PATTERN = /(\d{1,2})세\s*[~\-]\s*(\d{1,2})세/;

// Match a grant against a user profile and return priority + reasons
export const match_grant_to_profile = (
  grant: GrantAnnouncement,
  profile: UserProfile,
): GrantMatchResult => {
  const text = `${grant.title} ${grant.description} ${grant.category}`.toLowerCase();
  const match_reasons: string[] = [];
  const disqualify_reasons: string[] = [];

  // Check disqualification keywords
  for (const keyword of DISQUALIFY_KEYWORDS) {
    if (text.includes(keyword.toLowerCase())) {
      disqualify_reasons.push(`Contains disqualifying keyword: ${keyword}`);
    }
  }

  // Check age restriction
  const age_match = text.match(AGE_RESTRICTION_PATTERN);
  if (age_match) {
    const min_age = parseInt(age_match[1], 10);
    const max_age = parseInt(age_match[2], 10);
    if (profile.age < min_age || profile.age > max_age) {
      disqualify_reasons.push(`Age restriction ${min_age}-${max_age}, user is ${profile.age}`);
    } else {
      match_reasons.push(`Age ${profile.age} within range ${min_age}-${max_age}`);
    }
  }

  // If disqualified, return skip immediately
  if (disqualify_reasons.length > 0) {
    return { grant, priority: 'skip', match_reasons, disqualify_reasons };
  }

  // Check high-priority keywords
  let high_count = 0;
  for (const keyword of HIGH_PRIORITY_KEYWORDS) {
    if (text.includes(keyword.toLowerCase())) {
      match_reasons.push(`Matches high-priority keyword: ${keyword}`);
      high_count++;
    }
  }

  // Check medium-priority keywords
  let medium_count = 0;
  for (const keyword of MEDIUM_PRIORITY_KEYWORDS) {
    if (text.includes(keyword.toLowerCase())) {
      match_reasons.push(`Matches keyword: ${keyword}`);
      medium_count++;
    }
  }

  // Bonus: startup founder matching
  if (profile.is_startup_founder && (text.includes('창업') || text.includes('startup'))) {
    match_reasons.push('User is a startup founder');
    high_count++;
  }

  // Bonus: tech stack overlap
  for (const tech of profile.tech_stack) {
    if (text.includes(tech.toLowerCase())) {
      match_reasons.push(`Tech stack match: ${tech}`);
      high_count++;
    }
  }

  // Bonus: education
  if (profile.education.includes('masters') && (text.includes('석사') || text.includes('대학원'))) {
    match_reasons.push('Masters degree relevant');
    medium_count++;
  }

  // Determine priority
  let priority: 'high' | 'medium' | 'low';
  if (high_count >= 2) {
    priority = 'high';
  } else if (high_count >= 1 || medium_count >= 2) {
    priority = 'medium';
  } else {
    priority = 'low';
  }

  return { grant, priority, match_reasons, disqualify_reasons };
};

// === Deadline Alerts ===

// Calculate days remaining and assign alert levels for grants with deadlines
export const calculate_deadline_alerts = (
  grants: GrantAnnouncement[],
  now: Date,
): DeadlineAlert[] => {
  const alerts: DeadlineAlert[] = [];

  for (const grant of grants) {
    if (!grant.deadline) continue;

    const deadline_date = new Date(grant.deadline + 'T23:59:59');
    const diff_ms = deadline_date.getTime() - now.getTime();
    const days_remaining = Math.ceil(diff_ms / (1000 * 60 * 60 * 24));

    let alert_level: DeadlineAlert['alert_level'];
    if (days_remaining < 0) {
      alert_level = 'overdue';
    } else if (days_remaining <= 1) {
      alert_level = 'D-1';
    } else if (days_remaining <= 3) {
      alert_level = 'D-3';
    } else if (days_remaining <= 7) {
      alert_level = 'D-7';
    } else {
      // Not alertable yet
      continue;
    }

    alerts.push({ grant, days_remaining, alert_level });
  }

  // Sort by urgency (most urgent first)
  alerts.sort((a, b) => a.days_remaining - b.days_remaining);

  return alerts;
};

// === Report Generation ===

// Generate a structured report from match results
export const generate_grant_report = (
  matches: GrantMatchResult[],
  deadline_alerts: DeadlineAlert[] = [],
): GrantReport => {
  const high = matches.filter((m) => m.priority === 'high');
  const medium = matches.filter((m) => m.priority === 'medium');
  const low = matches.filter((m) => m.priority === 'low');
  const skip = matches.filter((m) => m.priority === 'skip');

  const new_grants = matches.filter(
    (m) => m.priority !== 'skip',
  ).length;

  const urgent_alerts = deadline_alerts.filter(
    (a) => a.alert_level === 'D-1' || a.alert_level === 'overdue',
  );

  // Build summary
  const parts: string[] = [];
  parts.push(`Total: ${matches.length} grants`);
  if (high.length > 0) parts.push(`High priority: ${high.length}`);
  if (medium.length > 0) parts.push(`Medium: ${medium.length}`);
  if (low.length > 0) parts.push(`Low: ${low.length}`);
  if (skip.length > 0) parts.push(`Skipped: ${skip.length}`);
  if (urgent_alerts.length > 0) {
    parts.push(`URGENT deadlines: ${urgent_alerts.length}`);
  }

  const summary = parts.join(' | ');

  return {
    generated_at: new Date().toISOString(),
    total_grants: matches.length,
    new_grants,
    matches,
    deadline_alerts,
    summary,
  };
};
