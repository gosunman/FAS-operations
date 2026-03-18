// TDD tests for planning loop (morning/night scheduling + dynamic discovery)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_planning_loop } from './planning_loop.js';
import { create_task_store, type TaskStore } from '../gateway/task_store.js';
import type { NotificationRouter } from '../notification/router.js';
import type { GeminiConfig, GeminiResponse } from '../gemini/types.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock the Gemini CLI wrapper
vi.mock('../gemini/cli_wrapper.js', () => ({
  spawn_gemini: vi.fn(),
}));

// Import the mocked function for assertions
import { spawn_gemini } from '../gemini/cli_wrapper.js';
const mock_spawn_gemini = vi.mocked(spawn_gemini);

// === Test fixtures ===

const TEST_SCHEDULES = {
  schedules: {
    ai_trends: {
      title: 'AI 트렌드 리서치',
      type: 'daily',
      time: '01:00',
      mode: 'sleep',
      agent: 'gemini_a',
      risk_level: 'low',
      requires_personal_info: false,
    },
    startup_crawl: {
      title: '창업지원사업 크롤링',
      type: 'every_3_days',
      time: '02:00',
      mode: 'sleep',
      agent: 'gemini_a',
      risk_level: 'low',
      requires_personal_info: true,
    },
    grad_school: {
      title: '대학원 일정 체크',
      type: 'weekly',
      day: 'monday',
      time: '04:00',
      mode: 'sleep',
      agent: 'gemini_a',
      risk_level: 'low',
      requires_personal_info: false,
    },
    morning_briefing: {
      title: '모닝 브리핑',
      type: 'daily',
      time: '07:30',
      mode: 'awake',
      workflow: 'WF-4',
      // No agent — system workflow
    },
  },
};

// Helper
const create_mock_router = (): NotificationRouter => ({
  route: vi.fn().mockResolvedValue({ telegram: true, slack: true, notion: false }),
  get_rules: vi.fn().mockReturnValue(null),
});

describe('PlanningLoop', () => {
  let store: TaskStore;
  let router: NotificationRouter;
  let schedules_path: string;
  let tmp_dir: string;

  beforeEach(() => {
    store = create_task_store({ db_path: ':memory:' });
    router = create_mock_router();
    mock_spawn_gemini.mockClear();
    tmp_dir = join(tmpdir(), `fas-test-${Date.now()}`);
    mkdirSync(tmp_dir, { recursive: true });
    schedules_path = join(tmp_dir, 'schedules.yml');

    // Write test schedules
    const yaml_content = `schedules:\n${Object.entries(TEST_SCHEDULES.schedules)
      .map(([key, val]) => {
        const lines = [`  ${key}:`];
        for (const [k, v] of Object.entries(val)) {
          lines.push(`    ${k}: ${typeof v === 'string' ? `"${v}"` : v}`);
        }
        return lines.join('\n');
      })
      .join('\n')}`;
    writeFileSync(schedules_path, yaml_content);
  });

  afterEach(() => {
    store.close();
    rmSync(tmp_dir, { recursive: true, force: true });
  });

  // === is_due_today ===

  describe('daily schedules', () => {
    it('should always be due', () => {
      const loop = create_planning_loop({ store, router, schedules_path });
      const entry = { title: 'test', type: 'daily' as const, time: '01:00' };
      const epoch = new Date('2026-01-01');
      expect(loop._is_due_today(entry, new Date('2026-03-18'), epoch)).toBe(true);
      expect(loop._is_due_today(entry, new Date('2026-03-19'), epoch)).toBe(true);
    });
  });

  describe('weekly schedules', () => {
    it('should be due on the correct day', () => {
      const loop = create_planning_loop({ store, router, schedules_path });
      const entry = { title: 'test', type: 'weekly' as const, time: '04:00', day: 'monday' };
      const epoch = new Date('2026-01-01');

      // 2026-03-16 is Monday
      expect(loop._is_due_today(entry, new Date('2026-03-16'), epoch)).toBe(true);
      // 2026-03-17 is Tuesday
      expect(loop._is_due_today(entry, new Date('2026-03-17'), epoch)).toBe(false);
    });
  });

  describe('every_3_days schedules', () => {
    it('should be due every 3 days from epoch', () => {
      const epoch = new Date('2026-01-01T00:00:00Z');
      const loop = create_planning_loop({ store, router, schedules_path, epoch });
      const entry = { title: 'test', type: 'every_3_days' as const, time: '02:00' };

      // Day 0 (epoch) = due
      expect(loop._is_due_today(entry, new Date('2026-01-01T00:00:00Z'), epoch)).toBe(true);
      // Day 1 = not due
      expect(loop._is_due_today(entry, new Date('2026-01-02T00:00:00Z'), epoch)).toBe(false);
      // Day 2 = not due
      expect(loop._is_due_today(entry, new Date('2026-01-03T00:00:00Z'), epoch)).toBe(false);
      // Day 3 = due
      expect(loop._is_due_today(entry, new Date('2026-01-04T00:00:00Z'), epoch)).toBe(true);
    });
  });

  // === run_morning ===

  describe('run_morning()', () => {
    it('should create due daily tasks', async () => {
      const loop = create_planning_loop({ store, router, schedules_path });
      const result = await loop.run_morning(new Date('2026-03-18T07:30:00Z'));

      // AI 트렌드 is daily → should be created
      expect(result.created).toContain('AI 트렌드 리서치');
    });

    it('should skip system workflows (no agent)', async () => {
      const loop = create_planning_loop({ store, router, schedules_path });
      const result = await loop.run_morning(new Date('2026-03-18T07:30:00Z'));

      expect(result.skipped).toContainEqual(expect.stringContaining('모닝 브리핑'));
      expect(result.created).not.toContain('모닝 브리핑');
    });

    it('should not duplicate already queued tasks', async () => {
      const loop = create_planning_loop({ store, router, schedules_path });

      // First run
      await loop.run_morning(new Date('2026-03-18T07:30:00Z'));

      // Second run — same day
      const result2 = await loop.run_morning(new Date('2026-03-18T07:30:00Z'));
      expect(result2.skipped).toContainEqual(expect.stringContaining('already queued'));

      // Total tasks in store should remain the same
      const all_tasks = store.get_all();
      const ai_tasks = all_tasks.filter((t) => t.title === 'AI 트렌드 리서치');
      expect(ai_tasks.length).toBe(1);
    });

    it('should send briefing notification when tasks are created', async () => {
      const loop = create_planning_loop({ store, router, schedules_path });
      await loop.run_morning(new Date('2026-03-18T07:30:00Z'));

      expect(router.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'briefing',
          message: expect.stringContaining('[Morning Briefing]'),
        }),
      );
    });

    it('should not send briefing when no tasks are created', async () => {
      const loop = create_planning_loop({ store, router, schedules_path });

      // First run creates tasks
      await loop.run_morning(new Date('2026-03-18T07:30:00Z'));
      vi.mocked(router.route).mockClear();

      // Second run has nothing new
      await loop.run_morning(new Date('2026-03-18T07:30:00Z'));
      expect(router.route).not.toHaveBeenCalled();
    });

    it('should skip weekly task on wrong day', async () => {
      const loop = create_planning_loop({ store, router, schedules_path });
      // 2026-03-18 is Wednesday, grad_school is Monday only
      const result = await loop.run_morning(new Date('2026-03-18T07:30:00Z'));

      expect(result.created).not.toContain('대학원 일정 체크');
    });

    it('should include weekly task on correct day', async () => {
      const loop = create_planning_loop({ store, router, schedules_path });
      // 2026-03-16 is Monday
      const result = await loop.run_morning(new Date('2026-03-16T07:30:00Z'));

      expect(result.created).toContain('대학원 일정 체크');
    });
  });

  // === run_night ===

  describe('run_night()', () => {
    it('should return summary stats and send briefing', async () => {
      // Create some tasks
      store.create({ title: 'A', assigned_to: 'claude' });
      const b = store.create({ title: 'B', assigned_to: 'claude' });
      store.complete_task(b.id, { summary: 'Done' });
      const c = store.create({ title: 'C', assigned_to: 'claude' });
      store.block_task(c.id, 'Blocked');

      const loop = create_planning_loop({ store, router, schedules_path });
      const result = await loop.run_night();

      expect(result.summary.done).toBe(1);
      expect(result.summary.blocked).toBe(1);
      expect(result.summary.pending).toBe(1);

      expect(router.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'briefing',
          message: expect.stringContaining('[Night Summary]'),
        }),
      );
    });

    it('should call run_discover during night if gemini_config is provided', async () => {
      // Given: a completed crawl task and gemini config
      const gemini_config: GeminiConfig = { account: 'a' };
      const task = store.create({ title: 'AI crawl research', assigned_to: 'gemini_a' });
      store.complete_task(task.id, { summary: 'Found 3 trends' });

      mock_spawn_gemini.mockResolvedValue({
        content: '[]',
        raw_output: '[]',
        success: true,
        duration_ms: 1000,
      });

      const loop = create_planning_loop({ store, router, schedules_path, gemini_config });

      // When
      const result = await loop.run_night();

      // Then: discovery result should be present
      expect(result.discovery).toBeDefined();
      expect(result.discovery!.analyzed_tasks).toBe(1);
    });

    it('should not call run_discover during night if no gemini_config', async () => {
      const loop = create_planning_loop({ store, router, schedules_path });
      const result = await loop.run_night();

      // Then: discovery should be undefined
      expect(result.discovery).toBeUndefined();
      expect(mock_spawn_gemini).not.toHaveBeenCalled();
    });
  });

  // === discover_opportunities ===

  describe('run_discover()', () => {
    const gemini_config: GeminiConfig = { account: 'a' };

    const make_gemini_response = (content: string, success = true): GeminiResponse => ({
      content,
      raw_output: content,
      success,
      error: success ? undefined : 'mock error',
      duration_ms: 500,
    });

    it('should skip when no gemini_config is provided', async () => {
      // Given: no gemini config
      const loop = create_planning_loop({ store, router, schedules_path });

      // When
      const result = await loop.run_discover();

      // Then
      expect(result.analyzed_tasks).toBe(0);
      expect(result.created).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(mock_spawn_gemini).not.toHaveBeenCalled();
    });

    it('should skip when no recent crawl tasks exist', async () => {
      // Given: gemini config but no crawl tasks
      const loop = create_planning_loop({ store, router, schedules_path, gemini_config });

      // When
      const result = await loop.run_discover();

      // Then
      expect(result.analyzed_tasks).toBe(0);
      expect(mock_spawn_gemini).not.toHaveBeenCalled();
    });

    it('should call Gemini with correct prompt containing task summaries', async () => {
      // Given: a completed crawl task
      const task = store.create({ title: '창업지원사업 크롤링', assigned_to: 'gemini_a' });
      store.complete_task(task.id, { summary: 'Found 5 government programs' });

      mock_spawn_gemini.mockResolvedValue(make_gemini_response('[]'));

      const loop = create_planning_loop({ store, router, schedules_path, gemini_config });

      // When
      await loop.run_discover();

      // Then: Gemini should be called with a prompt containing the summary
      expect(mock_spawn_gemini).toHaveBeenCalledOnce();
      const call_args = mock_spawn_gemini.mock.calls[0];
      expect(call_args[0]).toEqual(gemini_config);
      expect(call_args[1]).toContain('창업지원사업 크롤링');
      expect(call_args[1]).toContain('Found 5 government programs');
      expect(call_args[1]).toContain('최근 3일간의 크롤링/리서치 결과');
    });

    it('should create tasks from Gemini JSON response', async () => {
      // Given: a completed crawl task
      const task = store.create({ title: 'AI research crawl', assigned_to: 'gemini_a' });
      store.complete_task(task.id, { summary: 'New AI startup funding announced' });

      const suggestions = [
        { title: '스타트업 펀딩 상세 조사', description: 'Investigate funding details', agent: 'gemini_a', priority: 'high' },
        { title: '관련 채용공고 확인', description: 'Check related job postings', agent: 'gemini_b', priority: 'medium' },
      ];
      mock_spawn_gemini.mockResolvedValue(make_gemini_response(JSON.stringify(suggestions)));

      const loop = create_planning_loop({ store, router, schedules_path, gemini_config });

      // When
      const result = await loop.run_discover();

      // Then
      expect(result.analyzed_tasks).toBe(1);
      expect(result.created).toEqual(['스타트업 펀딩 상세 조사', '관련 채용공고 확인']);
      expect(result.skipped).toEqual([]);

      // Verify tasks were created in store
      const all_tasks = store.get_all();
      const funding_task = all_tasks.find((t) => t.title === '스타트업 펀딩 상세 조사');
      expect(funding_task).toBeDefined();
      expect(funding_task!.assigned_to).toBe('gemini_a');
      expect(funding_task!.priority).toBe('high');
      expect(funding_task!.description).toBe('Investigate funding details');
    });

    it('should deduplicate — not create already-queued tasks', async () => {
      // Given: a completed crawl task AND an already-queued task with the same title
      const crawl = store.create({ title: 'startup scrape', assigned_to: 'gemini_a' });
      store.complete_task(crawl.id, { summary: 'Found opportunity' });

      // Pre-create a pending task with the same title as one suggestion
      store.create({ title: '기존 태스크', assigned_to: 'claude' });

      const suggestions = [
        { title: '기존 태스크', description: 'Already exists', agent: 'gemini_a', priority: 'low' },
        { title: '새 태스크', description: 'Brand new', agent: 'gemini_b', priority: 'medium' },
      ];
      mock_spawn_gemini.mockResolvedValue(make_gemini_response(JSON.stringify(suggestions)));

      const loop = create_planning_loop({ store, router, schedules_path, gemini_config });

      // When
      const result = await loop.run_discover();

      // Then
      expect(result.created).toEqual(['새 태스크']);
      expect(result.skipped).toEqual(['기존 태스크 (already queued)']);
    });

    it('should handle Gemini failure gracefully (no crash, log warning)', async () => {
      // Given: a completed crawl task and Gemini returns failure
      const task = store.create({ title: 'crawl test', assigned_to: 'gemini_a' });
      store.complete_task(task.id, { summary: 'Some data' });

      mock_spawn_gemini.mockResolvedValue(make_gemini_response('', false));

      const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const loop = create_planning_loop({ store, router, schedules_path, gemini_config });

      // When
      const result = await loop.run_discover();

      // Then: should return gracefully with no created tasks
      expect(result.analyzed_tasks).toBe(1);
      expect(result.created).toEqual([]);
      expect(warn_spy).toHaveBeenCalledWith(
        expect.stringContaining('[discover_opportunities]'),
        expect.anything(),
      );

      warn_spy.mockRestore();
    });

    it('should handle Gemini spawn exception gracefully', async () => {
      // Given: Gemini throws an error
      const task = store.create({ title: 'crawl exception', assigned_to: 'gemini_a' });
      store.complete_task(task.id, { summary: 'Data' });

      mock_spawn_gemini.mockRejectedValue(new Error('CLI not found'));

      const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const loop = create_planning_loop({ store, router, schedules_path, gemini_config });

      // When
      const result = await loop.run_discover();

      // Then
      expect(result.analyzed_tasks).toBe(1);
      expect(result.created).toEqual([]);
      expect(warn_spy).toHaveBeenCalled();

      warn_spy.mockRestore();
    });

    it('should handle malformed Gemini JSON response', async () => {
      // Given: Gemini returns invalid JSON
      const task = store.create({ title: 'research crawl', assigned_to: 'gemini_a' });
      store.complete_task(task.id, { summary: 'Info' });

      mock_spawn_gemini.mockResolvedValue(make_gemini_response('not valid json at all {broken'));

      const loop = create_planning_loop({ store, router, schedules_path, gemini_config });

      // When
      const result = await loop.run_discover();

      // Then: no crash, no tasks created
      expect(result.analyzed_tasks).toBe(1);
      expect(result.created).toEqual([]);
    });

    it('should cap at 3 suggestions max', async () => {
      // Given: crawl task exists
      const task = store.create({ title: 'scrape big', assigned_to: 'gemini_a' });
      store.complete_task(task.id, { summary: 'Lots of data' });

      const suggestions = [
        { title: 'Task 1', description: 'D1', agent: 'gemini_a', priority: 'low' },
        { title: 'Task 2', description: 'D2', agent: 'gemini_b', priority: 'medium' },
        { title: 'Task 3', description: 'D3', agent: 'claude', priority: 'high' },
        { title: 'Task 4', description: 'D4', agent: 'openclaw', priority: 'low' },
        { title: 'Task 5', description: 'D5', agent: 'gemini_a', priority: 'medium' },
      ];
      mock_spawn_gemini.mockResolvedValue(make_gemini_response(JSON.stringify(suggestions)));

      const loop = create_planning_loop({ store, router, schedules_path, gemini_config });

      // When
      const result = await loop.run_discover();

      // Then: only first 3 should be created
      expect(result.created.length).toBe(3);
      expect(result.created).toEqual(['Task 1', 'Task 2', 'Task 3']);
    });

    it('should reject suggestions with invalid agents', async () => {
      // Given: crawl task and suggestions with invalid agent
      const task = store.create({ title: 'crawl agents', assigned_to: 'gemini_a' });
      store.complete_task(task.id, { summary: 'Data' });

      const suggestions = [
        { title: 'Valid Task', description: 'OK', agent: 'gemini_a', priority: 'low' },
        { title: 'Invalid Task', description: 'Bad agent', agent: 'unknown_agent', priority: 'medium' },
      ];
      mock_spawn_gemini.mockResolvedValue(make_gemini_response(JSON.stringify(suggestions)));

      const loop = create_planning_loop({ store, router, schedules_path, gemini_config });

      // When
      const result = await loop.run_discover();

      // Then: only valid agent task should be created
      expect(result.created).toEqual(['Valid Task']);
    });

    it('should send notification when opportunities are discovered', async () => {
      // Given: crawl task and valid suggestion
      const task = store.create({ title: 'crawl notify', assigned_to: 'gemini_a' });
      store.complete_task(task.id, { summary: 'Important finding' });

      const suggestions = [
        { title: '긴급 조사 필요', description: 'Urgent research', agent: 'gemini_a', priority: 'high' },
      ];
      mock_spawn_gemini.mockResolvedValue(make_gemini_response(JSON.stringify(suggestions)));

      const loop = create_planning_loop({ store, router, schedules_path, gemini_config });

      // When
      await loop.run_discover();

      // Then: notification should be sent
      expect(router.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'briefing',
          message: expect.stringContaining('[Discovery]'),
        }),
      );
    });

    it('should only consider tasks with crawl-related keywords in title', async () => {
      // Given: one crawl task and one non-crawl task
      const crawl_task = store.create({ title: '창업지원사업 크롤링', assigned_to: 'gemini_a' });
      store.complete_task(crawl_task.id, { summary: 'Crawl data' });

      const non_crawl = store.create({ title: 'Code review', assigned_to: 'claude' });
      store.complete_task(non_crawl.id, { summary: 'Reviewed code' });

      mock_spawn_gemini.mockResolvedValue(make_gemini_response('[]'));

      const loop = create_planning_loop({ store, router, schedules_path, gemini_config });

      // When
      const result = await loop.run_discover();

      // Then: only crawl task should be analyzed
      expect(result.analyzed_tasks).toBe(1);
      const prompt = mock_spawn_gemini.mock.calls[0][1];
      expect(prompt).toContain('창업지원사업 크롤링');
      expect(prompt).not.toContain('Code review');
    });
  });
});
