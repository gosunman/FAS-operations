// Housing lottery (청약홈) monitoring parser: parse announcements from applyhome.co.kr,
// detect new listings, match against user housing profile, generate reports.
// All functions are pure except detect_new_housing which reads/writes seen_housing.json.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// === Types ===

export type HousingAnnouncement = {
  id: string;
  title: string;
  location: string;
  size_sqm: number;
  price_estimate?: string;
  announcement_type: 'national' | 'regional' | 'special';
  deadline: string | null;
  url: string;
  discovered_at: string;
};

export type HousingProfile = {
  age: number;
  is_homeless: boolean; // 무주택자 여부
  max_commute_minutes: number;
  min_size_sqm: number;
};

export type HousingMatchResult = {
  announcement: HousingAnnouncement;
  priority: 'investment' | 'residence' | 'skip';
  match_reasons: string[];
  disqualify_reasons: string[];
};

export type HousingReport = {
  generated_at: string;
  total_announcements: number;
  new_announcements: number;
  matches: HousingMatchResult[];
  deadline_alerts: { announcement: HousingAnnouncement; days_remaining: number; alert_level: string }[];
  summary: string;
};

// === Default Profile ===
// 주인님 기본 프로필: 34세, 무주택, 강남 1시간 이내, 50㎡ 이상

export const DEFAULT_HOUSING_PROFILE: HousingProfile = {
  age: 34,
  is_homeless: true,
  max_commute_minutes: 60,
  min_size_sqm: 50,
};

// === Commute time mapping (approximate minutes from 강남) ===

export const COMMUTE_FROM_GANGNAM: Record<string, number> = {
  '강남': 0, '서초': 10, '송파': 15, '강동': 25, '용산': 20,
  '성동': 25, '광진': 20, '마포': 30, '영등포': 25, '동작': 15,
  '관악': 25, '강서': 40, '양천': 35, '구로': 35, '금천': 30,
  '중구': 25, '종로': 30, '성북': 35, '노원': 50, '도봉': 55,
  '은평': 45, '서대문': 35, '동대문': 30, '중랑': 40,
  '하남': 30, '성남': 20, '분당': 25, '판교': 30, '과천': 20,
  '광명': 35, '안양': 40, '수원': 55, '용인': 45,
};

// === 청약홈 URL patterns ===

const HOUSING_URL_PATTERNS = [
  /applyhome\.co\.kr/i,
];

// Check if a URL matches applyhome.co.kr pattern
export const is_housing_url = (url: string): boolean => {
  return HOUSING_URL_PATTERNS.some((pattern) => pattern.test(url));
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
  const date_matches = period_text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/g);
  if (!date_matches || date_matches.length === 0) return null;

  // Take the last date as deadline (end of period)
  const last_date = date_matches[date_matches.length - 1];
  const parts = last_date.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!parts) return null;

  const [, year, month, day] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

// Extract size in ㎡ from a cell text like "59㎡" or "59.9 ㎡" or "59"
const extract_size_sqm = (text: string): number => {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:㎡|m²|평)?/);
  if (!match) return 0;
  return Math.round(parseFloat(match[1]));
};

// Detect announcement type from title keywords
const detect_announcement_type = (title: string): HousingAnnouncement['announcement_type'] => {
  const text = title.toLowerCase();
  // 특별공급 keywords
  if (text.includes('특별공급') || text.includes('신혼') || text.includes('다자녀') || text.includes('생애최초')) {
    return 'special';
  }
  // 국민임대, 행복주택, 공공임대 등 national housing
  if (text.includes('국민임대') || text.includes('행복주택') || text.includes('공공임대') || text.includes('영구임대') || text.includes('장기전세')) {
    return 'national';
  }
  // Everything else = regional / general supply
  return 'regional';
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

// Parse 청약홈 HTML page into structured housing announcements.
// Uses a simple regex-based approach since we don't have a DOM parser in Node.
// The HTML structure is table-based: <table><tbody><tr>... columns ...</tr></tbody></table>
export const parse_housing_announcements = (
  html: string,
): HousingAnnouncement[] => {
  const announcements: HousingAnnouncement[] = [];
  const now = new Date().toISOString();

  // Extract table rows using regex — matches <tr>...</tr> blocks
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

    // Need at least 5 columns (번호, 공고명, 지역, 규모, 기간)
    if (cells.length < 5) continue;

    // Skip header-like rows
    const first_cell_text = strip_html(cells[0]);
    if (first_cell_text.toLowerCase() === 'no' || first_cell_text === '번호') continue;

    // Extract link and title from the title cell (index 1)
    const title_cell = cells[1];
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
        : `https://www.applyhome.co.kr${href.startsWith('/') ? '' : '/'}${href}`;
    }

    // Extract housing ID from houseManageNo parameter or generate from title hash
    const id_from_url = url.match(/houseManageNo=(\d+)/i);
    const id = id_from_url
      ? `housing-${id_from_url[1]}`
      : `housing-${simple_hash(title_text)}`;

    const location = strip_html(cells[2]);
    const size_sqm = extract_size_sqm(strip_html(cells[3]));
    const period_text = strip_html(cells[4]);
    const deadline = extract_deadline(period_text);
    const announcement_type = detect_announcement_type(title_text);

    announcements.push({
      id,
      title: title_text,
      location,
      size_sqm,
      announcement_type,
      deadline,
      url,
      discovered_at: now,
    });
  }

  return announcements;
};

// === New Housing Detection ===

// Compare current announcements against a seen_housing.json file.
// Returns only the announcements not previously seen. Updates the file with all current IDs.
export const detect_new_housing = (
  current: HousingAnnouncement[],
  seen_path: string,
): HousingAnnouncement[] => {
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
  const new_announcements = current.filter((a) => !seen_set.has(a.id));

  // Update seen file with all current IDs (union of old + new)
  const all_ids = [...new Set([...seen_ids, ...current.map((a) => a.id)])];
  writeFileSync(seen_path, JSON.stringify(all_ids, null, 2), 'utf-8');

  return new_announcements;
};

// === Housing Matching ===

// Extract a district/city name from a full location string.
// Examples: "서울특별시 강남구" -> "강남", "경기도 수원시" -> "수원", "서울특별시 송파구" -> "송파"
const extract_district = (location: string): string | null => {
  // Try to match district names from the commute map
  for (const key of Object.keys(COMMUTE_FROM_GANGNAM)) {
    if (location.includes(key)) {
      return key;
    }
  }
  return null;
};

// Estimate commute time from 강남 based on location string
const estimate_commute = (location: string): number | null => {
  const district = extract_district(location);
  if (district && district in COMMUTE_FROM_GANGNAM) {
    return COMMUTE_FROM_GANGNAM[district];
  }
  return null; // Unknown location
};

// Match a housing announcement against a user profile and return priority + reasons.
// Priority logic:
//   - residence: commute <= max AND size >= min AND is_homeless
//   - investment: size is OK but commute too long, or unknown location
//   - skip: too small for residence, or non-homeless for public housing
export const match_housing_to_profile = (
  announcement: HousingAnnouncement,
  profile: HousingProfile,
): HousingMatchResult => {
  const match_reasons: string[] = [];
  const disqualify_reasons: string[] = [];

  // Check homeless status — most public housing requires 무주택
  if (profile.is_homeless) {
    match_reasons.push('무주택자 자격 충족');
  } else {
    disqualify_reasons.push('무주택자가 아님 — 대부분의 공공주택 자격 미달');
  }

  // Estimate commute time
  const commute = estimate_commute(announcement.location);
  const is_commutable = commute !== null && commute <= profile.max_commute_minutes;
  const is_large_enough = announcement.size_sqm >= profile.min_size_sqm;

  if (commute !== null) {
    match_reasons.push(`commute: ${commute}min from 강남 (max: ${profile.max_commute_minutes}min)`);
  }

  if (is_large_enough) {
    match_reasons.push(`size: ${announcement.size_sqm}㎡ >= ${profile.min_size_sqm}㎡ minimum`);
  }

  // If disqualified (non-homeless), always skip
  if (disqualify_reasons.length > 0) {
    return { announcement, priority: 'skip', match_reasons, disqualify_reasons };
  }

  // Decision tree:
  // 1. Commutable + large enough = residence
  // 2. Commutable + too small = investment (nearby small unit can be rented out)
  // 3. Not commutable / unknown + any size = investment (수익형)
  // 4. Unknown location + too small = skip

  if (is_commutable && is_large_enough) {
    // Perfect match for residence
    return { announcement, priority: 'residence', match_reasons, disqualify_reasons };
  }

  if (is_commutable && !is_large_enough) {
    // Nearby but too small for living — still worth as investment
    match_reasons.push(`investment opportunity: nearby but ${announcement.size_sqm}㎡ < ${profile.min_size_sqm}㎡ min`);
    return { announcement, priority: 'investment', match_reasons, disqualify_reasons };
  }

  if (commute !== null && !is_commutable && is_large_enough) {
    // Too far for commute but decent size — investment
    match_reasons.push(`investment opportunity: ${commute}min commute exceeds ${profile.max_commute_minutes}min max`);
    return { announcement, priority: 'investment', match_reasons, disqualify_reasons };
  }

  if (commute !== null && !is_commutable && !is_large_enough) {
    // Too far + too small = skip
    disqualify_reasons.push(`Too far (${commute}min) and too small (${announcement.size_sqm}㎡)`);
    return { announcement, priority: 'skip', match_reasons, disqualify_reasons };
  }

  // Unknown location — can't determine commute
  if (is_large_enough) {
    match_reasons.push('investment opportunity: unknown location, adequate size');
    return { announcement, priority: 'investment', match_reasons, disqualify_reasons };
  }

  // Unknown location + too small
  disqualify_reasons.push(`Unknown location and too small (${announcement.size_sqm}㎡)`);
  return { announcement, priority: 'skip', match_reasons, disqualify_reasons };
};

// === Deadline Alerts ===

// Calculate days remaining and assign alert levels for announcements with deadlines
const calculate_deadline_alerts = (
  announcements: HousingAnnouncement[],
  now: Date,
): HousingReport['deadline_alerts'] => {
  const alerts: HousingReport['deadline_alerts'] = [];

  for (const announcement of announcements) {
    if (!announcement.deadline) continue;

    const deadline_date = new Date(announcement.deadline + 'T23:59:59');
    const diff_ms = deadline_date.getTime() - now.getTime();
    const days_remaining = Math.ceil(diff_ms / (1000 * 60 * 60 * 24));

    let alert_level: string;
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

    alerts.push({ announcement, days_remaining, alert_level });
  }

  // Sort by urgency (most urgent first)
  alerts.sort((a, b) => a.days_remaining - b.days_remaining);

  return alerts;
};

// === Report Generation ===

// Generate a structured report from match results.
// Optionally accepts a `now` date for deadline alert calculation (defaults to current time).
export const generate_housing_report = (
  matches: HousingMatchResult[],
  now: Date = new Date(),
): HousingReport => {
  const residence = matches.filter((m) => m.priority === 'residence');
  const investment = matches.filter((m) => m.priority === 'investment');
  const skip = matches.filter((m) => m.priority === 'skip');

  const new_announcements = matches.filter((m) => m.priority !== 'skip').length;

  // Calculate deadline alerts only for non-skip matches
  const non_skip_announcements = matches
    .filter((m) => m.priority !== 'skip')
    .map((m) => m.announcement);
  const deadline_alerts = calculate_deadline_alerts(non_skip_announcements, now);

  const urgent_alerts = deadline_alerts.filter(
    (a) => a.alert_level === 'D-1' || a.alert_level === 'overdue',
  );

  // Build summary
  const parts: string[] = [];
  parts.push(`Total: ${matches.length} announcements`);
  if (residence.length > 0) parts.push(`Residence: ${residence.length}`);
  if (investment.length > 0) parts.push(`Investment: ${investment.length}`);
  if (skip.length > 0) parts.push(`Skipped: ${skip.length}`);
  if (urgent_alerts.length > 0) {
    parts.push(`URGENT deadlines: ${urgent_alerts.length}`);
  }

  const summary = parts.join(' | ');

  return {
    generated_at: new Date().toISOString(),
    total_announcements: matches.length,
    new_announcements,
    matches,
    deadline_alerts,
    summary,
  };
};
