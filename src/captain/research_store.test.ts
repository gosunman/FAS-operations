// Research Store — comprehensive test suite
// Tests: save, retrieve, list, filter, index management, edge cases

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { create_research_store } from './research_store.js';
import type { ResearchResult, ResearchFilter, ResearchIndex } from './research_store.js';

// === Test helpers ===

const make_temp_dir = (): string =>
  mkdtempSync(join(tmpdir(), 'fas-research-test-'));

const make_result = (overrides?: Partial<ResearchResult>): ResearchResult => ({
  id: overrides?.id ?? 'test-001',
  topic: overrides?.topic ?? 'AI Safety Research',
  query: overrides?.query ?? 'What are the latest developments in AI safety?',
  result_text: overrides?.result_text ?? 'AI safety has made significant progress in 2025...',
  source: overrides?.source ?? 'gemini_deep_research',
  created_at: overrides?.created_at ?? '2026-03-21T10:00:00.000Z',
  tags: overrides?.tags ?? ['ai', 'safety'],
});

// === Tests ===

describe('create_research_store', () => {
  let temp_dir: string;

  beforeEach(() => {
    temp_dir = make_temp_dir();
  });

  afterEach(() => {
    rmSync(temp_dir, { recursive: true, force: true });
  });

  it('should create the research directory on initialization', () => {
    const nested = join(temp_dir, 'deep', 'nested', 'research');
    create_research_store(nested);
    expect(existsSync(nested)).toBe(true);
  });

  describe('save_research', () => {
    it('should save a research result and return it with preserved fields', () => {
      const store = create_research_store(temp_dir);
      const input = make_result();
      const saved = store.save_research(input);

      expect(saved.id).toBe('test-001');
      expect(saved.topic).toBe('AI Safety Research');
      expect(saved.source).toBe('gemini_deep_research');
      expect(saved.tags).toEqual(['ai', 'safety']);
    });

    it('should create JSON file in date-based directory', () => {
      const store = create_research_store(temp_dir);
      store.save_research(make_result());

      const json_path = join(temp_dir, '2026-03-21', 'test-001.json');
      expect(existsSync(json_path)).toBe(true);

      const parsed = JSON.parse(readFileSync(json_path, 'utf-8'));
      expect(parsed.id).toBe('test-001');
      expect(parsed.topic).toBe('AI Safety Research');
    });

    it('should create markdown summary file alongside JSON', () => {
      const store = create_research_store(temp_dir);
      store.save_research(make_result());

      const md_path = join(temp_dir, '2026-03-21', 'test-001.md');
      expect(existsSync(md_path)).toBe(true);

      const content = readFileSync(md_path, 'utf-8');
      expect(content).toContain('# AI Safety Research');
      expect(content).toContain('**ID**: test-001');
      expect(content).toContain('**Source**: gemini_deep_research');
      expect(content).toContain('`ai`');
      expect(content).toContain('`safety`');
      expect(content).toContain('## Query');
      expect(content).toContain('## Result (Preview)');
    });

    it('should update index.json after save', () => {
      const store = create_research_store(temp_dir);
      store.save_research(make_result());

      const index_path = join(temp_dir, 'index.json');
      expect(existsSync(index_path)).toBe(true);

      const index: ResearchIndex = JSON.parse(readFileSync(index_path, 'utf-8'));
      expect(index.version).toBe(1);
      expect(index.entries).toHaveLength(1);
      expect(index.entries[0].id).toBe('test-001');
      expect(index.entries[0].file_path).toBe('2026-03-21/test-001.json');
    });

    it('should handle upsert — overwrite existing entry with same ID', () => {
      const store = create_research_store(temp_dir);

      store.save_research(make_result({ topic: 'Version 1' }));
      store.save_research(make_result({ topic: 'Version 2' }));

      const index = store.get_index();
      expect(index.entries).toHaveLength(1);
      expect(index.entries[0].topic).toBe('Version 2');

      // JSON file should reflect updated content
      const retrieved = store.get_research('test-001');
      expect(retrieved?.topic).toBe('Version 2');
    });

    it('should assign UUID if id is empty string', () => {
      const store = create_research_store(temp_dir);
      const saved = store.save_research(make_result({ id: '' }));

      // Should have a UUID-like ID (36 chars with dashes)
      expect(saved.id).toBeTruthy();
      expect(saved.id.length).toBe(36);
    });

    it('should assign current timestamp if created_at is empty', () => {
      const store = create_research_store(temp_dir);
      const before = new Date().toISOString();
      const saved = store.save_research(make_result({ created_at: '' }));
      const after = new Date().toISOString();

      expect(saved.created_at).toBeTruthy();
      expect(saved.created_at >= before).toBe(true);
      expect(saved.created_at <= after).toBe(true);
    });

    it('should truncate long result_text in markdown preview', () => {
      const store = create_research_store(temp_dir);
      const long_text = 'A'.repeat(1000);
      store.save_research(make_result({ result_text: long_text }));

      const md_path = join(temp_dir, '2026-03-21', 'test-001.md');
      const content = readFileSync(md_path, 'utf-8');

      // Markdown should contain truncated preview (500 chars + "...")
      expect(content).toContain('...');
      // But full text should be in JSON
      const json_path = join(temp_dir, '2026-03-21', 'test-001.json');
      const parsed = JSON.parse(readFileSync(json_path, 'utf-8'));
      expect(parsed.result_text.length).toBe(1000);
    });

    it('should handle empty tags array', () => {
      const store = create_research_store(temp_dir);
      store.save_research(make_result({ tags: [] }));

      const md_path = join(temp_dir, '2026-03-21', 'test-001.md');
      const content = readFileSync(md_path, 'utf-8');
      expect(content).toContain('_none_');
    });
  });

  describe('get_research', () => {
    it('should retrieve a saved research result by ID', () => {
      const store = create_research_store(temp_dir);
      store.save_research(make_result());

      const retrieved = store.get_research('test-001');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('test-001');
      expect(retrieved!.topic).toBe('AI Safety Research');
      expect(retrieved!.query).toBe('What are the latest developments in AI safety?');
      expect(retrieved!.result_text).toContain('AI safety');
    });

    it('should return null for non-existent ID', () => {
      const store = create_research_store(temp_dir);
      const result = store.get_research('non-existent');
      expect(result).toBeNull();
    });

    it('should return null if JSON file was deleted but index still has entry', () => {
      const store = create_research_store(temp_dir);
      store.save_research(make_result());

      // Manually delete the JSON file
      const json_path = join(temp_dir, '2026-03-21', 'test-001.json');
      rmSync(json_path);

      const result = store.get_research('test-001');
      expect(result).toBeNull();
    });
  });

  describe('list_research', () => {
    it('should list all entries when no filter is provided', () => {
      const store = create_research_store(temp_dir);
      store.save_research(make_result({ id: 'r-001' }));
      store.save_research(make_result({ id: 'r-002', created_at: '2026-03-22T10:00:00.000Z' }));

      const all = store.list_research();
      expect(all).toHaveLength(2);
    });

    it('should return results sorted by created_at descending (newest first)', () => {
      const store = create_research_store(temp_dir);
      store.save_research(make_result({ id: 'old', created_at: '2026-03-01T10:00:00.000Z' }));
      store.save_research(make_result({ id: 'new', created_at: '2026-03-21T10:00:00.000Z' }));
      store.save_research(make_result({ id: 'mid', created_at: '2026-03-10T10:00:00.000Z' }));

      const all = store.list_research();
      expect(all.map((e) => e.id)).toEqual(['new', 'mid', 'old']);
    });

    it('should return empty array when no entries exist', () => {
      const store = create_research_store(temp_dir);
      const all = store.list_research();
      expect(all).toEqual([]);
    });

    describe('filter by tag', () => {
      it('should filter entries by exact tag match (case-insensitive)', () => {
        const store = create_research_store(temp_dir);
        store.save_research(make_result({ id: 'r-ai', tags: ['ai', 'safety'] }));
        store.save_research(make_result({ id: 'r-web', tags: ['web', 'crawling'] }));
        store.save_research(make_result({ id: 'r-both', tags: ['ai', 'web'] }));

        const ai_results = store.list_research({ tag: 'ai' });
        expect(ai_results.map((e) => e.id).sort()).toEqual(['r-ai', 'r-both']);

        const web_results = store.list_research({ tag: 'web' });
        expect(web_results.map((e) => e.id).sort()).toEqual(['r-both', 'r-web']);
      });

      it('should be case-insensitive for tag matching', () => {
        const store = create_research_store(temp_dir);
        store.save_research(make_result({ id: 'r-1', tags: ['AI'] }));

        const results = store.list_research({ tag: 'ai' });
        expect(results).toHaveLength(1);
      });
    });

    describe('filter by date_range', () => {
      it('should filter entries within date range (inclusive)', () => {
        const store = create_research_store(temp_dir);
        store.save_research(make_result({ id: 'r-jan', created_at: '2026-01-15T10:00:00.000Z' }));
        store.save_research(make_result({ id: 'r-feb', created_at: '2026-02-15T10:00:00.000Z' }));
        store.save_research(make_result({ id: 'r-mar', created_at: '2026-03-15T10:00:00.000Z' }));

        const results = store.list_research({
          date_range: { from: '2026-02-01', to: '2026-02-28' },
        });
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('r-feb');
      });

      it('should include boundary dates', () => {
        const store = create_research_store(temp_dir);
        store.save_research(make_result({ id: 'r-start', created_at: '2026-03-01T00:00:00.000Z' }));
        store.save_research(make_result({ id: 'r-end', created_at: '2026-03-31T23:59:59.000Z' }));

        const results = store.list_research({
          date_range: { from: '2026-03-01', to: '2026-03-31' },
        });
        expect(results).toHaveLength(2);
      });
    });

    describe('filter by topic', () => {
      it('should filter by partial topic match (case-insensitive)', () => {
        const store = create_research_store(temp_dir);
        store.save_research(make_result({ id: 'r-1', topic: 'AI Safety Research' }));
        store.save_research(make_result({ id: 'r-2', topic: 'Web Crawling Techniques' }));
        store.save_research(make_result({ id: 'r-3', topic: 'AI Ethics and Governance' }));

        const ai_results = store.list_research({ topic: 'ai' });
        expect(ai_results).toHaveLength(2);
        expect(ai_results.map((e) => e.id).sort()).toEqual(['r-1', 'r-3']);
      });
    });

    describe('combined filters', () => {
      it('should apply all filters together (AND logic)', () => {
        const store = create_research_store(temp_dir);
        store.save_research(make_result({
          id: 'r-1',
          topic: 'AI Safety',
          tags: ['ai'],
          created_at: '2026-03-15T10:00:00.000Z',
        }));
        store.save_research(make_result({
          id: 'r-2',
          topic: 'AI Ethics',
          tags: ['ai', 'ethics'],
          created_at: '2026-02-15T10:00:00.000Z',
        }));
        store.save_research(make_result({
          id: 'r-3',
          topic: 'Web Crawling',
          tags: ['web'],
          created_at: '2026-03-15T10:00:00.000Z',
        }));

        // Filter: tag=ai AND topic=ai AND date in March
        const results = store.list_research({
          tag: 'ai',
          topic: 'ai',
          date_range: { from: '2026-03-01', to: '2026-03-31' },
        });

        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('r-1');
      });
    });
  });

  describe('get_index', () => {
    it('should return the current index with version and entries', () => {
      const store = create_research_store(temp_dir);
      store.save_research(make_result({ id: 'r-1' }));
      store.save_research(make_result({ id: 'r-2', created_at: '2026-03-22T10:00:00.000Z' }));

      const index = store.get_index();
      expect(index.version).toBe(1);
      expect(index.entries).toHaveLength(2);
      expect(index.updated_at).toBeTruthy();
    });
  });

  describe('persistence across store instances', () => {
    it('should persist data accessible by a new store instance on same directory', () => {
      // First store saves data
      const store1 = create_research_store(temp_dir);
      store1.save_research(make_result({ id: 'persistent-001' }));

      // Second store on same directory should see the data
      const store2 = create_research_store(temp_dir);
      const result = store2.get_research('persistent-001');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('persistent-001');

      const listed = store2.list_research();
      expect(listed).toHaveLength(1);
    });
  });

  describe('multiple dates', () => {
    it('should organize files into separate date directories', () => {
      const store = create_research_store(temp_dir);
      store.save_research(make_result({ id: 'r-day1', created_at: '2026-03-20T10:00:00.000Z' }));
      store.save_research(make_result({ id: 'r-day2', created_at: '2026-03-21T10:00:00.000Z' }));

      expect(existsSync(join(temp_dir, '2026-03-20', 'r-day1.json'))).toBe(true);
      expect(existsSync(join(temp_dir, '2026-03-21', 'r-day2.json'))).toBe(true);
    });
  });
});
