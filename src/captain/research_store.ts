// Research Store — structured storage for Deep Research results
// Saves Gemini Deep Research outputs as JSON + markdown summary files.
// Provides index-based fast lookups and filtering by tag, date, topic.
// File structure:
//   research/{YYYY-MM-DD}/{id}.json   — full result data
//   research/{YYYY-MM-DD}/{id}.md     — human-readable markdown summary
//   research/index.json               — fast lookup index

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// === Types ===

export type ResearchResult = {
  id: string;
  topic: string;
  query: string;
  result_text: string;
  source: string;          // e.g. 'gemini_deep_research', 'notebooklm', 'manual'
  created_at: string;      // ISO 8601
  tags: string[];
};

export type ResearchFilter = {
  tag?: string;
  date_range?: {
    from: string;   // ISO 8601 date string (YYYY-MM-DD)
    to: string;     // ISO 8601 date string (YYYY-MM-DD)
  };
  topic?: string;   // partial match (case-insensitive)
};

// Index entry — lightweight reference stored in index.json for fast lookups
export type ResearchIndexEntry = {
  id: string;
  topic: string;
  source: string;
  created_at: string;
  tags: string[];
  file_path: string;       // relative path from research root: "{date}/{id}.json"
};

export type ResearchIndex = {
  version: 1;
  entries: ResearchIndexEntry[];
  updated_at: string;
};

// Result of cleanup operation
export type CleanupResult = {
  deleted_count: number;
  deleted_dirs: string[];    // date directory names that were removed (e.g. "2026-01-15")
};

// Store interface returned by factory
export type ResearchStore = {
  save_research: (result: ResearchResult) => ResearchResult;
  list_research: (filter?: ResearchFilter) => ResearchIndexEntry[];
  get_research: (id: string) => ResearchResult | null;
  get_index: () => ResearchIndex;
  cleanup_old_research: (retention_days?: number) => CleanupResult;
};

// === Helpers ===

// Extract date portion (YYYY-MM-DD) from ISO 8601 timestamp
const extract_date = (iso_string: string): string => {
  return iso_string.slice(0, 10);
};

// Generate markdown summary from a research result
const generate_markdown = (result: ResearchResult): string => {
  const tag_str = result.tags.length > 0
    ? result.tags.map((t) => `\`${t}\``).join(', ')
    : '_none_';

  // Truncate result_text for summary (first 500 chars)
  const preview = result.result_text.length > 500
    ? result.result_text.slice(0, 500) + '...'
    : result.result_text;

  return [
    `# ${result.topic}`,
    '',
    `- **ID**: ${result.id}`,
    `- **Source**: ${result.source}`,
    `- **Created**: ${result.created_at}`,
    `- **Tags**: ${tag_str}`,
    '',
    '## Query',
    '',
    result.query,
    '',
    '## Result (Preview)',
    '',
    preview,
    '',
  ].join('\n');
};

// Load index from disk, or return empty index
const load_index = (index_path: string): ResearchIndex => {
  if (!existsSync(index_path)) {
    return { version: 1, entries: [], updated_at: new Date().toISOString() };
  }
  try {
    const raw = readFileSync(index_path, 'utf-8');
    return JSON.parse(raw) as ResearchIndex;
  } catch {
    // Corrupted index — return empty and let it rebuild on next save
    return { version: 1, entries: [], updated_at: new Date().toISOString() };
  }
};

// Persist index to disk
const save_index = (index_path: string, index: ResearchIndex): void => {
  index.updated_at = new Date().toISOString();
  mkdirSync(dirname(index_path), { recursive: true });
  writeFileSync(index_path, JSON.stringify(index, null, 2), 'utf-8');
};

// === Factory ===

// Create a research store backed by the given directory.
// All files are stored under `dir/` with structure:
//   {dir}/{YYYY-MM-DD}/{id}.json
//   {dir}/{YYYY-MM-DD}/{id}.md
//   {dir}/index.json
export const create_research_store = (dir: string): ResearchStore => {
  const index_path = join(dir, 'index.json');

  // Ensure root directory exists
  mkdirSync(dir, { recursive: true });

  // Load or initialize the index
  let index = load_index(index_path);

  // Save a research result to disk and update the index
  const save_research = (result: ResearchResult): ResearchResult => {
    // Assign ID if not provided
    const final_result: ResearchResult = {
      ...result,
      id: result.id || randomUUID(),
      created_at: result.created_at || new Date().toISOString(),
    };

    const date_dir = extract_date(final_result.created_at);
    const day_path = join(dir, date_dir);
    mkdirSync(day_path, { recursive: true });

    // Write JSON file (full data)
    const json_path = join(day_path, `${final_result.id}.json`);
    writeFileSync(json_path, JSON.stringify(final_result, null, 2), 'utf-8');

    // Write markdown summary
    const md_path = join(day_path, `${final_result.id}.md`);
    writeFileSync(md_path, generate_markdown(final_result), 'utf-8');

    // Update index — remove existing entry with same ID (idempotent upsert)
    const relative_path = `${date_dir}/${final_result.id}.json`;
    index.entries = index.entries.filter((e) => e.id !== final_result.id);
    index.entries.push({
      id: final_result.id,
      topic: final_result.topic,
      source: final_result.source,
      created_at: final_result.created_at,
      tags: final_result.tags,
      file_path: relative_path,
    });

    // Persist index
    save_index(index_path, index);

    return final_result;
  };

  // List research entries with optional filtering
  const list_research = (filter?: ResearchFilter): ResearchIndexEntry[] => {
    // Reload index from disk to catch external changes
    index = load_index(index_path);

    let results = [...index.entries];

    if (filter?.tag) {
      const tag_lower = filter.tag.toLowerCase();
      results = results.filter((e) =>
        e.tags.some((t) => t.toLowerCase() === tag_lower),
      );
    }

    if (filter?.date_range) {
      const from = filter.date_range.from;
      const to = filter.date_range.to;
      results = results.filter((e) => {
        const date = extract_date(e.created_at);
        return date >= from && date <= to;
      });
    }

    if (filter?.topic) {
      const topic_lower = filter.topic.toLowerCase();
      results = results.filter((e) =>
        e.topic.toLowerCase().includes(topic_lower),
      );
    }

    // Sort by created_at descending (newest first)
    results.sort((a, b) => b.created_at.localeCompare(a.created_at));

    return results;
  };

  // Get a single research result by ID
  const get_research = (id: string): ResearchResult | null => {
    // Reload index
    index = load_index(index_path);

    const entry = index.entries.find((e) => e.id === id);
    if (!entry) return null;

    const json_path = join(dir, entry.file_path);
    if (!existsSync(json_path)) return null;

    try {
      const raw = readFileSync(json_path, 'utf-8');
      return JSON.parse(raw) as ResearchResult;
    } catch {
      return null;
    }
  };

  // Get the current index (for inspection/debugging)
  const get_index = (): ResearchIndex => {
    index = load_index(index_path);
    return index;
  };

  // Delete research folders older than retention_days and update index accordingly.
  // Scans date-named subdirectories (YYYY-MM-DD) under the research root.
  // Default retention: 30 days.
  const cleanup_old_research = (retention_days = 30): CleanupResult => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retention_days);
    const cutoff_date = cutoff.toISOString().slice(0, 10); // "YYYY-MM-DD"

    // Reload index to ensure we have the latest state
    index = load_index(index_path);

    const deleted_dirs: string[] = [];
    let deleted_count = 0;

    // Scan top-level subdirectories for date-named folders
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Only process directories matching YYYY-MM-DD pattern
      const dir_name = entry.name;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dir_name)) continue;

      // If directory date is strictly before cutoff, remove it
      if (dir_name < cutoff_date) {
        const full_path = join(dir, dir_name);

        // Count entries that will be removed from the index
        const entries_in_dir = index.entries.filter((e) =>
          e.file_path.startsWith(`${dir_name}/`),
        );
        deleted_count += entries_in_dir.length;

        // Remove from index
        index.entries = index.entries.filter((e) =>
          !e.file_path.startsWith(`${dir_name}/`),
        );

        // Delete the directory from disk
        rmSync(full_path, { recursive: true, force: true });
        deleted_dirs.push(dir_name);
      }
    }

    // Persist updated index if anything was deleted
    if (deleted_dirs.length > 0) {
      save_index(index_path, index);
    }

    return { deleted_count, deleted_dirs };
  };

  return { save_research, list_research, get_research, get_index, cleanup_old_research };
};
