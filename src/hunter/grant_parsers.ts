// Grant parsers for SBA (Seoul Business Agency), D.CAMP, and MSS (Ministry of SMEs)
// Each parser extracts GrantAnnouncement[] from the respective site's HTML structure.
// Uses shared helpers from startup_grants.ts for consistency.

import type { GrantAnnouncement } from './startup_grants.js';
import { strip_html, extract_deadline, simple_hash } from './startup_grants.js';

// === URL matchers ===

const SBA_PATTERNS = [
  /sba\.seoul\.kr/i,
  /sba\.kr/i,
];

const DCAMP_PATTERNS = [
  /dcamp\.kr/i,
  /d-camp\.kr/i,
];

const MSS_PATTERNS = [
  /mss\.go\.kr/i,
];

// Check if a URL matches SBA (Seoul Business Agency)
export const is_sba_url = (url: string): boolean =>
  SBA_PATTERNS.some((p) => p.test(url));

// Check if a URL matches D.CAMP (D.CAMP Foundation)
export const is_dcamp_url = (url: string): boolean =>
  DCAMP_PATTERNS.some((p) => p.test(url));

// Check if a URL matches MSS (Ministry of SMEs and Startups)
export const is_mss_url = (url: string): boolean =>
  MSS_PATTERNS.some((p) => p.test(url));

// === SBA Parser ===
// SBA uses table-based listing similar to K-Startup.
// Columns: No, Category, Title (with link), Organization, Period, Status

export const parse_sba_grants = (html: string): GrantAnnouncement[] => {
  const grants: GrantAnnouncement[] = [];
  const now = new Date().toISOString();

  // Extract table rows
  const row_regex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row_match: RegExpExecArray | null;

  while ((row_match = row_regex.exec(html)) !== null) {
    const row_html = row_match[1];

    // Skip header rows containing <th>
    if (/<th[\s>]/i.test(row_html)) continue;

    // Extract <td> cells
    const cell_regex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let cell_match: RegExpExecArray | null;

    while ((cell_match = cell_regex.exec(row_html)) !== null) {
      cells.push(cell_match[1]);
    }

    // Need at least 3 cells: number/category, title, period
    if (cells.length < 3) continue;

    // Determine which cell holds the title — usually cell[1] or cell[2]
    // SBA layouts: [No, Title, Org, Period] or [No, Category, Title, Org, Period]
    const title_cell_index = cells.length >= 5 ? 2 : 1;
    const title_cell = cells[title_cell_index];
    const title_text = strip_html(title_cell);

    // Skip header-like text or empty rows
    if (!title_text || title_text === '제목' || title_text === '사업명') continue;

    // Extract link from title cell
    const link_match = title_cell.match(/href=["']([^"']+)["']/i);
    let url = '';
    if (link_match) {
      const href = link_match[1];
      url = href.startsWith('http')
        ? href
        : `https://www.sba.seoul.kr${href.startsWith('/') ? '' : '/'}${href}`;
    }

    // Generate ID from URL parameter or title hash
    const id_from_url = url.match(/[?&](?:no|idx|seq|id|bbs_sn)=(\d+)/i);
    const id = id_from_url
      ? `sba-${id_from_url[1]}`
      : `sba-${simple_hash(title_text)}`;

    // Organization: cell after title, or empty
    const org_index = title_cell_index + 1;
    const organization = org_index < cells.length ? strip_html(cells[org_index]) : '';

    // Period: cell after organization, or last cell
    const period_index = org_index + 1;
    const period_text = period_index < cells.length ? strip_html(cells[period_index]) : '';

    // Category: first cell if multi-column, empty otherwise
    const category = cells.length >= 5 ? strip_html(cells[1]) : strip_html(cells[0]);

    const deadline = extract_deadline(period_text);

    grants.push({
      id,
      title: title_text,
      organization,
      deadline,
      description: period_text,
      url,
      category,
      discovered_at: now,
    });
  }

  return grants;
};

// === D.CAMP Parser ===
// D.CAMP uses card-based or list-based layouts for programs/events.
// Cards typically have: <div class="card">...<h3>Title</h3>...<span>Date</span>...</div>
// Lists use: <li>...<a href="...">Title</a>...<span>Date</span>...</li>

export const parse_dcamp_programs = (html: string): GrantAnnouncement[] => {
  const grants: GrantAnnouncement[] = [];
  const now = new Date().toISOString();

  // Strategy 1: Card-based layout — extract card/item blocks
  // Match common card containers: <div class="...card...">...</div> or <li class="...item...">...</li>
  const card_regex = /<(?:div|li|article)[^>]*class="[^"]*(?:card|item|program|event)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|li|article)>/gi;
  let card_match: RegExpExecArray | null;

  while ((card_match = card_regex.exec(html)) !== null) {
    const card_html = card_match[1];

    // Extract title from heading tags or link text
    const title_match = card_html.match(/<(?:h[1-6]|strong|b)[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|b)>/i)
      ?? card_html.match(/<a[^>]*>([\s\S]*?)<\/a>/i);

    if (!title_match) continue;

    const title_text = strip_html(title_match[1]);
    if (!title_text) continue;

    // Extract link
    const link_match = card_html.match(/<a[^>]*href=["']([^"']+)["']/i);
    let url = '';
    if (link_match) {
      const href = link_match[1];
      url = href.startsWith('http')
        ? href
        : `https://dcamp.kr${href.startsWith('/') ? '' : '/'}${href}`;
    }

    // Extract date/period — prefer elements with date-related class, then fall back to
    // scanning all span/time/div elements for date-like content (YYYY.MM.DD pattern)
    const date_class_match = card_html.match(/<(?:span|time|div)[^>]*class="[^"]*date[^"]*"[^>]*>([\s\S]*?)<\/(?:span|time|div)>/i);
    let period_text = '';
    if (date_class_match) {
      period_text = strip_html(date_class_match[1]);
    } else {
      // Fallback: find any element containing a date pattern
      const all_elements = card_html.matchAll(/<(?:span|time|div|p)[^>]*>([\s\S]*?)<\/(?:span|time|div|p)>/gi);
      for (const el of all_elements) {
        const text = strip_html(el[1]);
        if (/\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(text)) {
          period_text = text;
          break;
        }
      }
    }

    // Extract category if present
    const category_match = card_html.match(/<(?:span|div)[^>]*class="[^"]*(?:category|tag|badge)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/i);
    const category = category_match ? strip_html(category_match[1]) : '';

    // Generate ID
    const id_from_url = url.match(/[?&](?:no|idx|seq|id)=(\d+)/i)
      ?? url.match(/\/(\d+)\/?$/);
    const id = id_from_url
      ? `dcamp-${id_from_url[1]}`
      : `dcamp-${simple_hash(title_text)}`;

    const deadline = extract_deadline(period_text);

    grants.push({
      id,
      title: title_text,
      organization: 'D.CAMP',
      deadline,
      description: period_text,
      url,
      category,
      discovered_at: now,
    });
  }

  // Strategy 2: Table-based fallback (some D.CAMP pages use tables)
  if (grants.length === 0) {
    const row_regex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let row_match_inner: RegExpExecArray | null;

    while ((row_match_inner = row_regex.exec(html)) !== null) {
      const row_html = row_match_inner[1];
      if (/<th[\s>]/i.test(row_html)) continue;

      const cell_regex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      const cells: string[] = [];
      let cell_match: RegExpExecArray | null;

      while ((cell_match = cell_regex.exec(row_html)) !== null) {
        cells.push(cell_match[1]);
      }

      if (cells.length < 2) continue;

      const title_text = strip_html(cells[1] ?? cells[0]);
      if (!title_text) continue;

      const link_match = (cells[1] ?? cells[0]).match(/href=["']([^"']+)["']/i);
      let url = '';
      if (link_match) {
        const href = link_match[1];
        url = href.startsWith('http')
          ? href
          : `https://dcamp.kr${href.startsWith('/') ? '' : '/'}${href}`;
      }

      const id = `dcamp-${simple_hash(title_text)}`;
      const period_text = cells.length > 2 ? strip_html(cells[2]) : '';

      grants.push({
        id,
        title: title_text,
        organization: 'D.CAMP',
        deadline: extract_deadline(period_text),
        description: period_text,
        url,
        category: '',
        discovered_at: now,
      });
    }
  }

  return grants;
};

// === MSS Parser ===
// MSS (Ministry of SMEs and Startups) uses table-based listing.
// Columns typically: No, Title, Department, Period, Status

export const parse_mss_grants = (html: string): GrantAnnouncement[] => {
  const grants: GrantAnnouncement[] = [];
  const now = new Date().toISOString();

  const row_regex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row_match: RegExpExecArray | null;

  while ((row_match = row_regex.exec(html)) !== null) {
    const row_html = row_match[1];

    // Skip header rows
    if (/<th[\s>]/i.test(row_html)) continue;

    const cell_regex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let cell_match: RegExpExecArray | null;

    while ((cell_match = cell_regex.exec(row_html)) !== null) {
      cells.push(cell_match[1]);
    }

    // Need at least 2 cells (number + title)
    if (cells.length < 2) continue;

    // Title is typically in cell[1]
    const title_cell = cells[1];
    const title_text = strip_html(title_cell);

    // Skip header-like or empty rows
    if (!title_text || title_text === '제목' || title_text === '사업명') continue;

    // Extract link
    const link_match = title_cell.match(/href=["']([^"']+)["']/i);
    let url = '';
    if (link_match) {
      const href = link_match[1];
      url = href.startsWith('http')
        ? href
        : `https://www.mss.go.kr${href.startsWith('/') ? '' : '/'}${href}`;
    }

    // Generate ID
    const id_from_url = url.match(/[?&](?:no|idx|seq|id|nttSn)=(\d+)/i);
    const id = id_from_url
      ? `mss-${id_from_url[1]}`
      : `mss-${simple_hash(title_text)}`;

    // Organization/department: cell[2]
    const organization = cells.length > 2 ? strip_html(cells[2]) : '';

    // Period: cell[3]
    const period_text = cells.length > 3 ? strip_html(cells[3]) : '';

    // Category: first cell — if numeric it's a row number, skip
    const first_cell_text = strip_html(cells[0]);
    const category = /^\d+$/.test(first_cell_text) ? '' : first_cell_text;

    const deadline = extract_deadline(period_text);

    grants.push({
      id,
      title: title_text,
      organization,
      deadline,
      description: period_text,
      url,
      category,
      discovered_at: now,
    });
  }

  return grants;
};

// === Route Grant Parser ===
// Routes a URL + HTML to the appropriate parser based on URL pattern.
// Returns empty array if no parser matches the URL.

export const route_grant_parser = (url: string, html: string): GrantAnnouncement[] => {
  if (is_sba_url(url)) return parse_sba_grants(html);
  if (is_dcamp_url(url)) return parse_dcamp_programs(html);
  if (is_mss_url(url)) return parse_mss_grants(html);
  return [];
};
