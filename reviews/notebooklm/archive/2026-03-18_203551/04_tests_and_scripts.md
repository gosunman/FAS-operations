# FAS Operations — 테스트 & 스크립트 — NotebookLM 교차 검증 소스

> 테스트 코드와 운영 스크립트. 생성일: 2026-03-18

## 파일: [OPS] src/captain/feedback_extractor.test.ts

// TDD tests for feedback extractor
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_feedback_extractor } from './feedback_extractor.js';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock node:child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

// Helper to create a mock process
const mock_spawn = (stdout: string, code: number = 0) => {
  const proc = {
    stdout: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from(stdout));
      }),
    },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') {
        setTimeout(() => cb(code), 0);
      }
    }),
  };
  (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);
  return proc;
};

const mock_spawn_error = (error: Error) => {
  const proc = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'error') {
        setTimeout(() => cb(error), 0);
      }
    }),
  };
  (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);
};

describe('FeedbackExtractor', () => {
  let tmp_dir: string;
  let feedback_path: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmp_dir = join(tmpdir(), `fas-feedback-test-${Date.now()}`);
    mkdirSync(tmp_dir, { recursive: true });
    feedback_path = join(tmp_dir, 'feedback_dev_lessons.md');
    writeFileSync(feedback_path, '# Dev Lessons\n');
  });

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true });
  });

  it('should append lesson to feedback file on success', async () => {
    mock_spawn('자동화 작업 시 에러 핸들링을 반드시 먼저 구현해야 한다.');

    const extractor = create_feedback_extractor({
      feedback_path,
      gemini_command: 'gemini',
    });

    await extractor.extract('K-Startup 크롤링', 'Found 5 programs');

    const content = readFileSync(feedback_path, 'utf-8');
    expect(content).toContain('K-Startup 크롤링');
    expect(content).toContain('자동화 작업 시 에러 핸들링');
  });

  it('should not crash on Gemini CLI failure', async () => {
    mock_spawn('', 1);

    const extractor = create_feedback_extractor({
      feedback_path,
      gemini_command: 'gemini',
    });

    // Should not throw
    await extractor.extract('Failing task', 'Some output');

    // File should remain unchanged (only header)
    const content = readFileSync(feedback_path, 'utf-8');
    expect(content).toBe('# Dev Lessons\n');
  });

  it('should not crash on spawn error', async () => {
    mock_spawn_error(new Error('ENOENT'));

    const extractor = create_feedback_extractor({
      feedback_path,
      gemini_command: 'nonexistent',
    });

    await extractor.extract('Test', 'Output');

    const content = readFileSync(feedback_path, 'utf-8');
    expect(content).toBe('# Dev Lessons\n');
  });

  it('should skip excessively long responses', async () => {
    mock_spawn('x'.repeat(600));

    const extractor = create_feedback_extractor({
      feedback_path,
      gemini_command: 'gemini',
    });

    await extractor.extract('Test', 'Output');

    // Should not append (too long)
    const content = readFileSync(feedback_path, 'utf-8');
    expect(content).toBe('# Dev Lessons\n');
  });

  it('should include date in feedback entry', async () => {
    mock_spawn('배운 점이 있다.');

    const extractor = create_feedback_extractor({
      feedback_path,
      gemini_command: 'gemini',
    });

    await extractor.extract('Task', 'Done');

    const content = readFileSync(feedback_path, 'utf-8');
    // Should contain an ISO date like [2026-03-18]
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}\]/);
  });
});

---

## 파일: [OPS] src/captain/planning_loop.test.ts

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

---

## 파일: [OPS] src/gateway/cross_approval.test.ts

// TDD tests for cross-approval module (Gemini CLI)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_cross_approval } from './cross_approval.js';

// Mock node:child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

// Helper to create a mock process that emits stdout data and closes
const mock_spawn = (stdout: string, code: number = 0, stderr: string = '') => {
  const proc = {
    stdout: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from(stdout));
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data' && stderr) cb(Buffer.from(stderr));
      }),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') {
        // Use setTimeout to simulate async close
        setTimeout(() => cb(code), 0);
      }
    }),
  };
  (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);
  return proc;
};

// Helper to create a mock process that emits an error
const mock_spawn_error = (error: Error) => {
  const proc = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'error') {
        setTimeout(() => cb(error), 0);
      }
    }),
  };
  (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);
  return proc;
};

describe('CrossApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('request_approval()', () => {
    it('should return approved when Gemini approves', async () => {
      mock_spawn('{"decision": "approved", "reason": "Safe git commit"}');

      const approval = create_cross_approval({ gemini_command: 'gemini' });
      const result = await approval.request_approval('git commit', 'Committing docs update');

      expect(result.decision).toBe('approved');
      expect(result.reason).toBe('Safe git commit');
      expect(result.reviewed_by).toBe('gemini_a');
      expect(result.reviewed_at).toBeDefined();
    });

    it('should return rejected when Gemini rejects', async () => {
      mock_spawn('{"decision": "rejected", "reason": "Contains sensitive data"}');

      const approval = create_cross_approval();
      const result = await approval.request_approval('git push', 'Pushing to main');

      expect(result.decision).toBe('rejected');
      expect(result.reason).toBe('Contains sensitive data');
    });

    it('should handle JSON embedded in surrounding text', async () => {
      mock_spawn('Here is my response:\n{"decision": "approved", "reason": "Looks good"}\nDone.');

      const approval = create_cross_approval();
      const result = await approval.request_approval('file write', 'Writing config');

      expect(result.decision).toBe('approved');
      expect(result.reason).toBe('Looks good');
    });

    it('should auto-reject on invalid JSON response', async () => {
      mock_spawn('I think this is fine, go ahead!');

      const approval = create_cross_approval();
      const result = await approval.request_approval('deploy', 'Deploy to staging');

      expect(result.decision).toBe('rejected');
      expect(result.reason).toContain('Auto-rejected');
      expect(result.reviewed_by).toBe('system');
    });

    it('should auto-reject on invalid decision value', async () => {
      mock_spawn('{"decision": "maybe", "reason": "Not sure"}');

      const approval = create_cross_approval();
      const result = await approval.request_approval('deploy', 'Deploy');

      expect(result.decision).toBe('rejected');
      expect(result.reason).toContain('Auto-rejected');
    });

    it('should auto-reject on CLI error', async () => {
      mock_spawn('', 1, 'Command not found');

      const approval = create_cross_approval();
      const result = await approval.request_approval('action', 'context');

      expect(result.decision).toBe('rejected');
      expect(result.reason).toContain('Auto-rejected');
    });

    it('should auto-reject on spawn error', async () => {
      mock_spawn_error(new Error('ENOENT: gemini not found'));

      const approval = create_cross_approval();
      const result = await approval.request_approval('action', 'context');

      expect(result.decision).toBe('rejected');
      expect(result.reason).toContain('Auto-rejected');
    });

    it('should throw on error when auto_reject_on_error is false', async () => {
      mock_spawn('not json');

      const approval = create_cross_approval({ auto_reject_on_error: false });

      await expect(
        approval.request_approval('action', 'context'),
      ).rejects.toThrow();
    });

    it('should pass timeout to spawn', async () => {
      mock_spawn('{"decision": "approved", "reason": "ok"}');

      const approval = create_cross_approval({ timeout_ms: 30_000 });
      await approval.request_approval('action', 'context');

      expect(spawn).toHaveBeenCalledWith(
        'gemini',
        expect.any(Array),
        expect.objectContaining({ timeout: 30_000 }),
      );
    });
  });
});

---

## 파일: [OPS] src/gateway/mode_manager.test.ts

// TDD tests for SLEEP/AWAKE mode manager
import { describe, it, expect } from 'vitest';
import { create_mode_manager } from './mode_manager.js';

const DEFAULT_CONFIG = {
  sleep_start_hour: 23,
  sleep_end_hour: 7,
  sleep_end_minute: 30,
};

describe('ModeManager', () => {
  describe('get_state()', () => {
    it('should default to awake mode', () => {
      const mm = create_mode_manager(DEFAULT_CONFIG);
      const state = mm.get_state();
      expect(state.current_mode).toBe('awake');
      expect(state.switched_at).toBeDefined();
      expect(state.next_scheduled_switch).toBeDefined();
    });

    it('should respect initial_mode config', () => {
      const mm = create_mode_manager({ ...DEFAULT_CONFIG, initial_mode: 'sleep' });
      expect(mm.get_state().current_mode).toBe('sleep');
    });
  });

  describe('transition()', () => {
    it('should switch from awake to sleep', () => {
      const mm = create_mode_manager(DEFAULT_CONFIG);
      const result = mm.transition({ target_mode: 'sleep', reason: 'bedtime', requested_by: 'cron' });

      expect(result.success).toBe(true);
      expect(result.previous_mode).toBe('awake');
      expect(result.current_mode).toBe('sleep');
      expect(mm.get_state().current_mode).toBe('sleep');
      expect(mm.get_state().switched_by).toBe('cron');
    });

    it('should switch from sleep to awake', () => {
      const mm = create_mode_manager({ ...DEFAULT_CONFIG, initial_mode: 'sleep' });
      const result = mm.transition({ target_mode: 'awake', reason: 'morning', requested_by: 'cron' });

      expect(result.success).toBe(true);
      expect(result.previous_mode).toBe('sleep');
      expect(result.current_mode).toBe('awake');
    });

    it('should handle same-mode transition as no-op', () => {
      const mm = create_mode_manager(DEFAULT_CONFIG);
      const result = mm.transition({ target_mode: 'awake', reason: 'already awake', requested_by: 'api' });

      expect(result.success).toBe(true);
      expect(result.previous_mode).toBe('awake');
      expect(result.current_mode).toBe('awake');
      expect(result.reason).toContain('Already');
    });

    it('should update next_scheduled_switch after transition', () => {
      const mm = create_mode_manager(DEFAULT_CONFIG);
      const before = mm.get_state().next_scheduled_switch;
      mm.transition({ target_mode: 'sleep', reason: 'test', requested_by: 'api' });
      const after = mm.get_state().next_scheduled_switch;

      expect(after).not.toBe(before);
    });
  });

  describe('is_action_allowed()', () => {
    it('should allow all actions in awake mode', () => {
      const mm = create_mode_manager(DEFAULT_CONFIG);

      expect(mm.is_action_allowed('git_push', 'high')).toBe(true);
      expect(mm.is_action_allowed('deploy', 'critical')).toBe(true);
      expect(mm.is_action_allowed('file_read', 'low')).toBe(true);
      expect(mm.is_action_allowed('file_write', 'mid')).toBe(true);
    });

    it('should block high risk actions in sleep mode', () => {
      const mm = create_mode_manager({ ...DEFAULT_CONFIG, initial_mode: 'sleep' });

      expect(mm.is_action_allowed('anything', 'high')).toBe(false);
      expect(mm.is_action_allowed('anything', 'critical')).toBe(false);
    });

    it('should block specific actions in sleep mode even at low/mid risk', () => {
      const mm = create_mode_manager({ ...DEFAULT_CONFIG, initial_mode: 'sleep' });

      expect(mm.is_action_allowed('git_push', 'mid')).toBe(false);
      expect(mm.is_action_allowed('deploy', 'mid')).toBe(false);
      expect(mm.is_action_allowed('pr_creation', 'low')).toBe(false);
      expect(mm.is_action_allowed('external_api_call', 'low')).toBe(false);
    });

    it('should allow safe actions in sleep mode', () => {
      const mm = create_mode_manager({ ...DEFAULT_CONFIG, initial_mode: 'sleep' });

      expect(mm.is_action_allowed('file_read', 'low')).toBe(true);
      expect(mm.is_action_allowed('web_search', 'low')).toBe(true);
      expect(mm.is_action_allowed('crawling', 'low')).toBe(true);
      expect(mm.is_action_allowed('file_write', 'mid')).toBe(true);
      expect(mm.is_action_allowed('git_commit', 'mid')).toBe(true);
    });
  });
});

---

## 파일: [OPS] src/gateway/rate_limiter.test.ts

// TDD tests for rate limiter
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_rate_limiter } from './rate_limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow requests within the limit', () => {
    // Given
    const limiter = create_rate_limiter({ window_ms: 60_000, max_requests: 3 });

    // When / Then
    expect(limiter.is_allowed()).toBe(true);
    expect(limiter.is_allowed()).toBe(true);
    expect(limiter.is_allowed()).toBe(true);
  });

  it('should reject requests exceeding the limit', () => {
    // Given
    const limiter = create_rate_limiter({ window_ms: 60_000, max_requests: 2 });

    // When
    limiter.is_allowed(); // 1st
    limiter.is_allowed(); // 2nd

    // Then
    expect(limiter.is_allowed()).toBe(false); // 3rd — rejected
  });

  it('should allow requests again after the window expires', () => {
    // Given
    const limiter = create_rate_limiter({ window_ms: 1_000, max_requests: 1 });
    limiter.is_allowed(); // 1st — allowed

    // When — advance past the window
    vi.advanceTimersByTime(1_001);

    // Then — should allow again
    expect(limiter.is_allowed()).toBe(true);
  });

  it('should track remaining requests', () => {
    // Given
    const limiter = create_rate_limiter({ window_ms: 60_000, max_requests: 3 });

    // When / Then
    expect(limiter.remaining()).toBe(3);
    limiter.is_allowed();
    expect(limiter.remaining()).toBe(2);
    limiter.is_allowed();
    expect(limiter.remaining()).toBe(1);
    limiter.is_allowed();
    expect(limiter.remaining()).toBe(0);
  });

  it('should reset all tracked requests', () => {
    // Given
    const limiter = create_rate_limiter({ window_ms: 60_000, max_requests: 1 });
    limiter.is_allowed();
    expect(limiter.is_allowed()).toBe(false);

    // When
    limiter.reset();

    // Then
    expect(limiter.is_allowed()).toBe(true);
  });
});

---

## 파일: [OPS] src/gateway/sanitizer.test.ts

// TDD tests for PII sanitizer
import { describe, it, expect } from 'vitest';
import { sanitize_text, sanitize_task, contains_pii, detect_pii_types, type HunterSafeTask } from './sanitizer.js';
import type { Task } from '../shared/types.js';

describe('Sanitizer', () => {
  // === sanitize_text() ===

  describe('sanitize_text()', () => {
    it('should remove phone numbers', () => {
      expect(sanitize_text('연락처: 010-1234-5678')).toBe('연락처: [전화번호 제거됨]');
      expect(sanitize_text('전화 01012345678')).toBe('전화 [전화번호 제거됨]');
    });

    it('should remove phone numbers with spaces around hyphens', () => {
      expect(sanitize_text('전화 010 - 1234 - 5678')).toBe('전화 [전화번호 제거됨]');
      expect(sanitize_text('연락처 010 -1234- 5678')).toBe('연락처 [전화번호 제거됨]');
    });

    it('should remove email addresses', () => {
      expect(sanitize_text('이메일: user@example.com')).toBe('이메일: [이메일 제거됨]');
    });

    it('should remove Korean resident IDs', () => {
      expect(sanitize_text('주민번호 900101-1234567')).toBe('주민번호 [주민번호 제거됨]');
      expect(sanitize_text('9001011234567')).toBe('[주민번호 제거됨]');
    });

    it('should remove Korean addresses', () => {
      expect(sanitize_text('주소: 서울시 강남구')).toBe('주소: [주소 제거됨]');
      expect(sanitize_text('경기 성남시')).toBe('[주소 제거됨]');
    });

    it('should remove bank account numbers', () => {
      expect(sanitize_text('계좌 110-123-456789')).toBe('계좌 [계좌 제거됨]');
    });

    it('should remove bank account numbers with spaces around hyphens', () => {
      expect(sanitize_text('계좌 110 - 123 - 456789')).toBe('계좌 [계좌 제거됨]');
    });

    it('should remove financial amounts with labels', () => {
      expect(sanitize_text('연봉 약 5000만')).toBe('[금융정보 제거됨]');
      expect(sanitize_text('보증금: 3억')).toBe('[금융정보 제거됨]');
    });

    it('should remove labeled Korean names', () => {
      expect(sanitize_text('이름: 홍길동')).toContain('[이름 제거됨]');
      expect(sanitize_text('성명：김철수')).toContain('[이름 제거됨]');
    });

    it('should remove credit card numbers', () => {
      expect(sanitize_text('카드 1234-5678-9012-3456')).toBe('카드 [카드번호 제거됨]');
      expect(sanitize_text('카드 1234 5678 9012 3456')).toBe('카드 [카드번호 제거됨]');
    });

    it('should remove credit card numbers with spaces around separators', () => {
      expect(sanitize_text('카드 1234 - 5678 - 9012 - 3456')).toBe('카드 [카드번호 제거됨]');
    });

    it('should remove internal IP addresses', () => {
      expect(sanitize_text('서버 [MASKED_IP]에 접속')).toBe('서버 [IP 제거됨]에 접속');
      expect(sanitize_text('http://[MASKED_IP]:3100')).toBe('http://[IP 제거됨]:3100');
      expect(sanitize_text('[MASKED_IP] 연결')).toBe('[IP 제거됨] 연결');
    });

    it('should not remove public IP addresses', () => {
      // 8.8.8.8 is a public IP — should not match private/Tailscale ranges
      expect(sanitize_text('DNS: 8.8.8.8')).toBe('DNS: 8.8.8.8');
    });

    it('should remove internal URLs (*.local, *.internal, *.ts.net)', () => {
      expect(sanitize_text('접속: http://captain.local:3100/api/tasks'))
        .toBe('접속: [내부URL 제거됨]');
      expect(sanitize_text('URL: https://fas.internal/dashboard'))
        .toBe('URL: [내부URL 제거됨]');
      expect(sanitize_text('http://hunter.tailnet:8080'))
        .toBe('[내부URL 제거됨]');
      expect(sanitize_text('http://my-device.ts.net/path'))
        .toBe('[내부URL 제거됨]');
    });

    it('should remove localhost URLs', () => {
      expect(sanitize_text('서버 http://localhost:3100에서 실행'))
        .toBe('서버 [내부URL 제거됨]에서 실행');
    });

    it('should not remove public URLs', () => {
      expect(sanitize_text('https://github.com/repo')).toBe('https://github.com/repo');
      expect(sanitize_text('https://k-startup.go.kr')).toBe('https://k-startup.go.kr');
    });

    it('should not modify text without PII', () => {
      const clean_text = 'K-Startup 창업지원사업 검색 결과 3건';
      expect(sanitize_text(clean_text)).toBe(clean_text);
    });

    it('should handle multiple PII types in one text', () => {
      const text = '이름: 홍길동, 연락처: 010-1234-5678, 이메일: hong@test.com';
      const result = sanitize_text(text);

      expect(result).toContain('[이름 제거됨]');
      expect(result).toContain('[전화번호 제거됨]');
      expect(result).toContain('[이메일 제거됨]');
      expect(result).not.toContain('홍길동');
      expect(result).not.toContain('010-1234-5678');
      expect(result).not.toContain('hong@test.com');
    });
  });

  // === sanitize_task() ===

  describe('sanitize_task()', () => {
    const make_task = (overrides: Partial<Task> = {}): Task => ({
      id: 'test_001',
      title: 'Research task',
      description: 'Find startup programs',
      priority: 'medium',
      assigned_to: 'openclaw',
      mode: 'awake',
      risk_level: 'low',
      requires_personal_info: false,
      status: 'pending',
      created_at: '2026-03-17T00:00:00Z',
      deadline: null,
      depends_on: [],
      ...overrides,
    });

    it('should sanitize title and description', () => {
      const task = make_task({
        title: '이름: 홍길동의 청약 조회',
        description: '연락처 010-1234-5678로 결과 전달',
      });

      const sanitized = sanitize_task(task);

      expect(sanitized.title).toContain('[이름 제거됨]');
      expect(sanitized.description).toContain('[전화번호 제거됨]');
    });

    it('should only include whitelisted fields', () => {
      const task = make_task({
        title: 'Test',
        requires_personal_info: true,
        assigned_to: 'openclaw',
      });
      const sanitized = sanitize_task(task) as Record<string, unknown>;

      // Whitelisted fields should exist
      expect(sanitized.id).toBeDefined();
      expect(sanitized.title).toBeDefined();
      expect(sanitized.priority).toBeDefined();

      // Non-whitelisted fields should NOT exist
      expect(sanitized).not.toHaveProperty('requires_personal_info');
      expect(sanitized).not.toHaveProperty('assigned_to');
      expect(sanitized).not.toHaveProperty('depends_on');
      expect(sanitized).not.toHaveProperty('output');
    });

    it('should not mutate the original task', () => {
      const task = make_task({ title: '이름: 홍길동' });
      sanitize_task(task);

      expect(task.title).toBe('이름: 홍길동');
    });
  });

  // === contains_pii() ===

  describe('contains_pii()', () => {
    it('should return true for text with PII', () => {
      expect(contains_pii('전화 010-1234-5678')).toBe(true);
      expect(contains_pii('user@test.com')).toBe(true);
    });

    it('should return false for clean text', () => {
      expect(contains_pii('K-Startup 검색')).toBe(false);
    });

    it('should return consistent results on repeated calls (lastIndex reset)', () => {
      // Global regex .test() advances lastIndex — calling twice could return false without reset
      const text = '전화 010-1234-5678';
      expect(contains_pii(text)).toBe(true);
      expect(contains_pii(text)).toBe(true);
      expect(contains_pii(text)).toBe(true);
    });
  });

  // === detect_pii_types() ===

  describe('detect_pii_types()', () => {
    it('should detect all PII types present', () => {
      const text = '연락처: 010-1234-5678, 이메일: test@test.com';
      const types = detect_pii_types(text);

      expect(types).toContain('phone_number');
      expect(types).toContain('email');
      expect(types).not.toContain('resident_id');
    });

    it('should return empty array for clean text', () => {
      expect(detect_pii_types('no PII here')).toEqual([]);
    });
  });
});

---

## 파일: [OPS] src/gateway/server.test.ts

// TDD tests for Gateway + Task API server
// Covers: CRUD, Hunter API, authentication, rate limiting, quarantine, schema validation
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { create_app } from './server.js';
import { create_task_store, type TaskStore } from './task_store.js';

// === Test helpers ===

const TEST_API_KEY = 'test-hunter-secret-key-abc123';

const create_test_app = (opts: { with_auth?: boolean; dev_mode?: boolean } = {}) => {
  const store = create_task_store({ db_path: ':memory:' });
  const app = create_app(store, {
    hunter_api_key: opts.with_auth ? TEST_API_KEY : undefined,
    dev_mode: opts.dev_mode ?? true,  // Default to dev mode for tests
    rate_limit_window_ms: 60_000,
    rate_limit_max_requests: 30,
    max_output_length: 1_000,  // Small limit for testing
    max_files_count: 3,
  });
  return { store, app };
};

// Helper to send authenticated hunter requests
const hunter_get = (app: ReturnType<typeof create_app>, path: string) =>
  request(app).get(path).set('x-hunter-api-key', TEST_API_KEY);

const hunter_post = (app: ReturnType<typeof create_app>, path: string) =>
  request(app).post(path).set('x-hunter-api-key', TEST_API_KEY);

describe('Gateway Server', () => {
  let store: TaskStore;
  let app: ReturnType<typeof create_app>;

  beforeEach(() => {
    ({ store, app } = create_test_app());
  });

  afterEach(() => {
    store.close();
  });

  // === Health check ===

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
      expect(res.body.hunter_alive).toBe(false);
      expect(res.body.timestamp).toBeDefined();
    });
  });

  // === Task CRUD ===

  describe('POST /api/tasks', () => {
    it('should create a task', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Crawl K-Startup', assigned_to: 'gemini_a' });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.title).toBe('Crawl K-Startup');
      expect(res.body.status).toBe('pending');
    });

    it('should reject task without title', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({ assigned_to: 'claude' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('title');
    });

    it('should reject task without assigned_to', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/tasks', () => {
    it('should list all tasks', async () => {
      await request(app).post('/api/tasks').send({ title: 'A', assigned_to: 'claude' });
      await request(app).post('/api/tasks').send({ title: 'B', assigned_to: 'claude' });

      const res = await request(app).get('/api/tasks');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
      expect(res.body.tasks.length).toBe(2);
    });

    it('should filter by status', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'A', assigned_to: 'claude' });

      await request(app)
        .post(`/api/tasks/${create_res.body.id}/complete`)
        .send({ summary: 'Done' });

      await request(app).post('/api/tasks').send({ title: 'B', assigned_to: 'claude' });

      const pending_res = await request(app).get('/api/tasks?status=pending');
      expect(pending_res.body.count).toBe(1);
      expect(pending_res.body.tasks[0].title).toBe('B');

      const done_res = await request(app).get('/api/tasks?status=done');
      expect(done_res.body.count).toBe(1);
    });
  });

  describe('GET /api/tasks/:id', () => {
    it('should return task by id', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'claude' });

      const res = await request(app).get(`/api/tasks/${create_res.body.id}`);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Test');
    });

    it('should return 404 for non-existent task', async () => {
      const res = await request(app).get('/api/tasks/non-existent');
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/tasks/:id/status', () => {
    it('should update task status', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'claude' });

      const res = await request(app)
        .patch(`/api/tasks/${create_res.body.id}/status`)
        .send({ status: 'in_progress' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('in_progress');
    });
  });

  describe('POST /api/tasks/:id/complete', () => {
    it('should complete task with output', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Research', assigned_to: 'gemini_a' });

      const res = await request(app)
        .post(`/api/tasks/${create_res.body.id}/complete`)
        .send({
          summary: 'Found 5 results',
          files_created: ['report.md'],
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('done');
      expect(res.body.output.summary).toBe('Found 5 results');
    });
  });

  describe('POST /api/tasks/:id/block', () => {
    it('should block task with reason', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Deploy', assigned_to: 'claude' });

      const res = await request(app)
        .post(`/api/tasks/${create_res.body.id}/block`)
        .send({ reason: 'API key missing' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('blocked');
    });
  });

  // === Hunter API (no auth mode) ===

  describe('GET /api/hunter/tasks/pending', () => {
    it('should return sanitized pending tasks for openclaw', async () => {
      await request(app).post('/api/tasks').send({
        title: '이름: 홍길동 학생 정보 조회',
        assigned_to: 'openclaw',
      });
      await request(app).post('/api/tasks').send({
        title: 'Claude task',
        assigned_to: 'claude',
      });

      const res = await request(app).get('/api/hunter/tasks/pending');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.tasks[0].title).toContain('[이름 제거됨]');
      expect(res.body.tasks[0].title).not.toContain('홍길동');
    });

    it('should only include whitelisted fields (no assigned_to, depends_on, etc.)', async () => {
      await request(app).post('/api/tasks').send({
        title: 'Safe crawl task',
        assigned_to: 'openclaw',
        requires_personal_info: false,
      });

      const res = await request(app).get('/api/hunter/tasks/pending');

      expect(res.body.count).toBe(1);
      const task = res.body.tasks[0];
      expect(task.id).toBeDefined();
      expect(task.title).toBeDefined();
      expect(task.priority).toBeDefined();
      expect(task).not.toHaveProperty('assigned_to');
      expect(task).not.toHaveProperty('requires_personal_info');
      expect(task).not.toHaveProperty('depends_on');
      expect(task).not.toHaveProperty('output');
      expect(task).not.toHaveProperty('created_at');
    });

    it('should filter out tasks requiring personal info', async () => {
      await request(app).post('/api/tasks').send({
        title: 'Safe task',
        assigned_to: 'openclaw',
        requires_personal_info: false,
      });
      await request(app).post('/api/tasks').send({
        title: 'PII task',
        assigned_to: 'openclaw',
        requires_personal_info: true,
      });

      const res = await request(app).get('/api/hunter/tasks/pending');

      expect(res.body.count).toBe(1);
      expect(res.body.tasks[0].title).toBe('Safe task');
    });
  });

  describe('POST /api/hunter/tasks/:id/result', () => {
    it('should mark task as done on success', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Research', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({ status: 'success', output: 'Found 3 items' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const task_res = await request(app).get(`/api/tasks/${create_res.body.id}`);
      expect(task_res.body.status).toBe('done');
    });

    it('should quarantine result with PII instead of auto-sanitizing', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Crawl task', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({ status: 'success', output: '결과: 이름: 홍길동, 전화 010-1234-5678' });

      // Should return 202 (quarantined), not 200
      expect(res.status).toBe(202);
      expect(res.body.quarantined).toBe(true);
      expect(res.body.detected_types).toContain('labeled_korean_name');
      expect(res.body.detected_types).toContain('phone_number');

      // Task should be quarantined, not done
      const task_res = await request(app).get(`/api/tasks/${create_res.body.id}`);
      expect(task_res.body.status).toBe('quarantined');
      // Stored output should contain sanitized preview (no raw PII)
      expect(task_res.body.output.summary).toContain('[QUARANTINED]');
      expect(task_res.body.output.summary).not.toContain('홍길동');
      expect(task_res.body.output.summary).not.toContain('010-1234-5678');
    });

    it('should mark task as blocked on failure', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Failing task', assigned_to: 'openclaw' });

      await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({ status: 'failure', output: 'Timeout' });

      const task_res = await request(app).get(`/api/tasks/${create_res.body.id}`);
      expect(task_res.body.status).toBe('blocked');
    });
  });

  describe('POST /api/hunter/heartbeat', () => {
    it('should acknowledge heartbeat', async () => {
      const res = await request(app).post('/api/hunter/heartbeat');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.server_time).toBeDefined();
    });

    it('should update hunter_alive in health check', async () => {
      await request(app).post('/api/hunter/heartbeat');

      const health = await request(app).get('/api/health');
      expect(health.body.hunter_alive).toBe(true);
    });
  });

  // === Stats ===

  describe('GET /api/stats', () => {
    it('should return task statistics', async () => {
      await request(app).post('/api/tasks').send({ title: 'A', assigned_to: 'claude' });
      const b = await request(app).post('/api/tasks').send({ title: 'B', assigned_to: 'claude' });
      await request(app).post(`/api/tasks/${b.body.id}/complete`).send({ summary: 'Done' });

      const res = await request(app).get('/api/stats');

      expect(res.status).toBe(200);
      expect(res.body.pending).toBe(1);
      expect(res.body.done).toBe(1);
    });

    it('should include quarantined count', async () => {
      const res = await request(app).get('/api/stats');
      expect(res.body.quarantined).toBe(0);
    });
  });

  // === Hunter API Authentication ===

  describe('Hunter API key authentication', () => {
    let auth_store: TaskStore;
    let auth_app: ReturnType<typeof create_app>;

    beforeEach(() => {
      ({ store: auth_store, app: auth_app } = create_test_app({ with_auth: true }));
    });

    afterEach(() => {
      auth_store.close();
    });

    it('should reject hunter requests without API key', async () => {
      const res = await request(auth_app).get('/api/hunter/tasks/pending');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('AUTH_ERROR');
    });

    it('should reject hunter requests with wrong API key', async () => {
      const res = await request(auth_app)
        .get('/api/hunter/tasks/pending')
        .set('x-hunter-api-key', 'wrong-key');
      expect(res.status).toBe(401);
    });

    it('should allow hunter requests with correct API key', async () => {
      const res = await hunter_get(auth_app, '/api/hunter/tasks/pending');
      expect(res.status).toBe(200);
    });

    it('should require auth for heartbeat', async () => {
      const res = await request(auth_app).post('/api/hunter/heartbeat');
      expect(res.status).toBe(401);

      const auth_res = await hunter_post(auth_app, '/api/hunter/heartbeat');
      expect(auth_res.status).toBe(200);
    });

    it('should require auth for result submission', async () => {
      // Create a task first (captain API — no auth needed)
      const create_res = await request(auth_app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      // Submit without auth — should fail
      const res = await request(auth_app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({ status: 'success', output: 'Done' });
      expect(res.status).toBe(401);

      // Submit with auth — should succeed
      const auth_res = await hunter_post(auth_app, `/api/hunter/tasks/${create_res.body.id}/result`)
        .send({ status: 'success', output: 'Done' });
      expect(auth_res.status).toBe(200);
    });

    it('should reject hunter requests when no API key and no dev mode', async () => {
      const { store: strict_store, app: strict_app } = create_test_app({ dev_mode: false });

      const res = await request(strict_app).get('/api/hunter/tasks/pending');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('AUTH_ERROR');
      expect(res.body.message).toContain('not configured');

      strict_store.close();
    });

    it('should NOT require auth for captain endpoints', async () => {
      // Captain endpoints should work without API key even when auth is enabled
      const res = await request(auth_app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'claude' });
      expect(res.status).toBe(201);

      const health = await request(auth_app).get('/api/health');
      expect(health.status).toBe(200);
    });
  });

  // === Schema Validation ===

  describe('Hunter result schema validation', () => {
    it('should reject invalid result status', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({ status: 'invalid_status', output: 'Test' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('status');
    });

    it('should reject non-string output', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({ status: 'success', output: { nested: 'object' } });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('output must be a string');
    });

    it('should reject output exceeding max length', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      // Our test app has max_output_length = 1000
      const long_output = 'x'.repeat(1_001);
      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({ status: 'success', output: long_output });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('max length');
    });

    it('should reject files exceeding max count', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      // Our test app has max_files_count = 3
      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({
          status: 'success',
          output: 'Done',
          files: ['a.md', 'b.md', 'c.md', 'd.md'],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('max count');
    });

    it('should reject files with path traversal', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({
          status: 'success',
          output: 'Done',
          files: ['../../etc/passwd'],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('..');
    });

    it('should reject files with absolute paths', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({
          status: 'success',
          output: 'Done',
          files: ['/etc/shadow'],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('"/"');
    });

    it('should reject files with disallowed extensions', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({
          status: 'success',
          output: 'Done',
          files: ['malware.exe'],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('.exe');
      expect(res.body.details.allowed).toBeDefined();
    });

    it('should allow files with permitted extensions', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({
          status: 'success',
          output: 'Done',
          files: ['report.md', 'data.json', 'results.csv'],
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('should reject non-array files', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({
          status: 'success',
          output: 'Done',
          files: 'not-an-array',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('array');
    });
  });

  // === Rate Limiting ===

  describe('Hunter rate limiting', () => {
    it('should enforce rate limits on hunter endpoints', async () => {
      // Create app with very low rate limit for testing
      const rl_store = create_task_store({ db_path: ':memory:' });
      const rl_app = create_app(rl_store, {
        dev_mode: true,
        rate_limit_window_ms: 60_000,
        rate_limit_max_requests: 2,  // Only 2 requests per minute
      });

      // 1st and 2nd requests — allowed
      const res1 = await request(rl_app).get('/api/hunter/tasks/pending');
      expect(res1.status).toBe(200);

      const res2 = await request(rl_app).post('/api/hunter/heartbeat');
      expect(res2.status).toBe(200);

      // 3rd request — rate limited
      const res3 = await request(rl_app).get('/api/hunter/tasks/pending');
      expect(res3.status).toBe(429);
      expect(res3.body.error).toBe('RATE_LIMIT');

      rl_store.close();
    });

    it('should not rate limit captain endpoints', async () => {
      const rl_store = create_task_store({ db_path: ':memory:' });
      const rl_app = create_app(rl_store, {
        dev_mode: true,
        rate_limit_window_ms: 60_000,
        rate_limit_max_requests: 1,  // Very strict — 1 request per minute
      });

      // Use up the rate limit on hunter endpoint
      await request(rl_app).get('/api/hunter/tasks/pending');

      // Captain endpoints should still work
      const health = await request(rl_app).get('/api/health');
      expect(health.status).toBe(200);

      const tasks = await request(rl_app).get('/api/tasks');
      expect(tasks.status).toBe(200);

      rl_store.close();
    });
  });

  // === Agent Healthcheck API ===

  describe('Agent Healthcheck API', () => {
    it('should register agent heartbeat', async () => {
      const res = await request(app).post('/api/agents/claude/heartbeat');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('should return all agent statuses', async () => {
      await request(app).post('/api/agents/claude/heartbeat');
      await request(app).post('/api/agents/gemini_a/heartbeat');

      const res = await request(app).get('/api/agents/health');
      expect(res.status).toBe(200);
      expect(res.body.agents.length).toBe(2);
      expect(res.body.agents[0].status).toBe('running');
    });

    it('should report and track agent crash', async () => {
      await request(app).post('/api/agents/claude/heartbeat');
      const crash_res = await request(app).post('/api/agents/claude/crash');
      expect(crash_res.body.crash_count).toBe(1);

      await request(app).post('/api/agents/claude/crash');
      const crash_res2 = await request(app).post('/api/agents/claude/crash');
      expect(crash_res2.body.crash_count).toBe(3);
    });

    it('should track crash for unknown agent', async () => {
      const res = await request(app).post('/api/agents/unknown_agent/crash');
      expect(res.status).toBe(200);
      expect(res.body.crash_count).toBe(1);
    });

    it('should sync hunter heartbeat to agent_heartbeats', async () => {
      await request(app).post('/api/hunter/heartbeat');
      const health = await request(app).get('/api/agents/health');
      const openclaw = health.body.agents.find((a: { name: string }) => a.name === 'openclaw');
      expect(openclaw).toBeDefined();
      expect(openclaw.status).toBe('running');
    });
  });

  // === Mode Management API ===

  describe('Mode Management API', () => {
    it('should return current mode', async () => {
      const res = await request(app).get('/api/mode');
      expect(res.status).toBe(200);
      expect(res.body.current_mode).toBe('awake');
      expect(res.body.switched_at).toBeDefined();
    });

    it('should switch to sleep mode', async () => {
      const res = await request(app).post('/api/mode').send({
        target_mode: 'sleep',
        reason: 'bedtime',
        requested_by: 'cron',
      });
      expect(res.status).toBe(200);
      expect(res.body.previous_mode).toBe('awake');
      expect(res.body.current_mode).toBe('sleep');

      const mode_res = await request(app).get('/api/mode');
      expect(mode_res.body.current_mode).toBe('sleep');
    });

    it('should reject invalid target_mode', async () => {
      const res = await request(app).post('/api/mode').send({ target_mode: 'invalid' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('should reflect mode in health check', async () => {
      await request(app).post('/api/mode').send({ target_mode: 'sleep' });
      const health = await request(app).get('/api/health');
      expect(health.body.mode).toBe('sleep');
    });
  });

  // === Cross-Approval API ===

  describe('Cross-Approval API', () => {
    it('should auto-approve low risk actions', async () => {
      const res = await request(app).post('/api/approval/request').send({
        action: 'file_read',
        risk_level: 'low',
      });
      expect(res.status).toBe(200);
      expect(res.body.decision).toBe('approved');
    });

    it('should require human approval for high risk', async () => {
      const res = await request(app).post('/api/approval/request').send({
        action: 'git_push',
        risk_level: 'high',
      });
      expect(res.status).toBe(200);
      expect(res.body.decision).toBe('needs_human_approval');
    });

    it('should auto-approve mid risk when no cross-approval configured', async () => {
      const res = await request(app).post('/api/approval/request').send({
        action: 'file_write',
        risk_level: 'mid',
        context: 'writing config file',
      });
      expect(res.status).toBe(200);
      expect(res.body.decision).toBe('approved');
      expect(res.body.reason).toContain('no cross-approval');
    });

    it('should reject when mode violation (sleep + high risk)', async () => {
      await request(app).post('/api/mode').send({ target_mode: 'sleep' });

      const res = await request(app).post('/api/approval/request').send({
        action: 'git_push',
        risk_level: 'high',
      });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('MODE_VIOLATION');
    });

    it('should reject missing required fields', async () => {
      const res = await request(app).post('/api/approval/request').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });
});

---

## 파일: [OPS] src/gateway/task_store.test.ts

// TDD tests for SQLite task store
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { create_task_store, type TaskStore } from './task_store.js';

describe('TaskStore', () => {
  let store: TaskStore;

  beforeEach(() => {
    // Use in-memory database for each test
    store = create_task_store({ db_path: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  // === create() ===

  describe('create()', () => {
    it('should create a task with generated id and pending status', () => {
      const task = store.create({
        title: 'Crawl K-Startup',
        assigned_to: 'gemini_a',
      });

      expect(task.id).toBeDefined();
      expect(task.id.length).toBe(36); // UUID v4
      expect(task.title).toBe('Crawl K-Startup');
      expect(task.assigned_to).toBe('gemini_a');
      expect(task.status).toBe('pending');
      expect(task.priority).toBe('medium');
      expect(task.risk_level).toBe('low');
      expect(task.requires_personal_info).toBe(false);
      expect(task.depends_on).toEqual([]);
      expect(task.created_at).toBeDefined();
    });

    it('should create a task with all optional fields', () => {
      const task = store.create({
        title: 'Generate test paper',
        description: 'Physics unit 3 for advanced class',
        priority: 'high',
        assigned_to: 'claude',
        mode: 'awake',
        risk_level: 'mid',
        requires_personal_info: true,
        deadline: '2026-03-20',
        depends_on: ['task_001'],
      });

      expect(task.description).toBe('Physics unit 3 for advanced class');
      expect(task.priority).toBe('high');
      expect(task.mode).toBe('awake');
      expect(task.risk_level).toBe('mid');
      expect(task.requires_personal_info).toBe(true);
      expect(task.deadline).toBe('2026-03-20');
      expect(task.depends_on).toEqual(['task_001']);
    });
  });

  // === get_by_id() ===

  describe('get_by_id()', () => {
    it('should return task by id', () => {
      const created = store.create({ title: 'Test', assigned_to: 'claude' });
      const found = store.get_by_id(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.title).toBe('Test');
    });

    it('should return null for non-existent id', () => {
      const found = store.get_by_id('non-existent');
      expect(found).toBeNull();
    });
  });

  // === get_by_status() ===

  describe('get_by_status()', () => {
    it('should return tasks filtered by status', () => {
      store.create({ title: 'Task A', assigned_to: 'claude' });
      store.create({ title: 'Task B', assigned_to: 'gemini_a' });
      const task_c = store.create({ title: 'Task C', assigned_to: 'claude' });
      store.update_status(task_c.id, 'in_progress');

      const pending = store.get_by_status('pending');
      const in_progress = store.get_by_status('in_progress');

      expect(pending.length).toBe(2);
      expect(in_progress.length).toBe(1);
      expect(in_progress[0].title).toBe('Task C');
    });
  });

  // === get_pending_for_agent() ===

  describe('get_pending_for_agent()', () => {
    it('should return only pending tasks for specified agent', () => {
      store.create({ title: 'Claude task', assigned_to: 'claude' });
      store.create({ title: 'Gemini task', assigned_to: 'gemini_a' });
      const done_task = store.create({ title: 'Done Claude task', assigned_to: 'claude' });
      store.complete_task(done_task.id, { summary: 'Done' });

      const claude_pending = store.get_pending_for_agent('claude');

      expect(claude_pending.length).toBe(1);
      expect(claude_pending[0].title).toBe('Claude task');
    });
  });

  // === update_status() ===

  describe('update_status()', () => {
    it('should update task status', () => {
      const task = store.create({ title: 'Test', assigned_to: 'claude' });

      const result = store.update_status(task.id, 'in_progress');
      expect(result).toBe(true);

      const updated = store.get_by_id(task.id);
      expect(updated!.status).toBe('in_progress');
    });

    it('should return false for non-existent task', () => {
      const result = store.update_status('non-existent', 'done');
      expect(result).toBe(false);
    });
  });

  // === complete_task() ===

  describe('complete_task()', () => {
    it('should mark task as done with output', () => {
      const task = store.create({ title: 'Research', assigned_to: 'gemini_a' });

      const result = store.complete_task(task.id, {
        summary: 'Found 5 startup programs',
        files_created: ['reports/startup_2026-03-17.md'],
      });

      expect(result).toBe(true);

      const completed = store.get_by_id(task.id);
      expect(completed!.status).toBe('done');
      expect(completed!.output).toBeDefined();
      expect(completed!.output!.summary).toBe('Found 5 startup programs');
      expect(completed!.output!.files_created).toEqual(['reports/startup_2026-03-17.md']);
      expect(completed!.completed_at).toBeDefined();
    });
  });

  // === block_task() ===

  describe('block_task()', () => {
    it('should mark task as blocked with reason', () => {
      const task = store.create({ title: 'Deploy', assigned_to: 'claude' });

      store.block_task(task.id, 'API key missing');

      const blocked = store.get_by_id(task.id);
      expect(blocked!.status).toBe('blocked');
      expect(blocked!.output!.summary).toBe('API key missing');
    });
  });

  // === get_stats() ===

  describe('get_stats()', () => {
    it('should return task counts by status', () => {
      store.create({ title: 'A', assigned_to: 'claude' });
      store.create({ title: 'B', assigned_to: 'claude' });
      const c = store.create({ title: 'C', assigned_to: 'claude' });
      store.complete_task(c.id, { summary: 'Done' });
      const d = store.create({ title: 'D', assigned_to: 'claude' });
      store.block_task(d.id, 'Blocked');

      const stats = store.get_stats();

      expect(stats.pending).toBe(2);
      expect(stats.done).toBe(1);
      expect(stats.blocked).toBe(1);
    });
  });

  // === get_all() ===

  describe('get_all()', () => {
    it('should return all tasks', () => {
      store.create({ title: 'First', assigned_to: 'claude' });
      store.create({ title: 'Second', assigned_to: 'claude' });

      const all = store.get_all();

      expect(all.length).toBe(2);
      const titles = all.map((t) => t.title);
      expect(titles).toContain('First');
      expect(titles).toContain('Second');
    });
  });

  // === busy_timeout ===

  describe('busy_timeout', () => {
    it('should configure busy_timeout via config', () => {
      const custom_store = create_task_store({ db_path: ':memory:', busy_timeout_ms: 10000 });
      const timeout = custom_store._db.pragma('busy_timeout') as { timeout: number }[];
      expect(timeout[0].timeout).toBe(10000);
      custom_store.close();
    });

    it('should default to 5000ms busy_timeout', () => {
      const timeout = store._db.pragma('busy_timeout') as { timeout: number }[];
      expect(timeout[0].timeout).toBe(5000);
    });
  });

  // === run_in_transaction() ===

  describe('run_in_transaction()', () => {
    it('should execute multiple operations atomically', () => {
      const task1 = store.create({ title: 'Transaction Test 1', assigned_to: 'claude' });
      const task2 = store.create({ title: 'Transaction Test 2', assigned_to: 'claude' });

      store.run_in_transaction(() => {
        store.update_status(task1.id, 'in_progress');
        store.update_status(task2.id, 'in_progress');
      });

      expect(store.get_by_id(task1.id)!.status).toBe('in_progress');
      expect(store.get_by_id(task2.id)!.status).toBe('in_progress');
    });

    it('should rollback on error', () => {
      const task = store.create({ title: 'Rollback Test', assigned_to: 'claude' });

      try {
        store.run_in_transaction(() => {
          store.update_status(task.id, 'in_progress');
          throw new Error('Simulated failure');
        });
      } catch {
        // expected
      }

      // Status should be unchanged due to rollback
      expect(store.get_by_id(task.id)!.status).toBe('pending');
    });
  });
});

---

## 파일: [OPS] src/gemini/cli_wrapper.test.ts

// TDD tests for Gemini CLI wrapper module
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawn_gemini, parse_gemini_response, check_session_status, get_gemini_command, get_session_name } from './cli_wrapper.js';
import type { GeminiConfig } from './types.js';

// Mock child_process
vi.mock('node:child_process', () => {
  const { EventEmitter } = require('node:events');
  const { Readable } = require('node:stream');

  const create_mock_process = () => {
    const proc = new EventEmitter();
    proc.stdout = new Readable({ read() {} });
    proc.stderr = new Readable({ read() {} });
    return proc;
  };

  return {
    spawn: vi.fn(() => {
      const proc = create_mock_process();
      // Default: simulate successful execution
      setTimeout(() => {
        proc.stdout.push('Hello from Gemini');
        proc.stdout.push(null);
        proc.emit('close', 0);
      }, 10);
      return proc;
    }),
    execSync: vi.fn(() => ''),
  };
});

const TEST_CONFIG: GeminiConfig = {
  account: 'a',
  timeout_ms: 5000,
};

describe('Gemini CLI Wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // === parse_gemini_response() tests ===

  describe('parse_gemini_response()', () => {
    it('should clean ANSI escape codes from output', () => {
      // Given: output with ANSI codes
      const raw = '\x1B[32mHello World\x1B[0m';

      // When: parsed
      const result = parse_gemini_response(raw);

      // Then: ANSI codes are removed
      expect(result).toBe('Hello World');
    });

    it('should extract and format JSON from mixed output', () => {
      // Given: output containing JSON
      const raw = 'Some text before\n{"decision": "approved", "reason": "looks safe"}\nSome text after';

      // When: parsed
      const result = parse_gemini_response(raw);

      // Then: JSON is extracted and formatted
      const parsed = JSON.parse(result);
      expect(parsed.decision).toBe('approved');
      expect(parsed.reason).toBe('looks safe');
    });

    it('should return cleaned text when no JSON present', () => {
      // Given: plain text output
      const raw = 'This is a plain text response from Gemini';

      // When: parsed
      const result = parse_gemini_response(raw);

      // Then: returns cleaned text
      expect(result).toBe('This is a plain text response from Gemini');
    });

    it('should handle empty output', () => {
      // Given: empty string
      const raw = '';

      // When: parsed
      const result = parse_gemini_response(raw);

      // Then: returns empty string
      expect(result).toBe('');
    });

    it('should handle malformed JSON gracefully', () => {
      // Given: output with broken JSON
      const raw = 'Response: {not valid json}';

      // When: parsed
      const result = parse_gemini_response(raw);

      // Then: returns the full cleaned text (not the broken JSON)
      expect(result).toContain('Response:');
    });
  });

  // === spawn_gemini() tests ===

  describe('spawn_gemini()', () => {
    it('should resolve with success on exit code 0', async () => {
      // Given: default mock (exits with 0)
      // When: spawn_gemini is called
      const result = await spawn_gemini(TEST_CONFIG, 'test prompt');

      // Then: success response
      expect(result.success).toBe(true);
      expect(result.content).toBeTruthy();
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should resolve with failure on non-zero exit code', async () => {
      // Given: process exits with error
      const { spawn } = await import('node:child_process');
      const { EventEmitter } = await import('node:events');
      const { Readable } = await import('node:stream');

      vi.mocked(spawn).mockImplementationOnce(() => {
        const proc = new EventEmitter() as ReturnType<typeof spawn>;
        (proc as Record<string, unknown>).stdout = new Readable({ read() {} });
        (proc as Record<string, unknown>).stderr = new Readable({ read() {} });
        setTimeout(() => {
          (proc as Record<string, unknown> & { stderr: Readable }).stderr.push('Error occurred');
          (proc as Record<string, unknown> & { stderr: Readable }).stderr.push(null);
          proc.emit('close', 1);
        }, 10);
        return proc;
      });

      // When: spawn_gemini is called
      const result = await spawn_gemini(TEST_CONFIG, 'test prompt');

      // Then: failure response
      expect(result.success).toBe(false);
      expect(result.error).toContain('exited with code 1');
    });

    it('should resolve with failure when spawn itself fails', async () => {
      // Given: spawn throws an error
      const { spawn } = await import('node:child_process');
      const { EventEmitter } = await import('node:events');
      const { Readable } = await import('node:stream');

      vi.mocked(spawn).mockImplementationOnce(() => {
        const proc = new EventEmitter() as ReturnType<typeof spawn>;
        (proc as Record<string, unknown>).stdout = new Readable({ read() {} });
        (proc as Record<string, unknown>).stderr = new Readable({ read() {} });
        setTimeout(() => {
          proc.emit('error', new Error('Command not found'));
        }, 10);
        return proc;
      });

      // When: spawn_gemini is called
      const result = await spawn_gemini(TEST_CONFIG, 'test prompt');

      // Then: failure response
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to spawn');
    });

    it('should use account B config directory', async () => {
      // Given: account B config
      const config: GeminiConfig = { account: 'b', timeout_ms: 5000 };
      const { spawn } = await import('node:child_process');

      // When: spawn_gemini is called
      await spawn_gemini(config, 'test prompt');

      // Then: env includes GEMINI_CONFIG_DIR for account B
      const call_args = vi.mocked(spawn).mock.calls[0];
      const options = call_args[2] as { env: Record<string, string> };
      expect(options.env.GEMINI_CONFIG_DIR).toContain('.gemini-b');
    });

    it('should pass model flag when specified', async () => {
      // Given: config with model
      const config: GeminiConfig = { account: 'a', model: 'gemini-2.0-flash' };
      const { spawn } = await import('node:child_process');

      // When: spawn_gemini is called
      await spawn_gemini(config, 'test prompt');

      // Then: args include --model flag
      const call_args = vi.mocked(spawn).mock.calls[0];
      const args = call_args[1] as string[];
      expect(args).toContain('--model');
      expect(args).toContain('gemini-2.0-flash');
    });
  });

  // === get_gemini_command() tests ===

  describe('get_gemini_command()', () => {
    it('should return default command for account A', () => {
      // When: get command for account A
      const cmd = get_gemini_command('a');

      // Then: returns bare gemini command
      expect(cmd).toBe('gemini');
    });

    it('should set GEMINI_CONFIG_DIR for account B', () => {
      // When: get command for account B
      const cmd = get_gemini_command('b');

      // Then: includes config dir override
      expect(cmd).toContain('GEMINI_CONFIG_DIR');
      expect(cmd).toContain('.gemini-b');
    });

    it('should use custom base command', () => {
      // When: custom command provided
      const cmd = get_gemini_command('a', '/usr/local/bin/gemini');

      // Then: uses custom command
      expect(cmd).toBe('/usr/local/bin/gemini');
    });
  });

  // === get_session_name() tests ===

  describe('get_session_name()', () => {
    it('should return fas-gemini-a for account A', () => {
      expect(get_session_name('a')).toBe('fas-gemini-a');
    });

    it('should return fas-gemini-b for account B', () => {
      expect(get_session_name('b')).toBe('fas-gemini-b');
    });
  });

  // === check_session_status() tests ===

  describe('check_session_status()', () => {
    it('should return stopped when tmux session does not exist', async () => {
      // Given: execSync throws (no tmux session)
      const cp = await import('node:child_process');
      vi.spyOn(cp, 'execSync').mockImplementation(() => {
        throw new Error('no server running');
      });

      // When: check status
      const status = check_session_status('a');

      // Then: stopped
      expect(status).toBe('stopped');

      vi.restoreAllMocks();
    });

    it('should return running when session has active pane', async () => {
      // Given: tmux session exists with active pane
      const cp = await import('node:child_process');
      vi.spyOn(cp, 'execSync')
        .mockReturnValueOnce('' as never)           // has-session succeeds
        .mockReturnValueOnce('12345\n' as never);   // list-panes returns PID

      // When: check status
      const status = check_session_status('a');

      // Then: running
      expect(status).toBe('running');

      vi.restoreAllMocks();
    });
  });
});

---

## 파일: [OPS] src/hunter/api_client.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_api_client } from './api_client.js';
import type { Logger } from './logger.js';

// Mock logger
const mock_logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const BASE_URL = 'http://localhost:3100';
const TEST_API_KEY = 'test-hunter-key-123';

describe('api_client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetch_pending_tasks', () => {
    it('should return tasks on successful response', async () => {
      // Given
      const mock_tasks = [
        { id: 'task_1', title: 'Crawl K-Startup', status: 'pending' },
      ];
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tasks: mock_tasks, count: 1 }),
      }));

      const client = create_api_client({ base_url: BASE_URL }, mock_logger);

      // When
      const tasks = await client.fetch_pending_tasks();

      // Then
      expect(tasks).toEqual(mock_tasks);
      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/hunter/tasks/pending`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('should return empty array on HTTP error', async () => {
      // Given
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }));

      const client = create_api_client({ base_url: BASE_URL }, mock_logger);

      // When
      const tasks = await client.fetch_pending_tasks();

      // Then
      expect(tasks).toEqual([]);
    });

    it('should return empty array on network error', async () => {
      // Given
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const client = create_api_client({ base_url: BASE_URL }, mock_logger);

      // When
      const tasks = await client.fetch_pending_tasks();

      // Then
      expect(tasks).toEqual([]);
      expect(mock_logger.error).toHaveBeenCalled();
    });
  });

  describe('submit_result', () => {
    it('should return true on successful submission', async () => {
      // Given
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      }));

      const client = create_api_client({ base_url: BASE_URL }, mock_logger);

      // When
      const result = await client.submit_result('task_1', {
        status: 'success',
        output: 'Done',
        files: [],
      });

      // Then
      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      // Given
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

      const client = create_api_client({ base_url: BASE_URL }, mock_logger);

      // When
      const result = await client.submit_result('task_1', {
        status: 'success',
        output: 'Done',
        files: [],
      });

      // Then
      expect(result).toBe(false);
    });

    it('should handle quarantine response (202)', async () => {
      // Given — captain returns 202 when PII detected
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 202,
        json: () => Promise.resolve({
          quarantined: true,
          detected_types: ['phone_number', 'email'],
        }),
      }));

      const client = create_api_client({ base_url: BASE_URL }, mock_logger);

      // When
      const result = await client.submit_result('task_1', {
        status: 'success',
        output: '연락처: 010-1234-5678, test@email.com',
        files: [],
      });

      // Then — should return false (not accepted)
      expect(result).toBe(false);
      expect(mock_logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('quarantined'),
      );
    });
  });

  describe('send_heartbeat', () => {
    it('should return heartbeat response on success', async () => {
      // Given
      const hb_response = { ok: true, server_time: '2026-03-17T12:00:00Z' };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(hb_response),
      }));

      const client = create_api_client({ base_url: BASE_URL }, mock_logger);

      // When
      const result = await client.send_heartbeat();

      // Then
      expect(result).toEqual(hb_response);
    });

    it('should return null on failure', async () => {
      // Given
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

      const client = create_api_client({ base_url: BASE_URL }, mock_logger);

      // When
      const result = await client.send_heartbeat();

      // Then
      expect(result).toBeNull();
    });
  });

  // === API key authentication ===

  describe('API key header', () => {
    it('should include API key header when configured', async () => {
      // Given
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tasks: [], count: 0 }),
      }));

      const client = create_api_client(
        { base_url: BASE_URL, api_key: TEST_API_KEY },
        mock_logger,
      );

      // When
      await client.fetch_pending_tasks();

      // Then — verify API key header was sent
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-hunter-api-key': TEST_API_KEY,
          }),
        }),
      );
    });

    it('should not include API key header when not configured', async () => {
      // Given
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tasks: [], count: 0 }),
      }));

      const client = create_api_client({ base_url: BASE_URL }, mock_logger);

      // When
      await client.fetch_pending_tasks();

      // Then — no API key header
      const call_args = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const headers = call_args[1]?.headers as Record<string, string>;
      expect(headers['x-hunter-api-key']).toBeUndefined();
    });

    it('should include API key in heartbeat requests', async () => {
      // Given
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, server_time: '2026-03-17T12:00:00Z' }),
      }));

      const client = create_api_client(
        { base_url: BASE_URL, api_key: TEST_API_KEY },
        mock_logger,
      );

      // When
      await client.send_heartbeat();

      // Then
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-hunter-api-key': TEST_API_KEY,
          }),
        }),
      );
    });

    it('should include API key in result submission', async () => {
      // Given
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      }));

      const client = create_api_client(
        { base_url: BASE_URL, api_key: TEST_API_KEY },
        mock_logger,
      );

      // When
      await client.submit_result('task_1', { status: 'success', output: 'Done', files: [] });

      // Then
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-hunter-api-key': TEST_API_KEY,
            'Content-Type': 'application/json',
          }),
        }),
      );
    });
  });
});

---

## 파일: [OPS] src/hunter/poll_loop.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_poll_loop } from './poll_loop.js';
import type { ApiClient } from './api_client.js';
import type { Logger } from './logger.js';
import type { HunterConfig } from './config.js';
import type { Task } from '../shared/types.js';

const mock_logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mock_config: HunterConfig = {
  captain_api_url: 'http://localhost:3100',
  poll_interval_ms: 1000,
  log_dir: './logs',
  device_name: 'hunter',
};

const make_task = (id: string, title: string): Task => ({
  id,
  title,
  priority: 'medium',
  assigned_to: 'openclaw',
  mode: 'awake',
  risk_level: 'low',
  requires_personal_info: false,
  status: 'pending',
  created_at: '2026-03-17T00:00:00Z',
  deadline: null,
  depends_on: [],
});

describe('poll_loop', () => {
  let mock_api: ApiClient;
  let mock_executor: { execute: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.restoreAllMocks();

    mock_api = {
      send_heartbeat: vi.fn().mockResolvedValue({ ok: true, server_time: '2026-03-17T12:00:00Z' }),
      fetch_pending_tasks: vi.fn().mockResolvedValue([]),
      submit_result: vi.fn().mockResolvedValue(true),
    };

    mock_executor = {
      execute: vi.fn().mockResolvedValue({ status: 'success', output: 'done', files: [] }),
    };
  });

  it('should send heartbeat and fetch tasks on each cycle', async () => {
    // Given
    const loop = create_poll_loop({
      api: mock_api,
      executor: mock_executor,
      logger: mock_logger,
      config: mock_config,
    });

    // When
    await loop.run_cycle();

    // Then
    expect(mock_api.send_heartbeat).toHaveBeenCalledOnce();
    expect(mock_api.fetch_pending_tasks).toHaveBeenCalledOnce();
    expect(mock_executor.execute).not.toHaveBeenCalled(); // no tasks
  });

  it('should execute first task and submit result when tasks available', async () => {
    // Given
    const task = make_task('task_1', 'Crawl website');
    (mock_api.fetch_pending_tasks as ReturnType<typeof vi.fn>).mockResolvedValue([task]);

    const loop = create_poll_loop({
      api: mock_api,
      executor: mock_executor,
      logger: mock_logger,
      config: mock_config,
    });

    // When
    await loop.run_cycle();

    // Then
    expect(mock_executor.execute).toHaveBeenCalledWith(task);
    expect(mock_api.submit_result).toHaveBeenCalledWith('task_1', {
      status: 'success',
      output: 'done',
      files: [],
    });
    expect(loop.get_state().total_tasks_processed).toBe(1);
  });

  it('should only execute first task when multiple are pending', async () => {
    // Given
    const tasks = [make_task('task_1', 'First'), make_task('task_2', 'Second')];
    (mock_api.fetch_pending_tasks as ReturnType<typeof vi.fn>).mockResolvedValue(tasks);

    const loop = create_poll_loop({
      api: mock_api,
      executor: mock_executor,
      logger: mock_logger,
      config: mock_config,
    });

    // When
    await loop.run_cycle();

    // Then
    expect(mock_executor.execute).toHaveBeenCalledOnce();
    expect(mock_executor.execute).toHaveBeenCalledWith(tasks[0]);
  });

  it('should increment consecutive_failures on error', async () => {
    // Given
    (mock_api.send_heartbeat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));

    const loop = create_poll_loop({
      api: mock_api,
      executor: mock_executor,
      logger: mock_logger,
      config: mock_config,
    });

    // When
    await loop.run_cycle();

    // Then
    expect(loop.get_state().consecutive_failures).toBe(1);
  });

  it('should reset consecutive_failures on successful cycle', async () => {
    // Given
    const loop = create_poll_loop({
      api: mock_api,
      executor: mock_executor,
      logger: mock_logger,
      config: mock_config,
    });

    // Simulate a prior failure
    await loop.run_cycle(); // success — should reset
    (mock_api.send_heartbeat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
    await loop.run_cycle(); // failure
    expect(loop.get_state().consecutive_failures).toBe(1);

    // Reset mock to succeed
    (mock_api.send_heartbeat as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, server_time: '' });
    await loop.run_cycle(); // success

    // Then
    expect(loop.get_state().consecutive_failures).toBe(0);
  });

  it('should calculate backoff interval correctly', () => {
    // Given
    const loop = create_poll_loop({
      api: mock_api,
      executor: mock_executor,
      logger: mock_logger,
      config: { ...mock_config, poll_interval_ms: 1000 },
    });

    // When / Then — no failures: normal interval
    expect(loop.get_current_interval()).toBe(1000);
  });
});

---

## 파일: [OPS] src/hunter/task_executor.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_task_executor, resolve_action, extract_url } from './task_executor.js';
import type { Task } from '../shared/types.js';
import type { Logger } from './logger.js';
import type { BrowserManager } from './browser.js';

const mock_logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Mock locator object for Playwright page.locator() calls
const create_mock_locator = () => ({
  first: vi.fn().mockReturnThis(),
  last: vi.fn().mockReturnThis(),
  count: vi.fn().mockResolvedValue(0),
  isVisible: vi.fn().mockResolvedValue(false),
  waitFor: vi.fn().mockResolvedValue(undefined),
  click: vi.fn().mockResolvedValue(undefined),
  fill: vi.fn().mockResolvedValue(undefined),
  press: vi.fn().mockResolvedValue(undefined),
  textContent: vi.fn().mockResolvedValue(''),
});

// Mock page object returned by Playwright
const create_mock_page = (overrides: Record<string, unknown> = {}) => ({
  goto: vi.fn().mockResolvedValue(undefined),
  title: vi.fn().mockResolvedValue('Test Page Title'),
  textContent: vi.fn().mockResolvedValue('  Hello world content  '),
  screenshot: vi.fn().mockResolvedValue(undefined),
  setDefaultTimeout: vi.fn(),
  setDefaultNavigationTimeout: vi.fn(),
  url: vi.fn().mockReturnValue('https://example.com'),
  waitForTimeout: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  locator: vi.fn().mockReturnValue(create_mock_locator()),
  context: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
  }),
  ...overrides,
});

// Mock browser manager
const create_mock_browser = (page_overrides: Record<string, unknown> = {}): BrowserManager => {
  const mock_page = create_mock_page(page_overrides);
  return {
    get_page: vi.fn().mockResolvedValue(mock_page),
    get_persistent_page: vi.fn().mockResolvedValue(mock_page),
    close_persistent: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
};

const make_task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task_001',
  title: 'Test task',
  priority: 'medium',
  assigned_to: 'openclaw',
  mode: 'awake',
  risk_level: 'low',
  requires_personal_info: false,
  status: 'pending',
  created_at: '2026-03-17T00:00:00Z',
  deadline: null,
  depends_on: [],
  ...overrides,
});

// ===== extract_url tests =====
describe('extract_url', () => {
  it('should extract https URL from text', () => {
    // Given
    const text = 'Please crawl https://example.com/page for data';

    // When
    const result = extract_url(text);

    // Then
    expect(result).toBe('https://example.com/page');
  });

  it('should extract http URL from text', () => {
    // Given
    const text = 'Visit http://localhost:3000/api';

    // When
    const result = extract_url(text);

    // Then
    expect(result).toBe('http://localhost:3000/api');
  });

  it('should return first URL when multiple exist', () => {
    // Given
    const text = 'Check https://first.com and https://second.com';

    // When
    const result = extract_url(text);

    // Then
    expect(result).toBe('https://first.com');
  });

  it('should return null when no URL found', () => {
    // Given
    const text = 'No URLs in this text at all';

    // When
    const result = extract_url(text);

    // Then
    expect(result).toBeNull();
  });

  it('should handle URLs with query params and paths', () => {
    // Given
    const text = 'Crawl https://api.example.com/v2/data?page=1&limit=50';

    // When
    const result = extract_url(text);

    // Then
    expect(result).toBe('https://api.example.com/v2/data?page=1&limit=50');
  });
});

// ===== resolve_action tests =====
describe('resolve_action', () => {
  it('should resolve notebooklm_verify from title', () => {
    // Given
    const task = make_task({ title: 'NotebookLM verify research output' });

    // When / Then
    expect(resolve_action(task)).toBe('notebooklm_verify');
  });

  it('should resolve deep_research from description', () => {
    // Given
    const task = make_task({
      title: 'AI trends analysis',
      description: 'Run deep research on latest AI trends',
    });

    // When / Then
    expect(resolve_action(task)).toBe('deep_research');
  });

  it('should resolve web_crawl from Korean keyword', () => {
    // Given
    const task = make_task({ title: 'K-Startup 크롤링' });

    // When / Then
    expect(resolve_action(task)).toBe('web_crawl');
  });

  it('should resolve web_crawl from scrape keyword', () => {
    // Given
    const task = make_task({ title: 'Scrape job listings from LinkedIn' });

    // When / Then
    expect(resolve_action(task)).toBe('web_crawl');
  });

  it('should default to browser_task for unknown tasks', () => {
    // Given
    const task = make_task({ title: 'Check Gmail for new emails' });

    // When / Then
    expect(resolve_action(task)).toBe('browser_task');
  });
});

// ===== web_crawl handler tests =====
describe('web_crawl handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should crawl URL and return page content', async () => {
    // Given
    const mock_browser = create_mock_browser();
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'Crawl K-Startup website',
      description: 'Scrape https://example.com/startups for listings',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('success');
    expect(result.output).toContain('Test Page Title');
    expect(result.output).toContain('https://example.com/startups');
    expect(result.output).toContain('Hello world content');
    expect(result.files).toEqual([]);
  });

  it('should return failure when no URL found in crawl task', async () => {
    // Given
    const mock_browser = create_mock_browser();
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'Crawl some website',
      description: 'No URL provided here',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('failure');
    expect(result.output).toContain('No URL found');
  });

  it('should handle navigation errors gracefully', async () => {
    // Given
    const mock_browser = create_mock_browser({
      goto: vi.fn().mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED')),
    });
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'Crawl broken site',
      description: 'Scrape https://nonexistent.invalid/page',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('failure');
    expect(result.output).toContain('net::ERR_NAME_NOT_RESOLVED');
  });
});

// ===== browser_task handler tests =====
describe('browser_task handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should navigate, screenshot, and return content', async () => {
    // Given
    const mock_browser = create_mock_browser();
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'Check Gmail for new emails',
      description: 'Open https://mail.google.com and check inbox',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('success');
    expect(result.output).toContain('Test Page Title');
    expect(result.output).toContain('https://mail.google.com');
    expect(result.files).toEqual([`./output/${task.id}.png`]);
  });

  it('should return failure when no URL found in browser task', async () => {
    // Given
    const mock_browser = create_mock_browser();
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'Do something without URL',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('failure');
    expect(result.output).toContain('No URL found');
  });

  it('should handle screenshot errors gracefully', async () => {
    // Given
    const mock_browser = create_mock_browser({
      screenshot: vi.fn().mockRejectedValue(new Error('Screenshot failed')),
    });
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'Take screenshot',
      description: 'Visit https://example.com and screenshot',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('failure');
    expect(result.output).toContain('Screenshot failed');
  });
});

// ===== deep_research handler tests =====
describe('deep_research handler', () => {
  it('should detect login wall and return LOGIN_REQUIRED', async () => {
    // Given — page URL is Google login
    const mock_browser = create_mock_browser({
      url: vi.fn().mockReturnValue('https://accounts.google.com/signin'),
    });
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'AI trends deep research',
      description: 'Run deep research on latest AI developments',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('failure');
    expect(result.output).toContain('[LOGIN_REQUIRED]');
    expect(result.files).toEqual([]);
  });

  it('should use persistent browser page for Google login session', async () => {
    // Given
    const mock_browser = create_mock_browser({
      url: vi.fn().mockReturnValue('https://accounts.google.com/v3'),
    });
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'deep research on AI',
      description: 'Run deep research on latest AI developments',
    });

    // When
    await executor.execute(task);

    // Then — persistent page should be called, not regular get_page
    expect(mock_browser.get_persistent_page).toHaveBeenCalled();
  });
});

// ===== notebooklm_verify handler tests =====
describe('notebooklm_verify handler', () => {
  it('should detect login wall and return LOGIN_REQUIRED', async () => {
    // Given — page URL is Google login
    const mock_browser = create_mock_browser({
      url: vi.fn().mockReturnValue('https://accounts.google.com/signin'),
    });
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'NotebookLM verify analysis results',
      description: 'Verify hallucination in research output',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('failure');
    expect(result.output).toContain('[LOGIN_REQUIRED]');
    expect(result.files).toEqual([]);
  });

  it('should use persistent browser page for Google login session', async () => {
    // Given
    const mock_browser = create_mock_browser({
      url: vi.fn().mockReturnValue('https://accounts.google.com/v3'),
    });
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'NotebookLM verify analysis results',
      description: 'Verify hallucination in research output',
    });

    // When
    await executor.execute(task);

    // Then — persistent page should be called, not regular get_page
    expect(mock_browser.get_persistent_page).toHaveBeenCalled();
  });
});

---

## 파일: [OPS] src/notification/notion.test.ts

// TDD tests for Notion notification module
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_notion_client } from './notion.js';
import type { NotionConfig } from './notion.js';
import type { NotificationEvent } from '../shared/types.js';

// Mock @notionhq/client
vi.mock('@notionhq/client', () => {
  const MockClient = vi.fn(function (this: Record<string, unknown>) {
    this.pages = {
      create: vi.fn().mockResolvedValue({
        id: 'page-id-123',
        url: 'https://notion.so/page-id-123',
      }),
    };
  });
  return { Client: MockClient };
});

const TEST_CONFIG: NotionConfig = {
  api_key: 'test-notion-key',
  database_id: 'db-main-123',
  reports_db_id: 'db-reports-456',
};

const TEST_EVENT: NotificationEvent = {
  type: 'milestone',
  message: 'Gateway server deployed successfully',
  device: 'captain',
  severity: 'low',
};

describe('Notion Client', () => {
  let client: ReturnType<typeof create_notion_client>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = create_notion_client(TEST_CONFIG);
  });

  // === send_notification() tests ===

  describe('send_notification()', () => {
    it('should create a page in the notification database', async () => {
      // Given: a notification event
      const event: NotificationEvent = { ...TEST_EVENT };

      // When: send_notification is called
      const result = await client.send_notification(event);

      // Then: page is created with correct properties
      expect(result.page_id).toBe('page-id-123');
      expect(result.url).toBe('https://notion.so/page-id-123');
      expect(client._client.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { database_id: 'db-main-123' },
        }),
      );
    });

    it('should include metadata as code block when provided', async () => {
      // Given: event with metadata
      const event: NotificationEvent = {
        ...TEST_EVENT,
        metadata: { task_id: 'task_001', files: ['a.ts'] },
      };

      // When: send_notification is called
      await client.send_notification(event);

      // Then: create was called with children including code block
      const call_args = vi.mocked(client._client.pages.create).mock.calls[0][0];
      const children = (call_args as Record<string, unknown>).children as unknown[];
      expect(children.length).toBe(2); // paragraph + code block
    });

    it('should map severity to correct emoji', async () => {
      // Given: critical event
      const event: NotificationEvent = { ...TEST_EVENT, severity: 'critical' };

      // When: send_notification is called
      await client.send_notification(event);

      // Then: title contains red emoji
      const call_args = vi.mocked(client._client.pages.create).mock.calls[0][0];
      const properties = (call_args as Record<string, unknown>).properties as Record<string, unknown>;
      const name = properties.Name as { title: Array<{ text: { content: string } }> };
      expect(name.title[0].text.content).toContain('🔴');
    });

    it('should retry on failure with exponential backoff', async () => {
      // Given: first two attempts fail, third succeeds
      vi.mocked(client._client.pages.create)
        .mockRejectedValueOnce(new Error('API error'))
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce({ id: 'retry-page', url: 'https://notion.so/retry' } as never);

      // When: send_notification is called
      const result = await client.send_notification(TEST_EVENT);

      // Then: succeeds on third attempt
      expect(result.page_id).toBe('retry-page');
      expect(client._client.pages.create).toHaveBeenCalledTimes(3);
    });

    it('should throw FASError after all retries exhausted', async () => {
      // Given: all attempts fail
      vi.mocked(client._client.pages.create)
        .mockRejectedValue(new Error('Persistent API error'));

      // When/Then: throws FASError
      await expect(client.send_notification(TEST_EVENT)).rejects.toThrow('Notion notification failed');
    });
  });

  // === send_with_result() tests ===

  describe('send_with_result()', () => {
    it('should return success result on successful send', async () => {
      // Given: normal event
      // When: send_with_result is called
      const result = await client.send_with_result(TEST_EVENT);

      // Then: returns success
      expect(result.channel).toBe('notion');
      expect(result.success).toBe(true);
    });

    it('should return failure result when all retries exhausted', async () => {
      // Given: all attempts fail
      vi.mocked(client._client.pages.create)
        .mockRejectedValue(new Error('API error'));

      // When: send_with_result is called
      const result = await client.send_with_result(TEST_EVENT);

      // Then: returns failure without throwing
      expect(result.channel).toBe('notion');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // === create_page() tests ===

  describe('create_page()', () => {
    it('should create a report page in reports database', async () => {
      // Given: report parameters
      const params = {
        title: 'Daily Report 2026-03-18',
        content: 'Today we completed 5 tasks...',
      };

      // When: create_page is called
      const result = await client.create_page(params);

      // Then: page is created in reports database
      expect(result.page_id).toBe('page-id-123');
      expect(client._client.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { database_id: 'db-reports-456' },
        }),
      );
    });

    it('should use custom database_id when provided', async () => {
      // Given: custom database_id
      const params = {
        title: 'Custom Report',
        content: 'Content',
        database_id: 'db-custom-789',
      };

      // When: create_page is called
      await client.create_page(params);

      // Then: uses custom database
      expect(client._client.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { database_id: 'db-custom-789' },
        }),
      );
    });

    it('should split long content into multiple blocks', async () => {
      // Given: content longer than 2000 chars
      const long_content = 'A'.repeat(4500);
      const params = { title: 'Long Report', content: long_content };

      // When: create_page is called
      await client.create_page(params);

      // Then: content is split into multiple paragraph blocks
      const call_args = vi.mocked(client._client.pages.create).mock.calls[0][0];
      const children = (call_args as Record<string, unknown>).children as unknown[];
      expect(children.length).toBeGreaterThan(1);
    });
  });

  // === create_daily_briefing() tests ===

  describe('create_daily_briefing()', () => {
    it('should create a briefing page with sections', async () => {
      // Given: briefing sections
      const params = {
        date: '2026-03-18',
        sections: [
          { title: 'Overnight Work', content: '3 crawl tasks completed' },
          { title: 'Pending Approvals', content: 'None' },
        ],
      };

      // When: create_daily_briefing is called
      const result = await client.create_daily_briefing(params);

      // Then: page is created with heading + paragraph per section
      expect(result.page_id).toBe('page-id-123');
      const call_args = vi.mocked(client._client.pages.create).mock.calls[0][0];
      const children = (call_args as Record<string, unknown>).children as unknown[];
      // 2 sections × (1 heading + 1 paragraph) = 4 blocks
      expect(children.length).toBe(4);
    });

    it('should use reports database for briefings', async () => {
      // Given: briefing params
      const params = {
        date: '2026-03-18',
        sections: [{ title: 'Summary', content: 'All good' }],
      };

      // When: create_daily_briefing is called
      await client.create_daily_briefing(params);

      // Then: uses reports database
      expect(client._client.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { database_id: 'db-reports-456' },
        }),
      );
    });

    it('should include date in title', async () => {
      // Given: specific date
      const params = {
        date: '2026-03-18',
        sections: [{ title: 'Test', content: 'Test' }],
      };

      // When: create_daily_briefing is called
      await client.create_daily_briefing(params);

      // Then: title includes the date
      const call_args = vi.mocked(client._client.pages.create).mock.calls[0][0];
      const properties = (call_args as Record<string, unknown>).properties as Record<string, unknown>;
      const name = properties.Name as { title: Array<{ text: { content: string } }> };
      expect(name.title[0].text.content).toContain('2026-03-18');
    });
  });
});

---

## 파일: [OPS] src/notification/router.test.ts

// TDD tests for notification router
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_notification_router } from './router.js';
import type { NotificationEvent } from '../shared/types.js';
import type { TelegramClient } from './telegram.js';
import type { SlackClient } from './slack.js';

// Create mock clients
const create_mock_telegram = (): TelegramClient => ({
  send: vi.fn().mockResolvedValue({ message_id: 1, success: true }),
  wait_for_approval: vi.fn().mockResolvedValue(null),
  format_approval_message: vi.fn().mockReturnValue('formatted'),
  format_alert: vi.fn().mockReturnValue('alert'),
  format_briefing: vi.fn().mockReturnValue('briefing'),
  stop: vi.fn(),
  _bot: {} as never,
  _pending_approvals: new Map(),
});

const create_mock_slack = (): SlackClient => ({
  send: vi.fn().mockResolvedValue(true),
  route: vi.fn().mockResolvedValue(true),
  resolve_channel: vi.fn().mockReturnValue('#fas-general'),
  format_milestone: vi.fn().mockReturnValue('milestone'),
  format_done: vi.fn().mockReturnValue('done'),
  format_blocked: vi.fn().mockReturnValue('blocked'),
  format_error: vi.fn().mockReturnValue('error'),
  _web: {} as never,
});

describe('Notification Router', () => {
  let mock_telegram: TelegramClient;
  let mock_slack: SlackClient;
  let router: ReturnType<typeof create_notification_router>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock_telegram = create_mock_telegram();
    mock_slack = create_mock_slack();
    router = create_notification_router({
      telegram: mock_telegram,
      slack: mock_slack,
    });
  });

  // === Routing matrix tests ===

  describe('briefing event', () => {
    it('should route to telegram + slack', async () => {
      const event: NotificationEvent = {
        type: 'briefing',
        message: 'Good morning',
        device: 'captain',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(true);
      expect(result.slack).toBe(true);
      expect(mock_telegram.send).toHaveBeenCalledWith(
        'Good morning',
        'briefing',
      );
      expect(mock_slack.route).toHaveBeenCalledWith(event);
    });
  });

  describe('agent_log event', () => {
    it('should route to slack only', async () => {
      const event: NotificationEvent = {
        type: 'agent_log',
        message: 'Claude finished task',
        device: 'captain',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(false);
      expect(result.slack).toBe(true);
      expect(mock_telegram.send).not.toHaveBeenCalled();
      expect(mock_slack.route).toHaveBeenCalled();
    });
  });

  describe('approval_high event', () => {
    it('should route to telegram (as approval) + slack', async () => {
      const event: NotificationEvent = {
        type: 'approval_high',
        message: 'Approve git push?',
        device: 'captain',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(true);
      expect(result.slack).toBe(true);
      expect(mock_telegram.send).toHaveBeenCalledWith(
        'Approve git push?',
        'approval',
      );
    });
  });

  describe('alert event', () => {
    it('should route to telegram (as alert) + slack', async () => {
      const event: NotificationEvent = {
        type: 'alert',
        message: 'Agent crashed!',
        device: 'captain',
        severity: 'critical',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(true);
      expect(result.slack).toBe(true);
      expect(mock_telegram.send).toHaveBeenCalledWith(
        'Agent crashed!',
        'alert',
      );
    });
  });

  describe('blocked event', () => {
    it('should route to telegram + slack', async () => {
      const event: NotificationEvent = {
        type: 'blocked',
        message: 'API key missing',
        device: 'captain',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(true);
      expect(result.slack).toBe(true);
      expect(mock_telegram.send).toHaveBeenCalledWith(
        'API key missing',
        'alert',
      );
    });
  });

  describe('milestone event', () => {
    it('should route to slack only', async () => {
      const event: NotificationEvent = {
        type: 'milestone',
        message: 'Phase 0 complete',
        device: 'captain',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(false);
      expect(result.slack).toBe(true);
    });
  });

  describe('crawl_result event', () => {
    it('should route to slack (notion pending)', async () => {
      const event: NotificationEvent = {
        type: 'crawl_result',
        message: 'Found 5 new startup grants',
        device: 'captain',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(false);
      expect(result.slack).toBe(true);
      // notion is not yet implemented
      expect(result.notion).toBe(false);
    });
  });

  // === Null client handling ===

  describe('null clients', () => {
    it('should skip telegram when client is null', async () => {
      const router_no_telegram = create_notification_router({
        telegram: null,
        slack: mock_slack,
      });

      const event: NotificationEvent = {
        type: 'alert',
        message: 'Test',
        device: 'captain',
      };

      const result = await router_no_telegram.route(event);
      expect(result.telegram).toBe(false);
      expect(result.slack).toBe(true);
    });

    it('should skip slack when client is null', async () => {
      const router_no_slack = create_notification_router({
        telegram: mock_telegram,
        slack: null,
      });

      const event: NotificationEvent = {
        type: 'alert',
        message: 'Test',
        device: 'captain',
      };

      const result = await router_no_slack.route(event);
      expect(result.telegram).toBe(true);
      expect(result.slack).toBe(false);
    });
  });

  // === Cross-channel fallback ===

  describe('emergency fallback for slack-only events', () => {
    it('should fallback error event to Telegram when Slack fails', async () => {
      const failing_slack = create_mock_slack();
      (failing_slack.route as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const router_with_failing_slack = create_notification_router({
        telegram: mock_telegram,
        slack: failing_slack,
      });

      const event: NotificationEvent = {
        type: 'error',
        message: 'Database connection lost',
        device: 'captain',
      };

      const result = await router_with_failing_slack.route(event);

      // error is slack-only, but should emergency fallback to Telegram
      expect(result.slack).toBe(false);
      expect(result.telegram).toBe(true);
      expect(mock_telegram.send).toHaveBeenCalledWith(
        '[Emergency Fallback] Database connection lost',
        'alert',
      );
    });

    it('should fallback milestone event to Telegram when Slack fails', async () => {
      const failing_slack = create_mock_slack();
      (failing_slack.route as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const router_with_failing_slack = create_notification_router({
        telegram: mock_telegram,
        slack: failing_slack,
      });

      const event: NotificationEvent = {
        type: 'milestone',
        message: 'Phase 1 complete',
        device: 'captain',
      };

      const result = await router_with_failing_slack.route(event);

      expect(result.slack).toBe(false);
      expect(result.telegram).toBe(true);
      expect(mock_telegram.send).toHaveBeenCalledWith(
        '[Emergency Fallback] Phase 1 complete',
        'alert',
      );
    });

    it('should use [Slack Fallback] tag for dual-route events', async () => {
      const failing_slack = create_mock_slack();
      (failing_slack.route as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const router_with_failing_slack = create_notification_router({
        telegram: mock_telegram,
        slack: failing_slack,
      });

      // alert is dual-route (telegram + slack)
      const event: NotificationEvent = {
        type: 'alert',
        message: 'System overload',
        device: 'captain',
      };

      await router_with_failing_slack.route(event);

      // Should have two calls: initial telegram send + slack fallback via telegram
      const telegram_calls = (mock_telegram.send as ReturnType<typeof vi.fn>).mock.calls;
      expect(telegram_calls.length).toBe(2);
      expect(telegram_calls[1][0]).toBe('[Slack Fallback] System overload');
    });
  });

  // === get_rules() ===

  describe('get_rules()', () => {
    it('should return rules for known event types', () => {
      const rules = router.get_rules('alert');
      expect(rules).toEqual({ telegram: true, slack: true, notion: false });
    });

    it('should return null for unknown event type', () => {
      const rules = router.get_rules('unknown_type' as never);
      expect(rules).toBeNull();
    });
  });
});

---

## 파일: [OPS] src/notification/slack.test.ts

// TDD tests for Slack notification module
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_slack_client } from './slack.js';
import type { NotificationEvent } from '../shared/types.js';

// Mock @slack/web-api
vi.mock('@slack/web-api', () => {
  const MockWebClient = vi.fn(function (this: Record<string, unknown>) {
    this.chat = {
      postMessage: vi.fn().mockResolvedValue({ ok: true }),
    };
  });
  return { WebClient: MockWebClient };
});

describe('Slack Client', () => {
  let client: ReturnType<typeof create_slack_client>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = create_slack_client({ token: '[MASKED_TOKEN]' });
  });

  // === send() tests ===

  describe('send()', () => {
    it('should send a message to specified channel', async () => {
      const result = await client.send('#fas-general', 'Hello FAS');

      expect(result).toBe(true);
      expect(client._web.chat.postMessage).toHaveBeenCalledWith({
        channel: '#fas-general',
        text: 'Hello FAS',
        blocks: undefined,
      });
    });

    it('should return false on failure after all retries', async () => {
      vi.mocked(client._web.chat.postMessage)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'));

      const result = await client.send('#alerts', 'test');
      expect(result).toBe(false);
    });

    it('should pass blocks when provided', async () => {
      const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'Hello' } }];
      await client.send('#fas-general', 'fallback text', blocks);

      expect(client._web.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ blocks }),
      );
    });
  });

  // === resolve_channel() tests ===

  describe('resolve_channel()', () => {
    it('should route captain agent_log to #captain-logs', () => {
      const event: NotificationEvent = {
        type: 'agent_log',
        message: 'Claude completed task',
        device: 'captain',
      };
      expect(client.resolve_channel(event)).toBe('#captain-logs');
    });

    it('should route hunter agent_log to #hunter-logs', () => {
      const event: NotificationEvent = {
        type: 'agent_log',
        message: 'OpenClaw completed task',
        device: 'hunter',
      };
      expect(client.resolve_channel(event)).toBe('#hunter-logs');
    });

    it('should route crawl_result to #crawl-results', () => {
      const event: NotificationEvent = {
        type: 'crawl_result',
        message: 'Found 3 new startup programs',
        device: 'captain',
      };
      expect(client.resolve_channel(event)).toBe('#crawl-results');
    });

    it('should route approval_mid to #approvals', () => {
      const event: NotificationEvent = {
        type: 'approval_mid',
        message: 'AI cross review needed',
        device: 'captain',
      };
      expect(client.resolve_channel(event)).toBe('#approvals');
    });

    it('should route alert to #alerts', () => {
      const event: NotificationEvent = {
        type: 'alert',
        message: 'Agent crashed',
        device: 'captain',
        severity: 'critical',
      };
      expect(client.resolve_channel(event)).toBe('#alerts');
    });

    it('should route briefing to #fas-general', () => {
      const event: NotificationEvent = {
        type: 'briefing',
        message: 'Morning briefing',
        device: 'captain',
      };
      expect(client.resolve_channel(event)).toBe('#fas-general');
    });

    it('should route milestone to #fas-general', () => {
      const event: NotificationEvent = {
        type: 'milestone',
        message: 'Phase 0 complete',
        device: 'captain',
      };
      expect(client.resolve_channel(event)).toBe('#fas-general');
    });

    it('should route academy to #academy', () => {
      const event: NotificationEvent = {
        type: 'academy',
        message: 'Test paper generated',
        device: 'captain',
      };
      expect(client.resolve_channel(event)).toBe('#academy');
    });

    it('should route blocked to #alerts', () => {
      const event: NotificationEvent = {
        type: 'blocked',
        message: 'Task blocked',
        device: 'captain',
      };
      expect(client.resolve_channel(event)).toBe('#alerts');
    });
  });

  // === route() tests ===

  describe('route()', () => {
    it('should send event message to resolved channel', async () => {
      const event: NotificationEvent = {
        type: 'milestone',
        message: 'Phase 1 complete!',
        device: 'captain',
      };

      const result = await client.route(event);

      expect(result).toBe(true);
      expect(client._web.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: '#fas-general',
          text: 'Phase 1 complete!',
        }),
      );
    });

    it('should route device-specific logs correctly', async () => {
      const captain_event: NotificationEvent = {
        type: 'agent_log',
        message: 'Claude log',
        device: 'captain',
      };
      const hunter_event: NotificationEvent = {
        type: 'agent_log',
        message: 'Hunter log',
        device: 'hunter',
      };

      await client.route(captain_event);
      await client.route(hunter_event);

      const calls = vi.mocked(client._web.chat.postMessage).mock.calls;
      expect(calls[0][0]).toEqual(expect.objectContaining({ channel: '#captain-logs' }));
      expect(calls[1][0]).toEqual(expect.objectContaining({ channel: '#hunter-logs' }));
    });
  });

  // === Format helpers ===

  describe('format helpers', () => {
    it('format_milestone should include tag', () => {
      const msg = client.format_milestone('Phase 0 done');
      expect(msg).toContain('[MILESTONE]');
      expect(msg).toContain('Phase 0 done');
    });

    it('format_done should include tag', () => {
      const msg = client.format_done('All tasks complete');
      expect(msg).toContain('[DONE]');
    });

    it('format_blocked should include tag', () => {
      const msg = client.format_blocked('API key missing');
      expect(msg).toContain('[BLOCKED]');
    });

    it('format_error should include tag', () => {
      const msg = client.format_error('Timeout');
      expect(msg).toContain('[ERROR]');
    });
  });
});

---

## 파일: [OPS] src/notification/telegram.test.ts

// TDD tests for Telegram notification module
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_telegram_client } from './telegram.js';
import type { TelegramConfig } from './telegram.js';

// Mock node-telegram-bot-api
vi.mock('node-telegram-bot-api', () => {
  const MockBot = vi.fn(function (this: Record<string, unknown>) {
    this.sendMessage = vi.fn().mockResolvedValue({ message_id: 42 });
    this.on = vi.fn();
    this.answerCallbackQuery = vi.fn();
    this.stopPolling = vi.fn();
  });
  return { default: MockBot };
});

const TEST_CONFIG: TelegramConfig = {
  token: 'test-token-123',
  chat_id: '12345',
  polling: false,
};

describe('Telegram Client', () => {
  let client: ReturnType<typeof create_telegram_client>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = create_telegram_client(TEST_CONFIG);
  });

  // === send() tests ===

  describe('send()', () => {
    it('should send an info message and return message_id', async () => {
      const result = await client.send('Hello FAS', 'info');

      expect(result.success).toBe(true);
      expect(result.message_id).toBe(42);
      expect(client._bot.sendMessage).toHaveBeenCalledWith(
        '12345',
        'Hello FAS',
        expect.objectContaining({
          parse_mode: 'Markdown',
          reply_markup: undefined,
        }),
      );
    });

    it('should send an approval message with inline keyboard', async () => {
      const result = await client.send(
        'Approve this?',
        'approval',
        'req_001',
      );

      expect(result.success).toBe(true);
      expect(client._bot.sendMessage).toHaveBeenCalledWith(
        '12345',
        'Approve this?',
        expect.objectContaining({
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ 승인', callback_data: 'approve:req_001' },
              { text: '❌ 거부', callback_data: 'reject:req_001' },
            ]],
          },
        }),
      );
    });

    it('should return success: false on send failure after all retries', async () => {
      vi.mocked(client._bot.sendMessage)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'));

      const result = await client.send('test', 'info');

      expect(result.success).toBe(false);
      expect(result.message_id).toBe(0);
    });

    it('should not add inline keyboard for non-approval types', async () => {
      await client.send('Alert!', 'alert');

      expect(client._bot.sendMessage).toHaveBeenCalledWith(
        '12345',
        'Alert!',
        expect.objectContaining({
          reply_markup: undefined,
        }),
      );
    });
  });

  // === wait_for_approval() tests ===

  describe('wait_for_approval()', () => {
    it('should resolve with null on timeout', async () => {
      const promise = client.wait_for_approval('req_timeout', 50);
      const result = await promise;

      expect(result).toBeNull();
    });

    it('should resolve when approval callback fires', async () => {
      const promise = client.wait_for_approval('req_approve', null);

      // Simulate callback
      const resolver = client._pending_approvals.get('req_approve');
      expect(resolver).toBeDefined();
      resolver!(true);

      const result = await promise;
      expect(result).not.toBeNull();
      expect(result!.approved).toBe(true);
      expect(result!.responded_by).toBe('human');
    });

    it('should resolve with rejected when reject callback fires', async () => {
      const promise = client.wait_for_approval('req_reject', null);

      const resolver = client._pending_approvals.get('req_reject');
      resolver!(false);

      const result = await promise;
      expect(result).not.toBeNull();
      expect(result!.approved).toBe(false);
    });

    it('should clean up pending approval on timeout', async () => {
      client.wait_for_approval('req_cleanup', 50);

      expect(client._pending_approvals.has('req_cleanup')).toBe(true);

      // Wait for timeout
      await new Promise((r) => setTimeout(r, 100));

      expect(client._pending_approvals.has('req_cleanup')).toBe(false);
    });
  });

  // === Format helpers ===

  describe('format_approval_message()', () => {
    it('should format HIGH approval with orange emoji', () => {
      const msg = client.format_approval_message(
        'req_001',
        'git_push',
        'Push to main branch',
        'high',
      );

      expect(msg).toContain('🟠');
      expect(msg).toContain('*승인 요청*');
      expect(msg).toContain('HIGH');
      expect(msg).toContain('git_push');
      expect(msg).toContain('req_001');
    });

    it('should format CRITICAL approval with red emoji', () => {
      const msg = client.format_approval_message(
        'req_002',
        'deploy',
        'Production deployment',
        'critical',
      );

      expect(msg).toContain('🔴');
      expect(msg).toContain('CRITICAL');
    });
  });

  describe('format_alert()', () => {
    it('should format alert with emoji prefix', () => {
      const msg = client.format_alert('Agent crashed');
      expect(msg).toContain('🚨');
      expect(msg).toContain('Agent crashed');
    });
  });

  describe('format_briefing()', () => {
    it('should format briefing with morning emoji', () => {
      const msg = client.format_briefing('5 tasks completed');
      expect(msg).toContain('🌅');
      expect(msg).toContain('5 tasks completed');
    });
  });

  // === Cleanup ===

  describe('stop()', () => {
    it('should clear pending approvals', () => {
      client._pending_approvals.set('test', () => {});
      client.stop();
      expect(client._pending_approvals.size).toBe(0);
    });
  });
});

---

## 파일: [OPS] src/watchdog/activity_logger.test.ts

// TDD tests for activity logger
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { create_activity_logger, type ActivityLogger } from './activity_logger.js';

describe('Activity Logger', () => {
  let logger: ActivityLogger;

  beforeEach(() => {
    logger = create_activity_logger({ db_path: ':memory:' });
  });

  afterEach(() => {
    logger.close();
  });

  // === log_activity ===

  describe('log_activity()', () => {
    it('should create an activity entry with correct fields', () => {
      const id = logger.log_activity({
        agent: 'claude',
        action: 'git commit',
        risk_level: 'mid',
        approval_decision: 'approved',
        approval_reviewer: 'gemini_a',
        details: { files: ['src/main.ts'], branch: 'feature-x' },
      });

      // Verify the id is a valid UUID
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

      // Retrieve and verify the entry
      const entries = logger.get_activities_by_agent('claude');
      expect(entries).toHaveLength(1);

      const entry = entries[0];
      expect(entry.id).toBe(id);
      expect(entry.agent).toBe('claude');
      expect(entry.action).toBe('git commit');
      expect(entry.risk_level).toBe('mid');
      expect(entry.approval_decision).toBe('approved');
      expect(entry.approval_reviewer).toBe('gemini_a');
      expect(entry.details).toEqual({ files: ['src/main.ts'], branch: 'feature-x' });
      expect(entry.timestamp).toBeDefined();
    });

    it('should handle optional fields as undefined', () => {
      const id = logger.log_activity({
        agent: 'gemini_a',
        action: 'web_search',
        risk_level: 'low',
      });

      const entries = logger.get_activities_by_agent('gemini_a');
      expect(entries).toHaveLength(1);

      const entry = entries[0];
      expect(entry.id).toBe(id);
      expect(entry.approval_decision).toBeUndefined();
      expect(entry.approval_reviewer).toBeUndefined();
      expect(entry.details).toEqual({});
    });
  });

  // === log_approval ===

  describe('log_approval()', () => {
    it('should create an approval history entry', () => {
      const id = logger.log_approval({
        requester: 'claude',
        action: 'git push',
        risk_level: 'high',
        decision: 'approved',
        reviewer: 'gemini_a',
        reason: 'Changes reviewed, no PII detected',
        duration_ms: 4500,
      });

      expect(id).toMatch(/^[0-9a-f]{8}-/);

      // Retrieve via date range (wide range to capture)
      const now = new Date();
      const start = new Date(now.getTime() - 60_000).toISOString();
      const end = new Date(now.getTime() + 60_000).toISOString();

      const approvals = logger.get_approvals_by_date(start, end);
      expect(approvals).toHaveLength(1);

      const approval = approvals[0];
      expect(approval.id).toBe(id);
      expect(approval.requester).toBe('claude');
      expect(approval.action).toBe('git push');
      expect(approval.risk_level).toBe('high');
      expect(approval.decision).toBe('approved');
      expect(approval.reviewer).toBe('gemini_a');
      expect(approval.reason).toBe('Changes reviewed, no PII detected');
      expect(approval.duration_ms).toBe(4500);
    });

    it('should record timeout decisions', () => {
      logger.log_approval({
        requester: 'claude',
        action: 'deploy to staging',
        risk_level: 'high',
        decision: 'timeout',
        reviewer: 'gemini_b',
        reason: 'No response within timeout window',
        duration_ms: 600_000,
      });

      const now = new Date();
      const start = new Date(now.getTime() - 60_000).toISOString();
      const end = new Date(now.getTime() + 60_000).toISOString();

      const approvals = logger.get_approvals_by_date(start, end);
      expect(approvals[0].decision).toBe('timeout');
    });
  });

  // === get_activities_by_agent with limit ===

  describe('get_activities_by_agent()', () => {
    it('should respect the limit parameter', () => {
      // Insert 5 activities
      for (let i = 0; i < 5; i++) {
        logger.log_activity({
          agent: 'claude',
          action: `action_${i}`,
          risk_level: 'low',
        });
      }

      const all = logger.get_activities_by_agent('claude');
      expect(all).toHaveLength(5);

      const limited = logger.get_activities_by_agent('claude', 3);
      expect(limited).toHaveLength(3);
    });

    it('should only return activities for the specified agent', () => {
      logger.log_activity({ agent: 'claude', action: 'code_review', risk_level: 'low' });
      logger.log_activity({ agent: 'gemini_a', action: 'web_search', risk_level: 'low' });
      logger.log_activity({ agent: 'claude', action: 'git_commit', risk_level: 'mid' });

      const claude_entries = logger.get_activities_by_agent('claude');
      expect(claude_entries).toHaveLength(2);
      expect(claude_entries.every((e) => e.agent === 'claude')).toBe(true);

      const gemini_entries = logger.get_activities_by_agent('gemini_a');
      expect(gemini_entries).toHaveLength(1);
      expect(gemini_entries[0].agent).toBe('gemini_a');
    });
  });

  // === get_activities_by_date filtering ===

  describe('get_activities_by_date()', () => {
    it('should filter activities within the date range', () => {
      // Insert activities — all will have timestamps close to "now"
      logger.log_activity({ agent: 'claude', action: 'action_a', risk_level: 'low' });
      logger.log_activity({ agent: 'gemini_a', action: 'action_b', risk_level: 'mid' });

      const now = new Date();
      const start = new Date(now.getTime() - 60_000).toISOString();
      const end = new Date(now.getTime() + 60_000).toISOString();

      const entries = logger.get_activities_by_date(start, end);
      expect(entries).toHaveLength(2);
    });

    it('should return empty array when no activities match the date range', () => {
      logger.log_activity({ agent: 'claude', action: 'action_a', risk_level: 'low' });

      // Query a date range in the far past
      const entries = logger.get_activities_by_date('2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z');
      expect(entries).toHaveLength(0);
    });
  });

  // === get_approvals_by_date filtering ===

  describe('get_approvals_by_date()', () => {
    it('should filter approvals within the date range', () => {
      logger.log_approval({
        requester: 'claude',
        action: 'git push',
        risk_level: 'high',
        decision: 'approved',
        reviewer: 'gemini_a',
        reason: 'Looks good',
        duration_ms: 2000,
      });
      logger.log_approval({
        requester: 'claude',
        action: 'deploy',
        risk_level: 'critical',
        decision: 'rejected',
        reviewer: 'gemini_b',
        reason: 'PII detected in payload',
        duration_ms: 1500,
      });

      const now = new Date();
      const start = new Date(now.getTime() - 60_000).toISOString();
      const end = new Date(now.getTime() + 60_000).toISOString();

      const approvals = logger.get_approvals_by_date(start, end);
      expect(approvals).toHaveLength(2);
      expect(approvals[0].decision).toBe('approved');
      expect(approvals[1].decision).toBe('rejected');
    });

    it('should return empty array when no approvals match the date range', () => {
      logger.log_approval({
        requester: 'claude',
        action: 'git push',
        risk_level: 'high',
        decision: 'approved',
        reviewer: 'gemini_a',
        reason: 'OK',
        duration_ms: 1000,
      });

      const approvals = logger.get_approvals_by_date('2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z');
      expect(approvals).toHaveLength(0);
    });
  });
});

---

## 파일: [OPS] src/watchdog/local_queue.test.ts

// TDD tests for local queue (network disconnect resilience)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_local_queue, type LocalQueue } from './local_queue.js';

describe('Local Queue', () => {
  let queue: LocalQueue;
  let on_flush_mock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    on_flush_mock = vi.fn().mockResolvedValue(true);
    queue = create_local_queue({
      db_path: ':memory:',
      on_flush: on_flush_mock,
    });
  });

  afterEach(() => {
    queue.close();
  });

  // === enqueue & pending_count ===

  describe('enqueue()', () => {
    it('should add items and increment pending_count', () => {
      expect(queue.pending_count()).toBe(0);

      const id1 = queue.enqueue('/api/notify', 'POST', { msg: 'hello' });
      expect(id1).toBeDefined();
      expect(typeof id1).toBe('string');
      expect(queue.pending_count()).toBe(1);

      const id2 = queue.enqueue('/api/log', 'PUT', { level: 'info' });
      expect(id2).not.toBe(id1);
      expect(queue.pending_count()).toBe(2);
    });

    it('should store endpoint, method, and body correctly', () => {
      queue.enqueue('/api/test', 'POST', { key: 'value' });

      // Verify via raw DB query
      const row = queue._db.prepare('SELECT * FROM queue').get() as Record<string, unknown>;
      expect(row.endpoint).toBe('/api/test');
      expect(row.method).toBe('POST');
      expect(JSON.parse(row.body as string)).toEqual({ key: 'value' });
      expect(row.retry_count).toBe(0);
    });
  });

  // === flush — successful delivery ===

  describe('flush() with successful on_flush', () => {
    it('should remove all items when on_flush returns true', async () => {
      queue.enqueue('/api/a', 'POST', {});
      queue.enqueue('/api/b', 'POST', {});
      expect(queue.pending_count()).toBe(2);

      const result = await queue.flush();

      expect(result.sent).toBe(2);
      expect(result.failed).toBe(0);
      expect(queue.pending_count()).toBe(0);
      expect(on_flush_mock).toHaveBeenCalledTimes(2);
    });

    it('should pass correct QueuedRequest to on_flush', async () => {
      queue.enqueue('/api/notify', 'POST', { text: 'hi' });

      await queue.flush();

      const call_arg = on_flush_mock.mock.calls[0][0];
      expect(call_arg.endpoint).toBe('/api/notify');
      expect(call_arg.method).toBe('POST');
      expect(call_arg.body).toEqual({ text: 'hi' });
      expect(call_arg.retry_count).toBe(0);
      expect(call_arg.id).toBeDefined();
      expect(call_arg.queued_at).toBeDefined();
    });
  });

  // === flush — failed delivery ===

  describe('flush() with failing on_flush', () => {
    it('should increment retry_count when on_flush returns false', async () => {
      on_flush_mock.mockResolvedValue(false);
      queue.enqueue('/api/fail', 'POST', {});

      const result = await queue.flush();

      expect(result.sent).toBe(0);
      expect(result.failed).toBe(1);
      expect(queue.pending_count()).toBe(1);

      // Verify retry_count was incremented
      const row = queue._db.prepare('SELECT retry_count FROM queue').get() as { retry_count: number };
      expect(row.retry_count).toBe(1);
    });

    it('should increment retry_count when on_flush throws', async () => {
      on_flush_mock.mockRejectedValue(new Error('network error'));
      queue.enqueue('/api/error', 'POST', {});

      const result = await queue.flush();

      expect(result.sent).toBe(0);
      expect(result.failed).toBe(1);
      expect(queue.pending_count()).toBe(1);

      const row = queue._db.prepare('SELECT retry_count FROM queue').get() as { retry_count: number };
      expect(row.retry_count).toBe(1);
    });
  });

  // === flush — max_retries exceeded ===

  describe('flush() drops items exceeding max_retries', () => {
    it('should drop item after reaching max_retries (default 5)', async () => {
      on_flush_mock.mockResolvedValue(false);
      queue.enqueue('/api/doomed', 'POST', {});

      // Flush 5 times to reach max_retries
      for (let i = 0; i < 5; i++) {
        await queue.flush();
      }

      // Item should be dropped after the 5th failure
      expect(queue.pending_count()).toBe(0);
    });

    it('should respect custom max_retries', async () => {
      queue.close(); // close default queue

      const custom_flush = vi.fn().mockResolvedValue(false);
      queue = create_local_queue({
        db_path: ':memory:',
        max_retries: 2,
        on_flush: custom_flush,
      });

      queue.enqueue('/api/limited', 'POST', {});

      // First flush: retry_count goes 0 -> 1, still under max_retries=2
      await queue.flush();
      expect(queue.pending_count()).toBe(1);

      // Second flush: retry_count goes 1 -> 2, now >= max_retries, dropped
      await queue.flush();
      expect(queue.pending_count()).toBe(0);
    });
  });

  // === flush — mixed success/failure ===

  describe('flush() with mixed success/failure', () => {
    it('should handle mix of successful and failed deliveries', async () => {
      // First call succeeds, second fails, third succeeds
      on_flush_mock
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      queue.enqueue('/api/ok-1', 'POST', {});
      queue.enqueue('/api/fail', 'POST', {});
      queue.enqueue('/api/ok-2', 'POST', {});

      const result = await queue.flush();

      expect(result.sent).toBe(2);
      expect(result.failed).toBe(1);
      expect(queue.pending_count()).toBe(1);

      // The remaining item should be the failed one
      const row = queue._db.prepare('SELECT endpoint FROM queue').get() as { endpoint: string };
      expect(row.endpoint).toBe('/api/fail');
    });
  });
});

---

## 파일: [OPS] src/watchdog/output_watcher.test.ts

// TDD tests for output watcher
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scan_line, OutputWatcher, type PatternMatch } from './output_watcher.js';

describe('Output Watcher', () => {
  // === scan_line() — pure function tests ===

  describe('scan_line()', () => {
    it('should detect [APPROVAL_NEEDED] pattern', () => {
      const result = scan_line(
        '[APPROVAL_NEEDED] git push to main requires approval',
        'fas-claude',
      );

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('APPROVAL_NEEDED');
      expect(result!.description).toBe('git push to main requires approval');
      expect(result!.session).toBe('fas-claude');
      expect(result!.timestamp).toBeDefined();
    });

    it('should detect [BLOCKED] pattern', () => {
      const result = scan_line('[BLOCKED] API key not configured', 'fas-gemini-a');

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('BLOCKED');
      expect(result!.description).toBe('API key not configured');
    });

    it('should detect [MILESTONE] pattern', () => {
      const result = scan_line('[MILESTONE] Phase 0 infrastructure complete', 'fas-claude');

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('MILESTONE');
      expect(result!.description).toBe('Phase 0 infrastructure complete');
    });

    it('should detect [DONE] pattern', () => {
      const result = scan_line('[DONE] Crawler setup finished', 'fas-claude');

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('DONE');
      expect(result!.description).toBe('Crawler setup finished');
    });

    it('should detect [ERROR] pattern', () => {
      const result = scan_line('[ERROR] Database connection failed', 'fas-gateway');

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('ERROR');
      expect(result!.description).toBe('Database connection failed');
    });

    it('should detect [LOGIN_REQUIRED] pattern from hunter', () => {
      const result = scan_line(
        '[LOGIN_REQUIRED] Google OAuth session expired on hunter',
        'fas-hunter',
      );

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('LOGIN_REQUIRED');
      expect(result!.description).toBe('Google OAuth session expired on hunter');
      expect(result!.session).toBe('fas-hunter');
    });

    it('should detect [GEMINI_BLOCKED] pattern', () => {
      const result = scan_line(
        "[GEMINI_BLOCKED] Gemini 'gemini-a' crashed 3 times in succession. Manual intervention needed.",
        'fas-gemini-a',
      );

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('GEMINI_BLOCKED');
      expect(result!.description).toBe(
        "Gemini 'gemini-a' crashed 3 times in succession. Manual intervention needed.",
      );
      expect(result!.session).toBe('fas-gemini-a');
    });

    it('should return null for non-matching lines', () => {
      expect(scan_line('Normal log output', 'fas-claude')).toBeNull();
      expect(scan_line('', 'fas-claude')).toBeNull();
      expect(scan_line('compiling src/main.ts...', 'fas-claude')).toBeNull();
    });

    it('should handle pattern at any position in line', () => {
      const result = scan_line(
        '2026-03-17 10:30:00 [MILESTONE] Phase 1 started',
        'fas-claude',
      );

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('MILESTONE');
    });

    it('should handle empty description after pattern', () => {
      const result = scan_line('[BLOCKED]', 'fas-claude');

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('BLOCKED');
      expect(result!.description).toBe('');
    });
  });

  // === OutputWatcher class ===

  describe('OutputWatcher', () => {
    let matches: PatternMatch[];

    beforeEach(() => {
      matches = [];
    });

    it('should create and start/stop without errors', () => {
      const watcher = new OutputWatcher({
        sessions: ['test-session'],
        poll_interval_ms: 100,
        on_match: (match) => { matches.push(match); },
      });

      watcher.start();
      expect(watcher.is_running()).toBe(true);

      watcher.stop();
      expect(watcher.is_running()).toBe(false);
    });

    it('should not start twice', () => {
      const watcher = new OutputWatcher({
        sessions: ['test-session'],
        poll_interval_ms: 100,
        on_match: vi.fn(),
      });

      watcher.start();
      watcher.start(); // should be no-op

      expect(watcher.is_running()).toBe(true);
      watcher.stop();
    });

    it('should accept on_crash and crash_threshold config', () => {
      const on_crash = vi.fn();
      const watcher = new OutputWatcher({
        sessions: ['test-session'],
        poll_interval_ms: 100,
        on_match: vi.fn(),
        on_crash,
        crash_threshold: 5,
      });

      expect(watcher.is_running()).toBe(false);
      watcher.start();
      expect(watcher.is_running()).toBe(true);
      watcher.stop();
    });

    it('should emit started and stopped events', () => {
      const started_handler = vi.fn();
      const stopped_handler = vi.fn();

      const watcher = new OutputWatcher({
        sessions: ['fas-claude'],
        on_match: vi.fn(),
      });

      watcher.on('started', started_handler);
      watcher.on('stopped', stopped_handler);

      watcher.start();
      expect(started_handler).toHaveBeenCalledWith(['fas-claude']);

      watcher.stop();
      expect(stopped_handler).toHaveBeenCalled();
    });
  });
});

---

## 파일: [OPS] src/watchdog/resource_monitor.test.ts

// TDD tests for resource monitor
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResourceSnapshot } from '../shared/types.js';

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import {
  parse_cpu_usage,
  parse_memory_usage,
  parse_disk_usage,
  create_resource_monitor,
  type ResourceMonitorConfig,
} from './resource_monitor.js';

const mocked_exec = vi.mocked(execSync);

// === Sample macOS command outputs ===

const SAMPLE_TOP_OUTPUT = [
  'Processes: 450 total, 3 running, 447 sleeping, 2000 threads',
  'Load Avg: 3.12, 2.85, 2.50',
  'CPU usage: 45.2% user, 12.3% sys, 42.5% idle',
  'SharedLibs: 600M resident, 80M data, 50M linkedit.',
].join('\n');

const SAMPLE_SYSCTL_OUTPUT = '38654705664'; // 36GB in bytes

const SAMPLE_VM_STAT_OUTPUT = [
  'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
  'Pages free:                             100000.',
  'Pages active:                           500000.',
  'Pages inactive:                          50000.',
  'Pages speculative:                       20000.',
  'Pages throttled:                             0.',
  'Pages wired down:                       200000.',
  'Pages purgeable:                         30000.',
  'Pages stored in compressor:             100000.',
].join('\n');

const SAMPLE_DF_OUTPUT = [
  'Filesystem  1G-blocks  Used Available Capacity  iused ifree %iused  Mounted on',
  '/dev/disk3s1       460   230       200       54% 1000000 2000000   33%   /',
].join('\n');

// Helper: set up mocks for a full snapshot
const setup_full_mocks = (overrides?: {
  top?: string;
  sysctl?: string;
  vm_stat?: string;
  df?: string;
}) => {
  mocked_exec.mockImplementation((cmd: string) => {
    const command = String(cmd);
    if (command.startsWith('top')) return (overrides?.top ?? SAMPLE_TOP_OUTPUT) as any;
    if (command.startsWith('sysctl')) return (overrides?.sysctl ?? SAMPLE_SYSCTL_OUTPUT) as any;
    if (command.startsWith('vm_stat')) return (overrides?.vm_stat ?? SAMPLE_VM_STAT_OUTPUT) as any;
    if (command.startsWith('df')) return (overrides?.df ?? SAMPLE_DF_OUTPUT) as any;
    return '' as any;
  });
};

describe('Resource Monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  // === parse_cpu_usage ===

  describe('parse_cpu_usage()', () => {
    it('should parse CPU usage from top output', () => {
      mocked_exec.mockReturnValue(SAMPLE_TOP_OUTPUT as any);

      const result = parse_cpu_usage();

      // 45.2 + 12.3 = 57.5
      expect(result).toBeCloseTo(57.5, 1);
    });

    it('should return 0 on exec failure', () => {
      mocked_exec.mockImplementation(() => { throw new Error('command failed'); });

      expect(parse_cpu_usage()).toBe(0);
    });

    it('should return 0 on unparseable output', () => {
      mocked_exec.mockReturnValue('garbage output' as any);

      expect(parse_cpu_usage()).toBe(0);
    });
  });

  // === parse_memory_usage ===

  describe('parse_memory_usage()', () => {
    it('should parse memory usage from vm_stat and sysctl', () => {
      mocked_exec.mockImplementation((cmd: string) => {
        const command = String(cmd);
        if (command.startsWith('sysctl')) return SAMPLE_SYSCTL_OUTPUT as any;
        if (command.startsWith('vm_stat')) return SAMPLE_VM_STAT_OUTPUT as any;
        return '' as any;
      });

      const result = parse_memory_usage();

      // total_mb = 38654705664 / (1024*1024) = 36864
      expect(result.total_mb).toBe(36864);
      // available = (100000 + 50000 + 20000) * 16384 / (1024*1024) = 170000 * 16384 / 1048576 ≈ 2656.25
      // used = 36864 - 2656.25 ≈ 34208 (rounded)
      expect(result.used_mb).toBeGreaterThan(0);
      expect(result.used_mb).toBeLessThan(result.total_mb);
    });

    it('should return zeros on exec failure', () => {
      mocked_exec.mockImplementation(() => { throw new Error('fail'); });

      const result = parse_memory_usage();
      expect(result.used_mb).toBe(0);
      expect(result.total_mb).toBe(0);
    });
  });

  // === parse_disk_usage ===

  describe('parse_disk_usage()', () => {
    it('should parse disk usage from df output', () => {
      mocked_exec.mockReturnValue(SAMPLE_DF_OUTPUT as any);

      const result = parse_disk_usage();

      expect(result.total_gb).toBe(460);
      expect(result.used_gb).toBe(230);
    });

    it('should return zeros on exec failure', () => {
      mocked_exec.mockImplementation(() => { throw new Error('fail'); });

      const result = parse_disk_usage();
      expect(result.used_gb).toBe(0);
      expect(result.total_gb).toBe(0);
    });

    it('should return zeros on single-line output', () => {
      mocked_exec.mockReturnValue('Filesystem  1G-blocks  Used Available' as any);

      const result = parse_disk_usage();
      expect(result.used_gb).toBe(0);
      expect(result.total_gb).toBe(0);
    });
  });

  // === take_snapshot ===

  describe('take_snapshot()', () => {
    it('should return a valid ResourceSnapshot', () => {
      setup_full_mocks();

      const monitor = create_resource_monitor({
        on_alert: vi.fn(),
      });

      const snapshot = monitor.take_snapshot();

      // Validate shape
      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot).toHaveProperty('cpu_usage_percent');
      expect(snapshot).toHaveProperty('memory_used_mb');
      expect(snapshot).toHaveProperty('memory_total_mb');
      expect(snapshot).toHaveProperty('disk_used_gb');
      expect(snapshot).toHaveProperty('disk_total_gb');

      // Validate values from mocked data
      expect(snapshot.cpu_usage_percent).toBeCloseTo(57.5, 1);
      expect(snapshot.memory_total_mb).toBe(36864);
      expect(snapshot.disk_total_gb).toBe(460);
      expect(snapshot.disk_used_gb).toBe(230);
      expect(new Date(snapshot.timestamp).getTime()).not.toBeNaN();
    });
  });

  // === check — threshold alerts ===

  describe('check()', () => {
    it('should fire on_alert when CPU exceeds threshold', async () => {
      // CPU = 45.2 + 12.3 = 57.5%, set threshold to 50%
      setup_full_mocks();
      const on_alert = vi.fn();

      const monitor = create_resource_monitor({
        thresholds: { cpu_percent: 50 },
        on_alert,
      });

      await monitor.check();

      expect(on_alert).toHaveBeenCalledWith('cpu', expect.closeTo(57.5, 1), 50);
    });

    it('should fire on_alert when memory exceeds threshold', async () => {
      // Memory used ≈ 34208 / 36864 ≈ 92.8%, set threshold to 80%
      setup_full_mocks();
      const on_alert = vi.fn();

      const monitor = create_resource_monitor({
        thresholds: { memory_percent: 80 },
        on_alert,
      });

      await monitor.check();

      // Verify memory alert was fired
      const memory_call = on_alert.mock.calls.find((c) => c[0] === 'memory');
      expect(memory_call).toBeDefined();
      expect(memory_call![0]).toBe('memory');
      expect(memory_call![1]).toBeGreaterThan(80);
      expect(memory_call![2]).toBe(80);
    });

    it('should fire on_alert when disk exceeds threshold', async () => {
      // Disk = 230/460 = 50%, set threshold to 40%
      setup_full_mocks();
      const on_alert = vi.fn();

      const monitor = create_resource_monitor({
        thresholds: { disk_percent: 40 },
        on_alert,
      });

      await monitor.check();

      const disk_call = on_alert.mock.calls.find((c) => c[0] === 'disk');
      expect(disk_call).toBeDefined();
      expect(disk_call![0]).toBe('disk');
      expect(disk_call![1]).toBe(50); // 230/460 * 100
      expect(disk_call![2]).toBe(40);
    });

    it('should NOT fire on_alert when all metrics are below thresholds', async () => {
      // CPU = 57.5%, memory ≈ 92.8%, disk = 50%
      // Set thresholds high enough that nothing fires
      setup_full_mocks();
      const on_alert = vi.fn();

      const monitor = create_resource_monitor({
        thresholds: {
          cpu_percent: 99,
          memory_percent: 99,
          disk_percent: 99,
        },
        on_alert,
      });

      await monitor.check();

      expect(on_alert).not.toHaveBeenCalled();
    });
  });

  // === start / stop ===

  describe('start() / stop()', () => {
    it('should start periodic checks and stop them', async () => {
      setup_full_mocks();
      const on_alert = vi.fn();

      const monitor = create_resource_monitor({
        check_interval_ms: 1000,
        thresholds: { cpu_percent: 50 },
        on_alert,
      });

      monitor.start();

      // Advance time to trigger one interval
      await vi.advanceTimersByTimeAsync(1000);

      // on_alert should have been called (CPU 57.5 > 50)
      expect(on_alert).toHaveBeenCalled();

      // Clear and advance again
      on_alert.mockClear();
      monitor.stop();
      await vi.advanceTimersByTimeAsync(2000);

      // After stop, no more alerts should fire
      expect(on_alert).not.toHaveBeenCalled();
    });

    it('should not start twice if already running', () => {
      setup_full_mocks();
      const on_alert = vi.fn();

      const monitor = create_resource_monitor({
        check_interval_ms: 1000,
        on_alert,
      });

      monitor.start();
      monitor.start(); // should be no-op

      // Advance one interval
      vi.advanceTimersByTime(1000);

      // Only one interval should have been created (one call, not two)
      // Cleanup
      monitor.stop();
    });

    it('should handle stop when not started', () => {
      setup_full_mocks();

      const monitor = create_resource_monitor({
        on_alert: vi.fn(),
      });

      // Should not throw
      expect(() => monitor.stop()).not.toThrow();
    });
  });
});

---

## 파일: [OPS] scripts/agent_wrapper.sh

#!/usr/bin/env bash
# FAS Agent Wrapper — Auto-restart on crash
# Usage: agent_wrapper.sh <command> [args...]
#
# Features:
#   - Restarts the agent up to MAX_RETRIES times on crash
#   - Exponential backoff between retries
#   - Logs crash events
#   - Escalates to [BLOCKED] after max retries

set -euo pipefail

MAX_RETRIES="${FAS_MAX_RETRIES:-3}"
BASE_DELAY="${FAS_RETRY_DELAY:-5}"
LOG_DIR="${FAS_LOG_DIR:-$HOME/FAS-operations/logs}"

if [ $# -eq 0 ]; then
  echo "Usage: agent_wrapper.sh <command> [args...]"
  echo "Example: agent_wrapper.sh claude --resume"
  exit 1
fi

COMMAND="$*"
AGENT_NAME="${1##*/}" # basename of command
RETRY_COUNT=0
mkdir -p "$LOG_DIR"

echo "[Wrapper] Starting agent: $COMMAND"
echo "[Wrapper] Max retries: $MAX_RETRIES, Base delay: ${BASE_DELAY}s"

while true; do
  START_TIME=$(date +%s)

  # Run the agent command
  set +e
  $COMMAND
  EXIT_CODE=$?
  set -e

  END_TIME=$(date +%s)
  RUNTIME=$((END_TIME - START_TIME))

  # If it ran for more than 60 seconds, reset retry counter
  # (it was running fine, this is a new crash)
  if [ "$RUNTIME" -gt 60 ]; then
    RETRY_COUNT=0
  fi

  RETRY_COUNT=$((RETRY_COUNT + 1))
  TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

  echo "[$TIMESTAMP] [Wrapper] Agent '$AGENT_NAME' exited with code $EXIT_CODE after ${RUNTIME}s (attempt $RETRY_COUNT/$MAX_RETRIES)"

  # Log crash
  echo "$TIMESTAMP exit_code=$EXIT_CODE runtime=${RUNTIME}s attempt=$RETRY_COUNT" >> "$LOG_DIR/crashes_${AGENT_NAME}.log"

  # Check max retries
  if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
    echo "[BLOCKED] Agent '$AGENT_NAME' crashed $MAX_RETRIES times in succession. Manual intervention needed."
    echo "$TIMESTAMP [BLOCKED] $AGENT_NAME exceeded max retries ($MAX_RETRIES)" >> "$LOG_DIR/crashes_${AGENT_NAME}.log"

    # Wait for manual restart signal (user can Ctrl+C and re-run)
    echo "[Wrapper] Waiting 300 seconds before final retry..."
    sleep 300
    RETRY_COUNT=0
  fi

  # Exponential backoff: base * 2^(retry-1)
  DELAY=$((BASE_DELAY * (1 << (RETRY_COUNT - 1))))
  echo "[Wrapper] Restarting in ${DELAY}s..."
  sleep "$DELAY"
done

---

## 파일: [OPS] scripts/gemini_wrapper.sh

#!/usr/bin/env bash
# FAS Gemini CLI Wrapper — Auto-restart with exponential backoff
# Usage: GEMINI_ACCOUNT=A|B bash scripts/gemini_wrapper.sh
#
# This is the top-level entry point for launchd plists.
# Delegates to scripts/gemini/gemini_wrapper.sh with the correct account arg.
#
# Features:
#   - Reads GEMINI_ACCOUNT env var (A or B)
#   - Forwards to the actual gemini wrapper script
#   - Provides a stable path for launchd plist references

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACCOUNT="${GEMINI_ACCOUNT:-A}"

# Normalize to lowercase for the inner wrapper
ACCOUNT_LOWER=$(echo "$ACCOUNT" | tr '[:upper:]' '[:lower:]')

exec bash "${SCRIPT_DIR}/gemini/gemini_wrapper.sh" "$ACCOUNT_LOWER"

---

## 파일: [OPS] scripts/gemini/gemini_wrapper.sh

#!/usr/bin/env bash
# FAS Gemini CLI Wrapper — Auto-restart on crash
# Usage: gemini_wrapper.sh <account: a|b>
#
# Based on agent_wrapper.sh pattern:
#   - Restarts up to MAX_RETRIES times on crash
#   - Exponential backoff between retries
#   - Logs crash events
#   - Escalates to [GEMINI_BLOCKED] after max retries (detected by output_watcher)

set -euo pipefail

MAX_RETRIES="${FAS_MAX_RETRIES:-3}"
BASE_DELAY="${FAS_RETRY_DELAY:-5}"
LOG_DIR="${FAS_LOG_DIR:-$HOME/FAS-operations/logs}"

if [ $# -eq 0 ]; then
  echo "Usage: gemini_wrapper.sh <account: a|b>"
  exit 1
fi

ACCOUNT="$1"
AGENT_NAME="gemini-${ACCOUNT}"
RETRY_COUNT=0

mkdir -p "$LOG_DIR"

# Account-specific environment
if [ "$ACCOUNT" = "b" ]; then
  export GEMINI_CONFIG_DIR="$HOME/.gemini-b"
  echo "[Wrapper] Using alternate config: $GEMINI_CONFIG_DIR"
fi

# System prompt based on account role
if [ "$ACCOUNT" = "a" ]; then
  ROLE="research"
  SYSTEM_PROMPT="You are the FAS research agent. Your role is to search the web, analyze trends, and gather information for the Captain. Always respond with structured, factual data. Use JSON format when possible."
else
  ROLE="verification"
  SYSTEM_PROMPT="You are the FAS verification agent. Your role is to cross-check facts, verify claims, and validate outputs from other AI agents. Be critical and thorough. Flag any inconsistencies."
fi

echo "[Wrapper] Starting Gemini CLI: account=$ACCOUNT, role=$ROLE"
echo "[Wrapper] Max retries: $MAX_RETRIES, Base delay: ${BASE_DELAY}s"

while true; do
  START_TIME=$(date +%s)

  # Run Gemini CLI in interactive mode
  set +e
  gemini --system-prompt "$SYSTEM_PROMPT"
  EXIT_CODE=$?
  set -e

  END_TIME=$(date +%s)
  RUNTIME=$((END_TIME - START_TIME))

  # If it ran for more than 60 seconds, reset retry counter
  if [ "$RUNTIME" -gt 60 ]; then
    RETRY_COUNT=0
  fi

  RETRY_COUNT=$((RETRY_COUNT + 1))
  TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

  echo "[$TIMESTAMP] [Wrapper] Gemini '$AGENT_NAME' exited with code $EXIT_CODE after ${RUNTIME}s (attempt $RETRY_COUNT/$MAX_RETRIES)"

  # Log crash
  echo "$TIMESTAMP exit_code=$EXIT_CODE runtime=${RUNTIME}s attempt=$RETRY_COUNT role=$ROLE" >> "$LOG_DIR/crashes_${AGENT_NAME}.log"

  # Check max retries
  if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
    echo "[GEMINI_BLOCKED] Gemini '$AGENT_NAME' crashed $MAX_RETRIES times in succession. Manual intervention needed."
    echo "$TIMESTAMP [GEMINI_BLOCKED] $AGENT_NAME exceeded max retries ($MAX_RETRIES)" >> "$LOG_DIR/crashes_${AGENT_NAME}.log"

    echo "[Wrapper] Waiting 300 seconds before final retry..."
    sleep 300
    RETRY_COUNT=0
  fi

  # Exponential backoff: base * 2^(retry-1)
  DELAY=$((BASE_DELAY * (1 << (RETRY_COUNT - 1))))
  echo "[Wrapper] Restarting in ${DELAY}s..."
  sleep "$DELAY"
done

---

## 파일: [OPS] scripts/gemini/start_gemini_sessions.sh

#!/usr/bin/env bash
# FAS Gemini CLI Session Starter
# Creates tmux sessions for Gemini CLI accounts A and B
# Usage: ./start_gemini_sessions.sh [a|b|all]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAS_ROOT="${SCRIPT_DIR}/../.."
WRAPPER="${SCRIPT_DIR}/gemini_wrapper.sh"
LOG_DIR="${FAS_ROOT}/logs"

mkdir -p "$LOG_DIR"

start_session() {
  local account="$1"
  local session_name="fas-gemini-${account}"

  # Check if session already exists
  if tmux has-session -t "$session_name" 2>/dev/null; then
    echo "[Gemini] Session '$session_name' already exists, skipping."
    return 0
  fi

  echo "[Gemini] Starting session: $session_name (account $account)"
  tmux new-session -d -s "$session_name" \
    "bash ${WRAPPER} ${account} 2>&1 | tee -a ${LOG_DIR}/gemini-${account}.log"

  echo "[Gemini] Session '$session_name' started."
}

# Parse arguments
TARGET="${1:-all}"

case "$TARGET" in
  a)
    start_session "a"
    ;;
  b)
    start_session "b"
    ;;
  all)
    start_session "a"
    start_session "b"
    echo "[Gemini] All sessions started."
    ;;
  *)
    echo "Usage: $0 [a|b|all]"
    echo "  a   - Start account A (research) session only"
    echo "  b   - Start account B (verification) session only"
    echo "  all - Start both sessions (default)"
    exit 1
    ;;
esac

---

## 파일: [OPS] scripts/generate_notebooklm_fas.sh

#!/usr/bin/env bash
# generate_notebooklm_fas.sh — FAS NotebookLM review file generator
# Generates masked review files for both Doctrine + Operations layers
# Usage: bash scripts/generate_notebooklm_fas.sh

set -euo pipefail

OPS_ROOT="${OPS_ROOT:-$HOME/FAS-operations}"
DOCTRINE_ROOT="$HOME/Library/Mobile Documents/com~apple~CloudDocs/claude-config"
OUTPUT_DIR="$OPS_ROOT/reviews/notebooklm"
MASK_FILE="$OPS_ROOT/.notebooklm-mask"

GREEN='\033[0;32m'
NC='\033[0m'
log() { echo -e "${GREEN}[FAS-NLM]${NC} $1"; }

# ── 1. Archive previous results ──────────────────────────────────────
archive_previous() {
  if compgen -G "$OUTPUT_DIR"/*.md > /dev/null 2>&1; then
    local ts
    ts=$(date +%Y-%m-%d_%H%M%S)
    local archive="$OUTPUT_DIR/archive/$ts"
    mkdir -p "$archive"
    mv "$OUTPUT_DIR"/*.md "$archive/"
    log "Archived → archive/$ts"
  fi
}

# ── 2. Build sed masking script ──────────────────────────────────────
build_sed_script() {
  local tmpfile
  tmpfile=$(mktemp)

  # Strip code fences (NotebookLM ignores fenced content)
  cat >> "$tmpfile" << 'RULES'
/^```/d
/^````/d
/^`````/d
RULES

  # Mask /Users/<real-user>/
  echo "s|/Users/$(whoami)/|/Users/[MASKED_USER]/|g" >> "$tmpfile"

  # Mask private/Tailscale IPs (BSD sed compatible, no \b)
  cat >> "$tmpfile" << 'RULES'
s|10\.[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|172\.1[6-9]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|172\.2[0-9]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|172\.3[01]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|192\.168\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|100\.6[4-9]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|100\.[7-9][0-9]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|100\.1[01][0-9]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|100\.12[0-7]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
RULES

  # Mask token patterns
  cat >> "$tmpfile" << 'RULES'
s|xox[bpas]-[A-Za-z0-9_/\-]*|[MASKED_TOKEN]|g
s|Bearer [A-Za-z0-9._\-][A-Za-z0-9._\-]*|Bearer [MASKED_TOKEN]|g
RULES

  # GitHub username in URLs
  cat >> "$tmpfile" << 'RULES'
s|github\.com/[A-Za-z0-9_\-][A-Za-z0-9_\-]*/|github.com/[MASKED_USER]/|g
RULES

  # Custom masks from .notebooklm-mask (format: pattern|replacement per line)
  if [[ -f "$MASK_FILE" ]]; then
    while IFS='|' read -r pattern replacement; do
      [[ -z "$pattern" ]] && continue
      [[ "$pattern" =~ ^[[:space:]]*# ]] && continue
      pattern=$(echo "$pattern" | xargs)
      replacement=$(echo "$replacement" | xargs)
      echo "s|${pattern}|${replacement}|g" >> "$tmpfile"
    done < "$MASK_FILE"
  fi

  echo "$tmpfile"
}

# ── 3. Emit a single file with header + masked content ───────────────
emit_file() {
  local prefix="$1"    # [DOCTRINE] or [OPS]
  local base="$2"      # base dir for relative path
  local filepath="$3"  # absolute path
  local sed_file="$4"

  local rel="${filepath#"$base"/}"

  echo ""
  echo "## 파일: ${prefix} ${rel}"
  echo ""

  # .env files: mask values after = (except empty values and comments)
  if [[ "$(basename "$filepath")" == .env ]] || [[ "$(basename "$filepath")" == .env.local ]]; then
    sed -E 's/^([A-Za-z_]+)=.+$/\1=[MASKED_VALUE]/' "$filepath" | sed -f "$sed_file"
  else
    sed -f "$sed_file" "$filepath"
  fi

  echo ""
  echo "---"
}

# ── 4. Collect and categorize files ──────────────────────────────────
main() {
  log "Starting FAS NotebookLM generation..."

  [[ -d "$OPS_ROOT" ]] || { echo "ERROR: $OPS_ROOT not found"; exit 1; }
  [[ -d "$DOCTRINE_ROOT" ]] || { echo "ERROR: Doctrine not found"; exit 1; }

  mkdir -p "$OUTPUT_DIR"
  archive_previous

  SED_FILE_TMP=$(build_sed_script)
  trap 'rm -f "$SED_FILE_TMP"' EXIT
  local sed_file="$SED_FILE_TMP"

  local mask_count
  mask_count=$(wc -l < "$sed_file")
  log "Masking rules: ${mask_count} patterns"

  # ── Doctrine files ──
  log "Scanning Doctrine..."
  local doctrine_files=()
  while IFS= read -r -d '' f; do
    doctrine_files+=("$f")
  done < <(find "$DOCTRINE_ROOT" -type f \
    \( -name '*.md' -o -name '*.json' -o -name '*.yml' \) \
    -not -name '.DS_Store' \
    -not -path '*/.git/*' \
    -not -path '*/archive/*' \
    -not -name '*conflict*' \
    -not -name '*(1)*' \
    -print0 2>/dev/null | sort -z)

  log "  Doctrine: ${#doctrine_files[@]} files"

  # ── Operations docs & config (everything except src/ and scripts/) ──
  log "Scanning Operations..."
  local ops_docs=()
  while IFS= read -r -d '' f; do
    ops_docs+=("$f")
  done < <(find "$OPS_ROOT" -type f \
    \( -name '*.md' -o -name '*.yml' -o -name '*.yaml' -o -name '*.json' \
       -o -name '*.conf' -o -name '*.plist' -o -name '*.example' \
       -o -name '*.gitignore' -o -name 'docker-compose.yml' \
       -o -name 'tsconfig.json' -o -name 'vitest.config.ts' \
       -o -name 'pnpm-workspace.yaml' \) \
    -not -path '*/node_modules/*' \
    -not -path '*/.git/*' \
    -not -path '*/reviews/notebooklm/archive/*' \
    -not -path '*/dist/*' -not -path '*/logs/*' -not -path '*/state/*' \
    -not -path '*/src/*' -not -path '*/scripts/*' \
    -not -path '*/.claude/*' \
    -not -name 'pnpm-lock.yaml' -not -name '.DS_Store' \
    -print0 2>/dev/null | sort -z)

  log "  Docs & config: ${#ops_docs[@]} files"

  # ── Operations source code (src/**/*.ts, excluding tests) ──
  local ops_src=()
  while IFS= read -r -d '' f; do
    ops_src+=("$f")
  done < <(find "$OPS_ROOT/src" -type f -name '*.ts' -not -name '*.test.ts' \
    -print0 2>/dev/null | sort -z)

  log "  Source code: ${#ops_src[@]} files"

  # ── Operations tests & scripts ──
  local ops_tests=()
  while IFS= read -r -d '' f; do
    ops_tests+=("$f")
  done < <(find "$OPS_ROOT/src" -type f -name '*.test.ts' \
    -print0 2>/dev/null | sort -z)

  local ops_scripts=()
  while IFS= read -r -d '' f; do
    ops_scripts+=("$f")
  done < <(find "$OPS_ROOT/scripts" -type f \
    \( -name '*.sh' -o -name '*.ts' -o -name '*.plist' \) \
    -print0 2>/dev/null | sort -z)

  log "  Tests: ${#ops_tests[@]}, Scripts: ${#ops_scripts[@]}"

  # ── Generate output files ──

  log "Writing 01_doctrine.md..."
  {
    echo "# FAS Doctrine Layer — NotebookLM 교차 검증 소스"
    echo ""
    echo "> Doctrine은 FAS 클러스터의 정신, 원칙, 정체성, 보안 설계를 담당하는 Source of Truth."
    echo "> 생성일: $(date +%Y-%m-%d)"
    for f in "${doctrine_files[@]}"; do
      emit_file "[DOCTRINE]" "$DOCTRINE_ROOT" "$f" "$sed_file"
    done
  } > "$OUTPUT_DIR/01_doctrine.md"

  log "Writing 02_docs_and_config.md..."
  {
    echo "# FAS Operations — 문서 & 설정 — NotebookLM 교차 검증 소스"
    echo ""
    echo "> Operations는 Doctrine(원칙/정체성)을 코드로 실현하는 계층."
    echo "> 생성일: $(date +%Y-%m-%d)"
    for f in "${ops_docs[@]}"; do
      emit_file "[OPS]" "$OPS_ROOT" "$f" "$sed_file"
    done
  } > "$OUTPUT_DIR/02_docs_and_config.md"

  log "Writing 03_source_code.md..."
  {
    echo "# FAS Operations — 소스 코드 — NotebookLM 교차 검증 소스"
    echo ""
    echo "> 소스 코드 (테스트 제외). 생성일: $(date +%Y-%m-%d)"
    for f in "${ops_src[@]}"; do
      emit_file "[OPS]" "$OPS_ROOT" "$f" "$sed_file"
    done
  } > "$OUTPUT_DIR/03_source_code.md"

  log "Writing 04_tests_and_scripts.md..."
  {
    echo "# FAS Operations — 테스트 & 스크립트 — NotebookLM 교차 검증 소스"
    echo ""
    echo "> 테스트 코드와 운영 스크립트. 생성일: $(date +%Y-%m-%d)"
    for f in "${ops_tests[@]}"; do
      emit_file "[OPS]" "$OPS_ROOT" "$f" "$sed_file"
    done
    for f in "${ops_scripts[@]}"; do
      emit_file "[OPS]" "$OPS_ROOT" "$f" "$sed_file"
    done
  } > "$OUTPUT_DIR/04_tests_and_scripts.md"

  # ── Summary ──
  log "Done! Generated files:"
  for f in "$OUTPUT_DIR"/*.md; do
    local lines
    lines=$(wc -l < "$f")
    local name
    name=$(basename "$f")
    log "  $name — ${lines} lines"
  done

  log ""
  log "Next: review_prompt.md will be generated by the LLM."
  log "Then upload all 5 files to NotebookLM."
}

main "$@"

---

## 파일: [OPS] scripts/generate_notebooklm.sh

#!/usr/bin/env bash
# generate_notebooklm.sh — Generic NotebookLM review file generator
# Works for any project. Scans the current project directory.
# Usage: bash scripts/generate_notebooklm.sh [project_root]

set -euo pipefail

PROJECT_ROOT="${1:-$(pwd)}"
OUTPUT_DIR="$PROJECT_ROOT/reviews/notebooklm"
MASK_FILE="$PROJECT_ROOT/.notebooklm-mask"

GREEN='\033[0;32m'
NC='\033[0m'
log() { echo -e "${GREEN}[NLM]${NC} $1"; }

# ── 1. Archive previous results ──────────────────────────────────────
archive_previous() {
  if compgen -G "$OUTPUT_DIR"/*.md > /dev/null 2>&1; then
    local ts
    ts=$(date +%Y-%m-%d_%H%M%S)
    local archive="$OUTPUT_DIR/archive/$ts"
    mkdir -p "$archive"
    mv "$OUTPUT_DIR"/*.md "$archive/"
    log "Archived → archive/$ts"
  fi
}

# ── 2. Build sed masking script ──────────────────────────────────────
build_sed_script() {
  local tmpfile
  tmpfile=$(mktemp)

  # Strip code fences
  cat >> "$tmpfile" << 'RULES'
/^```/d
/^````/d
/^`````/d
RULES

  # Mask /Users/<real-user>/
  echo "s|/Users/$(whoami)/|/Users/[MASKED_USER]/|g" >> "$tmpfile"

  # Mask private/Tailscale IPs
  cat >> "$tmpfile" << 'RULES'
s|10\.[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|172\.1[6-9]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|172\.2[0-9]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|172\.3[01]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|192\.168\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|100\.6[4-9]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|100\.[7-9][0-9]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|100\.1[01][0-9]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|100\.12[0-7]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
RULES

  # Mask token patterns
  cat >> "$tmpfile" << 'RULES'
s|xox[bpas]-[A-Za-z0-9_/\-]*|[MASKED_TOKEN]|g
s|Bearer [A-Za-z0-9._\-][A-Za-z0-9._\-]*|Bearer [MASKED_TOKEN]|g
RULES

  # GitHub username in URLs
  cat >> "$tmpfile" << 'RULES'
s|github\.com/[A-Za-z0-9_\-][A-Za-z0-9_\-]*/|github.com/[MASKED_USER]/|g
RULES

  # Custom masks from .notebooklm-mask (format: pattern|replacement per line)
  if [[ -f "$MASK_FILE" ]]; then
    while IFS='|' read -r pattern replacement; do
      [[ -z "$pattern" ]] && continue
      [[ "$pattern" =~ ^[[:space:]]*# ]] && continue
      pattern=$(echo "$pattern" | xargs)
      replacement=$(echo "$replacement" | xargs)
      echo "s|${pattern}|${replacement}|g" >> "$tmpfile"
    done < "$MASK_FILE"
  fi

  echo "$tmpfile"
}

# ── 3. Emit a single file ────────────────────────────────────────────
emit_file() {
  local base="$1"
  local filepath="$2"
  local sed_file="$3"

  local rel="${filepath#"$base"/}"

  echo ""
  echo "## 파일: ${rel}"
  echo ""

  if [[ "$(basename "$filepath")" == .env ]] || [[ "$(basename "$filepath")" == .env.local ]]; then
    sed -E 's/^([A-Za-z_]+)=.+$/\1=[MASKED_VALUE]/' "$filepath" | sed -f "$sed_file"
  else
    sed -f "$sed_file" "$filepath"
  fi

  echo ""
  echo "---"
}

# ── 4. Main ──────────────────────────────────────────────────────────
main() {
  log "Scanning $PROJECT_ROOT ..."

  [[ -d "$PROJECT_ROOT" ]] || { echo "ERROR: $PROJECT_ROOT not found"; exit 1; }

  mkdir -p "$OUTPUT_DIR"
  archive_previous

  SED_FILE_TMP=$(build_sed_script)
  trap 'rm -f "$SED_FILE_TMP"' EXIT
  local sed_file="$SED_FILE_TMP"

  log "Masking rules: $(wc -l < "$sed_file") patterns"

  # ── Docs & config (non-src, non-scripts) ──
  local docs=()
  while IFS= read -r -d '' f; do
    docs+=("$f")
  done < <(find "$PROJECT_ROOT" -type f \
    \( -name '*.md' -o -name '*.yml' -o -name '*.yaml' -o -name '*.json' \
       -o -name '*.conf' -o -name '*.plist' -o -name '*.example' \
       -o -name '.gitignore' -o -name 'tsconfig.json' \
       -o -name 'vitest.config.ts' -o -name 'pnpm-workspace.yaml' \
       -o -name 'docker-compose.yml' -o -name 'Dockerfile' \) \
    -not -path '*/node_modules/*' -not -path '*/.git/*' \
    -not -path '*/reviews/notebooklm/archive/*' \
    -not -path '*/dist/*' -not -path '*/logs/*' -not -path '*/state/*' \
    -not -path '*/src/*' -not -path '*/scripts/*' \
    -not -path '*/.claude/*' \
    -not -name 'pnpm-lock.yaml' -not -name 'package-lock.json' \
    -not -name '.DS_Store' \
    -print0 2>/dev/null | sort -z)

  log "  Docs & config: ${#docs[@]} files"

  # ── Source code (src/**/*.ts|*.js|*.py, excluding tests) ──
  local src=()
  if [[ -d "$PROJECT_ROOT/src" ]]; then
    while IFS= read -r -d '' f; do
      src+=("$f")
    done < <(find "$PROJECT_ROOT/src" -type f \
      \( -name '*.ts' -o -name '*.js' -o -name '*.py' -o -name '*.tsx' -o -name '*.jsx' \) \
      -not -name '*.test.*' -not -name '*.spec.*' \
      -print0 2>/dev/null | sort -z)
  fi

  log "  Source: ${#src[@]} files"

  # ── Tests & scripts ──
  local tests=()
  if [[ -d "$PROJECT_ROOT/src" ]]; then
    while IFS= read -r -d '' f; do
      tests+=("$f")
    done < <(find "$PROJECT_ROOT/src" -type f \
      \( -name '*.test.*' -o -name '*.spec.*' \) \
      -print0 2>/dev/null | sort -z)
  fi

  local scripts=()
  if [[ -d "$PROJECT_ROOT/scripts" ]]; then
    while IFS= read -r -d '' f; do
      scripts+=("$f")
    done < <(find "$PROJECT_ROOT/scripts" -type f \
      \( -name '*.sh' -o -name '*.ts' -o -name '*.js' -o -name '*.py' \) \
      -print0 2>/dev/null | sort -z)
  fi

  log "  Tests: ${#tests[@]}, Scripts: ${#scripts[@]}"

  # ── Write output ──

  log "Writing 01_docs_and_config.md..."
  {
    echo "# 문서 & 설정 — NotebookLM 교차 검증 소스"
    echo ""
    echo "> 생성일: $(date +%Y-%m-%d)"
    for f in "${docs[@]}"; do
      emit_file "$PROJECT_ROOT" "$f" "$sed_file"
    done
  } > "$OUTPUT_DIR/01_docs_and_config.md"

  log "Writing 02_source_code.md..."
  {
    echo "# 소스 코드 — NotebookLM 교차 검증 소스"
    echo ""
    echo "> 소스 코드 (테스트 제외). 생성일: $(date +%Y-%m-%d)"
    for f in "${src[@]}"; do
      emit_file "$PROJECT_ROOT" "$f" "$sed_file"
    done
  } > "$OUTPUT_DIR/02_source_code.md"

  log "Writing 03_tests_and_scripts.md..."
  {
    echo "# 테스트 & 스크립트 — NotebookLM 교차 검증 소스"
    echo ""
    echo "> 생성일: $(date +%Y-%m-%d)"
    for f in "${tests[@]}"; do
      emit_file "$PROJECT_ROOT" "$f" "$sed_file"
    done
    for f in "${scripts[@]}"; do
      emit_file "$PROJECT_ROOT" "$f" "$sed_file"
    done
  } > "$OUTPUT_DIR/03_tests_and_scripts.md"

  # ── Summary ──
  log "Done! Generated files:"
  for f in "$OUTPUT_DIR"/*.md; do
    log "  $(basename "$f") — $(wc -l < "$f") lines"
  done
  log ""
  log "Next: LLM will generate review_prompt.md"
}

main "$@"

---

## 파일: [OPS] scripts/generate_review_files.ts

/**
 * generate_review_files.ts
 *
 * Reads all project files, masks sensitive information, and generates
 * categorized markdown files for NotebookLM upload.
 *
 * Usage: npx tsx scripts/generate_review_files.ts
 */

import fs from "node:fs";
import path from "node:path";

// ── Constants ──────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "reviews", "notebooklm");
const TODAY = new Date().toISOString().slice(0, 10);

// Directories / files to completely exclude
const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "reviews",
  "state",
  "logs",
  "dist",
  ".claude",
]);

const EXCLUDE_FILES = new Set([
  "pnpm-lock.yaml",
  ".env",
  "generate_review_files.ts",   // Contains masking patterns with real PII strings
]);

// File that should NOT be overwritten
const PRESERVE_FILE = "03_review_prompt.md";

// ── Masking Functions ──────────────────────────────────────────────────

/**
 * Apply all masking rules to file content.
 * Order matters — more specific patterns first to avoid partial matches.
 */
const mask_sensitive = (content: string): string => {
  let result = content;

  // 1. Telegram bot token pattern: digits:alphanumeric (e.g., 123456789:ABCdefGHI_jklMNO)
  result = result.replace(/\b\d{8,10}:[A-Za-z0-9_-]{30,50}\b/g, "[MASKED_TOKEN]");

  // 2. Slack token pattern ([MASKED_TOKEN]..., [MASKED_TOKEN]..., [MASKED_TOKEN]..., [MASKED_TOKEN]...)
  result = result.replace(/xox[bpas]-[A-Za-z0-9\-]+/g, "[MASKED_TOKEN]");

  // 3. GitHub URLs with username [MASKED_OWNER]
  result = result.replace(/github\.com\/[MASKED_OWNER]/g, "github.com/[MASKED_USER]");

  // 4. The word "[MASKED_OWNER]" (case-insensitive, but preserve surrounding context)
  result = result.replace(/\b[MASKED_OWNER]\b/gi, "[MASKED_OWNER]");
  // Also catch [MASKED_OWNER] as a whole
  result = result.replace(/\b[MASKED_OWNER]\b/gi, "[MASKED_OWNER]");

  // 5. File paths containing /Users/[MASKED_USER]/ → /Users/[MASKED_USER]/
  result = result.replace(/\/Users\/user\//g, "/Users/[MASKED_USER]/");

  // 6. Private IP addresses
  //    100.x.x.x (Tailscale), 192.168.x.x, 10.x.x.x, 172.16-31.x.x
  result = result.replace(/\b100\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[MASKED_IP]");
  result = result.replace(/\b192\.168\.\d{1,3}\.\d{1,3}\b/g, "[MASKED_IP]");
  result = result.replace(/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[MASKED_IP]");
  result = result.replace(
    /\b172\.(1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}\b/g,
    "[MASKED_IP]"
  );

  // 7. Token/API key-like strings after = or : (long alphanumeric, 20+ chars)
  //    But skip obvious non-secrets (URLs, version strings, common hex hashes)
  //    Pattern: key= or key: followed by a long alphanumeric string
  result = result.replace(
    /([=:]\s*)([A-Za-z0-9_\-]{32,})(?=\s|$|"|'|`)/gm,
    "$1[MASKED_TOKEN]"
  );

  // 8. Catch Notion/API database IDs (32-char hex with hyphens)
  result = result.replace(
    /([=:]\s*)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "$1[MASKED_TOKEN]"
  );

  return result;
};

// ── File Collection ────────────────────────────────────────────────────

type FileEntry = {
  relative_path: string;
  absolute_path: string;
  content: string;
};

/**
 * Recursively collect all files under dir, respecting exclusions.
 */
const collect_files = (dir: string, base: string = PROJECT_ROOT): FileEntry[] => {
  const entries: FileEntry[] = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const abs = path.join(dir, item.name);
    const rel = path.relative(base, abs);

    if (item.isDirectory()) {
      if (EXCLUDE_DIRS.has(item.name)) continue;
      entries.push(...collect_files(abs, base));
    } else if (item.isFile()) {
      // Exclude specific files
      if (EXCLUDE_FILES.has(item.name)) continue;
      if (rel === ".env") continue;
      // Exclude .claude/settings.local.json
      if (rel.includes(".claude/settings.local.json")) continue;
      // Exclude pnpm-workspace.yaml (not in spec, but it's just a one-liner — include it actually)
      // Exclude binary files
      const ext = path.extname(item.name).toLowerCase();
      if ([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".db", ".sqlite"].includes(ext)) continue;

      try {
        const content = fs.readFileSync(abs, "utf-8");
        entries.push({ relative_path: rel, absolute_path: abs, content });
      } catch {
        // Skip unreadable files
        console.warn(`  [WARN] Skipped unreadable file: ${rel}`);
      }
    }
  }

  return entries;
};

// ── Categorization ─────────────────────────────────────────────────────

type Category = {
  filename: string;
  title: string;
  files: FileEntry[];
};

/**
 * Determine the file extension for code fences.
 */
const get_lang = (filepath: string): string => {
  const ext = path.extname(filepath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".js": "javascript",
    ".json": "json",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".md": "markdown",
    ".sh": "bash",
    ".plist": "xml",
    ".conf": "conf",
    ".example": "bash",
    ".gitignore": "gitignore",
  };
  // Special case for .gitignore (no extension)
  if (filepath.endsWith(".gitignore")) return "gitignore";
  return map[ext] || "text";
};

/**
 * Categorize a file into one of the three output groups.
 * Returns category index: 0 = docs_and_config, 1 = source_code, 2 = tests_and_scripts
 */
const categorize = (rel: string): number => {
  const ext = path.extname(rel).toLowerCase();
  const basename = path.basename(rel);

  // Category 3: tests and scripts
  // - All *.test.ts files
  // - All .sh files
  // - scripts/*.ts (but NOT the generate_review_files.ts itself)
  if (rel.endsWith(".test.ts")) return 2;
  if (ext === ".sh") return 2;
  if (rel.startsWith("scripts/") && ext === ".ts") return 2;

  // Category 2: source code
  // - All .ts files in src/ that are NOT test files
  if (rel.startsWith("src/") && ext === ".ts" && !rel.endsWith(".test.ts")) return 1;

  // Category 1: docs and config — everything else
  // - .md files, .yml, .yaml, .json, .example, .plist, .gitignore, docker-compose.yml, .conf
  if ([".md", ".yml", ".yaml", ".json", ".example", ".plist", ".conf"].includes(ext)) return 0;
  if (basename === ".gitignore") return 0;

  // Fallback: vitest.config.ts, tsconfig.json → config
  if (basename === "vitest.config.ts") return 0;

  // Anything else → docs_and_config
  return 0;
};

// ── Main ───────────────────────────────────────────────────────────────

const main = () => {
  console.log("=== FAS Review File Generator ===");
  console.log(`Project root: ${PROJECT_ROOT}`);
  console.log(`Output dir: ${OUTPUT_DIR}`);
  console.log(`Date: ${TODAY}\n`);

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Collect all files
  console.log("Collecting files...");
  const all_files = collect_files(PROJECT_ROOT);
  console.log(`  Found ${all_files.length} files total.\n`);

  // Set up categories
  const categories: Category[] = [
    { filename: "01_docs_and_config.md", title: "문서 & 설정 (Docs & Config)", files: [] },
    { filename: "02_source_code.md", title: "소스 코드 (Source Code)", files: [] },
    { filename: "03_tests_and_scripts.md", title: "테스트 & 스크립트 (Tests & Scripts)", files: [] },
  ];

  // Categorize files
  for (const file of all_files) {
    const cat_idx = categorize(file.relative_path);
    categories[cat_idx].files.push(file);
  }

  // Sort files within each category alphabetically
  for (const cat of categories) {
    cat.files.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  }

  // Generate output files
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const out_path = path.join(OUTPUT_DIR, cat.filename);

    // Check for the preserve-file rule:
    // If the output filename matches 03_review_prompt.md, skip
    // (but 03_tests_and_scripts.md is different, so this is fine)
    if (cat.filename === PRESERVE_FILE) {
      console.log(`  [SKIP] ${cat.filename} (preserved)`);
      continue;
    }

    console.log(`Generating ${cat.filename}...`);
    console.log(`  Files in this category: ${cat.files.length}`);

    // Build markdown content
    const lines: string[] = [];

    // Header
    lines.push(`# FAS 전체 코드 리뷰 — Part ${i + 1}: ${cat.title}`);
    lines.push(`> 이 파일은 민감정보가 마스킹된 상태입니다.`);
    lines.push(`> 파일 수: ${cat.files.length}개 | 생성일: ${TODAY}`);
    lines.push("");

    // File entries
    // Use 5-backtick fences to avoid collision with inner code fences (``` inside .md files)
    for (const file of cat.files) {
      const lang = get_lang(file.relative_path);
      const masked_content = mask_sensitive(file.content);

      // Determine fence depth: if content contains 4+ backtick fences, use 6; otherwise 5
      const max_inner_fence = (masked_content.match(/`{3,}/g) || [])
        .reduce((max, m) => Math.max(max, m.length), 0);
      const fence = "`".repeat(Math.max(max_inner_fence + 1, 5));

      lines.push(`## 파일: ${file.relative_path}`);
      lines.push("");
      lines.push(`${fence}${lang}`);
      lines.push(masked_content.trimEnd());
      lines.push(fence);
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    fs.writeFileSync(out_path, lines.join("\n"), "utf-8");
    console.log(`  Written to: ${out_path}`);

    // List files included
    for (const file of cat.files) {
      console.log(`    - ${file.relative_path}`);
    }
    console.log("");
  }

  // Also ensure 03_review_prompt.md is not touched
  const prompt_path = path.join(OUTPUT_DIR, PRESERVE_FILE);
  if (fs.existsSync(prompt_path)) {
    console.log(`[OK] ${PRESERVE_FILE} preserved (not overwritten).`);
  }

  console.log("\n=== Generation complete! ===");
};

main();

---

## 파일: [OPS] scripts/security/scan_hunter_pii.sh

#!/usr/bin/env bash
# Hunter PII Scanner — scan hunter machine for owner's personal information residue
#
# Usage:
#   SSH into hunter, then run:
#     bash scripts/security/scan_hunter_pii.sh
#   Or from captain:
#     ssh hunter 'cd ~/FAS-operations && bash scripts/security/scan_hunter_pii.sh'
#
# What it checks:
#   1. Claude Code auth state (계정 A vs B)
#   2. Browser profiles for owner's Google account cookies
#   3. Shell history for PII patterns
#   4. .env files for captain secrets
#   5. Git config for owner email
#   6. SSH keys / known_hosts for identifying info
#   7. File content scan across common directories
#
# This script is READ-ONLY — it only reports findings, never deletes anything.
# After review, use scan_hunter_pii.sh --clean to generate cleanup commands.

set -euo pipefail

MODE="${1:-scan}"  # scan (default) or clean
REPORT_FILE="./logs/pii_scan_$(date +%Y%m%d_%H%M%S).md"
FOUND_COUNT=0

# === Colors ===
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

# === PII patterns (from .notebooklm-mask + sanitizer.ts) ===
# Owner-specific patterns — loaded from .notebooklm-mask if available
OWNER_PATTERNS=()
MASK_FILE=".notebooklm-mask"

if [ -f "$MASK_FILE" ]; then
  while IFS='|' read -r pattern _replacement; do
    [[ "$pattern" =~ ^#.*$ ]] && continue
    [[ -z "$pattern" ]] && continue
    OWNER_PATTERNS+=("$pattern")
  done < "$MASK_FILE"
fi

# Generic PII regex patterns (from sanitizer.ts)
GENERIC_PATTERNS=(
  '01[016789][- ]?[0-9]{3,4}[- ]?[0-9]{4}'          # Korean phone numbers
  '[0-9]{6}-?[1-4][0-9]{6}'                            # Resident ID
  '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'   # Email (generic)
)

mkdir -p "$(dirname "$REPORT_FILE")"

# === Helper functions ===
log_finding() {
  local severity="$1"  # CRITICAL / WARNING / INFO
  local category="$2"
  local detail="$3"

  FOUND_COUNT=$((FOUND_COUNT + 1))

  case "$severity" in
    CRITICAL) echo -e "${RED}[CRITICAL]${NC} $category: $detail" ;;
    WARNING)  echo -e "${YELLOW}[WARNING]${NC} $category: $detail" ;;
    INFO)     echo -e "${GREEN}[INFO]${NC} $category: $detail" ;;
  esac

  echo "- [$severity] **$category**: $detail" >> "$REPORT_FILE"
}

log_clean() {
  echo -e "${GREEN}[CLEAN]${NC} $1"
}

# === Start ===
echo "=== FAS Hunter PII Scanner ==="
echo "Mode: $MODE"
echo "Report: $REPORT_FILE"
echo ""

cat > "$REPORT_FILE" << 'HEADER'
# Hunter PII Scan Report

> Auto-generated by scripts/security/scan_hunter_pii.sh

## Findings

HEADER

# ===== 1. Claude Code Auth State =====
echo "--- [1/7] Claude Code auth state ---"

if command -v claude &>/dev/null; then
  CLAUDE_WHO=$(claude whoami 2>/dev/null || echo "NOT_LOGGED_IN")
  if echo "$CLAUDE_WHO" | grep -qi "not_logged_in\|error\|not authenticated"; then
    log_clean "Claude Code: not logged in"
  else
    # Check if it looks like owner's account (Account A)
    log_finding "CRITICAL" "Claude Code Auth" "Logged in as: $CLAUDE_WHO — verify this is Account B, not Account A"
  fi
else
  log_clean "Claude Code: not installed"
fi

# Check for credential files
for cred_file in ~/.claude/.credentials.json ~/.claude/credentials.json ~/.claude/auth.json ~/.claude/oauth*; do
  if [ -f "$cred_file" ]; then
    log_finding "WARNING" "Claude Credentials" "Found credential file: $cred_file"
  fi
done
echo ""

# ===== 2. Browser Profiles =====
echo "--- [2/7] Browser profiles ---"

# Check Chrome/Chromium profiles for Google account cookies
BROWSER_DIRS=(
  "$HOME/Library/Application Support/Google/Chrome"
  "$HOME/Library/Application Support/Chromium"
  "$HOME/.config/google-chrome"
  "$HOME/.config/chromium"
  "$HOME/fas-google-profile-hunter"
  "${GOOGLE_PROFILE_DIR:-./fas-google-profile-hunter}"
)

for dir in "${BROWSER_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    # Check for Google account info in Preferences files
    prefs=$(find "$dir" -name "Preferences" -maxdepth 3 2>/dev/null || true)
    for pref in $prefs; do
      if [ -f "$pref" ]; then
        # Look for owner email patterns
        for pattern in "${OWNER_PATTERNS[@]}"; do
          if grep -qi "$pattern" "$pref" 2>/dev/null; then
            log_finding "CRITICAL" "Browser Profile" "Owner pattern '$pattern' found in $pref"
          fi
        done
      fi
    done

    # Check Login Data sqlite for owner's accounts
    login_dbs=$(find "$dir" -name "Login Data" -maxdepth 3 2>/dev/null || true)
    if [ -n "$login_dbs" ]; then
      log_finding "INFO" "Browser Profile" "Login database found in $dir — may contain saved passwords"
    fi
  fi
done
echo ""

# ===== 3. Shell History =====
echo "--- [3/7] Shell history ---"

HISTORY_FILES=(
  "$HOME/.bash_history"
  "$HOME/.zsh_history"
  "$HOME/.history"
)

for hist in "${HISTORY_FILES[@]}"; do
  if [ -f "$hist" ]; then
    for pattern in "${OWNER_PATTERNS[@]}"; do
      matches=$(grep -ci "$pattern" "$hist" 2>/dev/null || echo "0")
      if [ "$matches" -gt 0 ]; then
        log_finding "WARNING" "Shell History" "'$pattern' appears $matches times in $hist"
      fi
    done

    # Check for generic PII
    for pattern in "${GENERIC_PATTERNS[@]}"; do
      matches=$(grep -cE "$pattern" "$hist" 2>/dev/null || echo "0")
      if [ "$matches" -gt 0 ]; then
        log_finding "WARNING" "Shell History" "PII pattern match ($matches) in $hist"
      fi
    done
  fi
done
echo ""

# ===== 4. Environment / Config Files =====
echo "--- [4/7] Environment & config files ---"

# Check .env files for captain secrets
ENV_FILES=(
  "$HOME/FAS-operations/.env"
  "$HOME/FAS-operations/.env.local"
  "$HOME/.env"
)

for env_file in "${ENV_FILES[@]}"; do
  if [ -f "$env_file" ]; then
    # Check for captain-only secrets (should NOT be on hunter)
    for key in TELEGRAM_BOT_TOKEN SLACK_BOT_TOKEN NOTION_API_KEY GEMINI_API_KEY SMS_API_KEY; do
      val=$(grep "^${key}=" "$env_file" 2>/dev/null | cut -d= -f2 || true)
      if [ -n "$val" ] && [ "$val" != "" ] && [[ ! "$val" =~ ^your_ ]]; then
        log_finding "CRITICAL" "Environment" "Captain secret '$key' found in $env_file — should NOT be on hunter"
      fi
    done

    # Check for owner PII patterns
    for pattern in "${OWNER_PATTERNS[@]}"; do
      if grep -qi "$pattern" "$env_file" 2>/dev/null; then
        log_finding "CRITICAL" "Environment" "Owner PII '$pattern' found in $env_file"
      fi
    done
  fi
done

# Check git config
GIT_EMAIL=$(git config --global user.email 2>/dev/null || echo "")
GIT_NAME=$(git config --global user.name 2>/dev/null || echo "")

for pattern in "${OWNER_PATTERNS[@]}"; do
  if echo "$GIT_EMAIL $GIT_NAME" | grep -qi "$pattern" 2>/dev/null; then
    log_finding "WARNING" "Git Config" "Owner pattern '$pattern' in git config (email=$GIT_EMAIL, name=$GIT_NAME)"
  fi
done
echo ""

# ===== 5. SSH / Auth Files =====
echo "--- [5/7] SSH & auth files ---"

if [ -d "$HOME/.ssh" ]; then
  # Check known_hosts for captain hostnames
  if [ -f "$HOME/.ssh/known_hosts" ]; then
    log_finding "INFO" "SSH" "known_hosts exists — contains host fingerprints (generally safe)"
  fi

  # Check SSH config for owner info
  if [ -f "$HOME/.ssh/config" ]; then
    for pattern in "${OWNER_PATTERNS[@]}"; do
      if grep -qi "$pattern" "$HOME/.ssh/config" 2>/dev/null; then
        log_finding "WARNING" "SSH Config" "Owner pattern '$pattern' in SSH config"
      fi
    done
  fi
fi

# Check macOS Keychain for FAS-related items
if command -v security &>/dev/null; then
  fas_keys=$(security dump-keychain 2>/dev/null | grep -ci "fas\|anthropic\|claude" || echo "0")
  if [ "$fas_keys" -gt 0 ]; then
    log_finding "WARNING" "Keychain" "$fas_keys FAS/Anthropic/Claude entries found in keychain"
  fi
fi
echo ""

# ===== 6. Doctrine / Source Code Leak =====
echo "--- [6/7] Doctrine & source code leak ---"

# Check if Doctrine files exist on hunter (they should NOT)
DOCTRINE_PATHS=(
  "$HOME/Library/Mobile Documents/com~apple~CloudDocs/claude-config"
  "$HOME/claude-config"
  "$HOME/FAS-doctrine"
)

for dpath in "${DOCTRINE_PATHS[@]}"; do
  if [ -d "$dpath" ]; then
    log_finding "CRITICAL" "Doctrine Leak" "Doctrine directory found on hunter: $dpath"
  fi
done

# Check if iCloud Drive is syncing
if [ -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs" ]; then
  icloud_count=$(find "$HOME/Library/Mobile Documents/com~apple~CloudDocs" -maxdepth 1 -type d 2>/dev/null | wc -l || echo "0")
  if [ "$icloud_count" -gt 1 ]; then
    log_finding "CRITICAL" "iCloud" "iCloud Drive is syncing on hunter — owner data may be present"
  fi
fi
echo ""

# ===== 7. Broad File Content Scan =====
echo "--- [7/7] Broad file content scan (owner patterns) ---"

SCAN_DIRS=(
  "$HOME/FAS-operations"
  "$HOME/Documents"
  "$HOME/Desktop"
  "$HOME/Downloads"
)

for dir in "${SCAN_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    for pattern in "${OWNER_PATTERNS[@]}"; do
      matches=$(grep -rli "$pattern" "$dir" --include="*.{txt,md,json,yml,yaml,env,ts,js,sh,log}" 2>/dev/null | head -5 || true)
      if [ -n "$matches" ]; then
        file_count=$(echo "$matches" | wc -l | tr -d ' ')
        log_finding "WARNING" "File Content" "'$pattern' found in $file_count file(s) under $dir"
        echo "$matches" | while read -r f; do
          echo "    → $f"
          echo "  - \`$f\`" >> "$REPORT_FILE"
        done
      fi
    done
  fi
done
echo ""

# ===== Summary =====
echo "---" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "## Summary" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "- Total findings: $FOUND_COUNT" >> "$REPORT_FILE"
echo "- Scan time: $(date '+%Y-%m-%d %H:%M:%S')" >> "$REPORT_FILE"

echo "=== Scan Complete ==="
echo ""

if [ "$FOUND_COUNT" -eq 0 ]; then
  echo -e "${GREEN}✓ No PII found — hunter is clean.${NC}"
else
  echo -e "${YELLOW}Found $FOUND_COUNT issue(s). Review: $REPORT_FILE${NC}"
  echo ""
  echo "Recommended cleanup actions:"
  echo "  1. Claude Code: claude logout"
  echo "  2. Shell history: history -c && rm -f ~/.bash_history ~/.zsh_history"
  echo "  3. Browser profiles: rm -rf ~/fas-google-profile-hunter (then re-login with Account B)"
  echo "  4. Git config: git config --global user.email 'hunter@fas.local'"
  echo "  5. iCloud: Sign out of iCloud on this machine"
  echo "  6. Captain secrets in .env: Remove lines for TELEGRAM/SLACK/NOTION tokens"
  echo ""
  echo "After cleanup, re-run this script to verify."
fi

echo ""
echo "Full report: $REPORT_FILE"

---

## 파일: [OPS] scripts/setup/com.fas.captain.plist

<!-- FAS Captain launchd plist
     Auto-starts FAS tmux sessions on login.

     Install:
       cp scripts/setup/com.fas.captain.plist ~/Library/LaunchAgents/
       launchctl load ~/Library/LaunchAgents/com.fas.captain.plist

     Uninstall:
       launchctl unload ~/Library/LaunchAgents/com.fas.captain.plist
       rm ~/Library/LaunchAgents/com.fas.captain.plist
-->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.fas.captain</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-l</string>
        <string>-c</string>
        <string>/Users/[MASKED_USER]/FAS-operations/scripts/start_captain_sessions.sh</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <false/>

    <key>StandardOutPath</key>
    <string>/Users/[MASKED_USER]/FAS-operations/logs/launchd_captain.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/[MASKED_USER]/FAS-operations/logs/launchd_captain_error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>/Users/user</string>
    </dict>
</dict>
</plist>

---

## 파일: [OPS] scripts/setup/com.fas.gemini-a.plist

<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- FAS Gemini CLI Account A (Research) launchd plist
     Auto-starts Gemini CLI session A in tmux on login.

     Install:
       cp scripts/setup/com.fas.gemini-a.plist ~/Library/LaunchAgents/
       launchctl load ~/Library/LaunchAgents/com.fas.gemini-a.plist

     Uninstall:
       launchctl unload ~/Library/LaunchAgents/com.fas.gemini-a.plist
       rm ~/Library/LaunchAgents/com.fas.gemini-a.plist
-->
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.fas.gemini-a</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-l</string>
        <string>-c</string>
        <string>tmux new-session -d -s fas-gemini-a 'GEMINI_ACCOUNT=A bash /Users/[MASKED_USER]/FAS-operations/scripts/gemini/gemini_wrapper.sh a' 2>/dev/null || true</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <false/>

    <key>StandardOutPath</key>
    <string>/Users/[MASKED_USER]/FAS-operations/logs/gemini-a-launch.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/[MASKED_USER]/FAS-operations/logs/gemini-a-launch.log</string>

    <key>WorkingDirectory</key>
    <string>/Users/[MASKED_USER]/FAS-operations</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>/Users/user</string>
    </dict>
</dict>
</plist>

---

## 파일: [OPS] scripts/setup/com.fas.gemini-b.plist

<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- FAS Gemini CLI Account B (Cross-verification) launchd plist
     Auto-starts Gemini CLI session B in tmux on login.

     Install:
       cp scripts/setup/com.fas.gemini-b.plist ~/Library/LaunchAgents/
       launchctl load ~/Library/LaunchAgents/com.fas.gemini-b.plist

     Uninstall:
       launchctl unload ~/Library/LaunchAgents/com.fas.gemini-b.plist
       rm ~/Library/LaunchAgents/com.fas.gemini-b.plist
-->
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.fas.gemini-b</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-l</string>
        <string>-c</string>
        <string>tmux new-session -d -s fas-gemini-b 'GEMINI_ACCOUNT=B bash /Users/[MASKED_USER]/FAS-operations/scripts/gemini/gemini_wrapper.sh b' 2>/dev/null || true</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <false/>

    <key>StandardOutPath</key>
    <string>/Users/[MASKED_USER]/FAS-operations/logs/gemini-b-launch.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/[MASKED_USER]/FAS-operations/logs/gemini-b-launch.log</string>

    <key>WorkingDirectory</key>
    <string>/Users/[MASKED_USER]/FAS-operations</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>/Users/user</string>
    </dict>
</dict>
</plist>

---

## 파일: [OPS] scripts/setup/setup_ai_cli.sh

#!/usr/bin/env bash
# AI CLI authentication setup guide
# This script checks auth status and guides manual setup steps

set -euo pipefail

echo "=========================================="
echo " FAS AI CLI Authentication Setup"
echo "=========================================="
echo ""

# === 1. Claude Code ===
echo "📎 [1/4] Claude Code (Captain)"
echo "------------------------------------------"
if command -v claude &>/dev/null; then
  echo "  ✅ Claude Code CLI installed"
  echo "  🔑 Auth: Run 'claude' and follow OAuth login (Max plan)"
else
  echo "  ❌ Claude Code not installed"
  echo "  📋 Install: npm install -g @anthropic-ai/claude-code"
fi
echo ""

# === 2. Gemini CLI ===
echo "🔮 [2/4] Gemini CLI (Captain — 2 accounts)"
echo "------------------------------------------"
if command -v gemini &>/dev/null; then
  echo "  ✅ Gemini CLI installed"
else
  echo "  ❌ Gemini CLI not installed"
  echo "  📋 Install: npm install -g @google/gemini-cli"
fi
echo ""
echo "  Account A (Research): Set GEMINI_API_KEY_A in .env"
echo "  Account B (Validator): Set GEMINI_API_KEY_B in .env"
echo ""
echo "  💡 Profile separation:"
echo "    - Create ~/.gemini/profile_a.json and profile_b.json"
echo "    - Each session uses GEMINI_PROFILE env var to switch"
echo ""

# === 3. OpenClaw (Hunter) ===
echo "🐱 [3/4] OpenClaw / ChatGPT Pro (Hunter)"
echo "------------------------------------------"
echo "  ⚠️  Setup on HUNTER machine (not Captain)"
echo "  📋 Steps:"
echo "    1. SSH to hunter: ssh hunter"
echo "    2. Install OpenClaw (browser automation for ChatGPT)"
echo "    3. Login with ChatGPT Pro account (isolated Google account)"
echo "    4. Verify: no personal info in hunter's environment"
echo ""

# === 4. Environment file ===
echo "📄 [4/4] Environment Variables"
echo "------------------------------------------"
if [ -f .env ]; then
  echo "  ✅ .env file exists"
  echo "  Checking required vars..."

  REQUIRED_VARS=(
    "TELEGRAM_BOT_TOKEN"
    "TELEGRAM_CHAT_ID"
    "SLACK_BOT_TOKEN"
    "GATEWAY_PORT"
  )

  for var in "${REQUIRED_VARS[@]}"; do
    if grep -q "^${var}=" .env 2>/dev/null; then
      echo "    ✅ $var is set"
    else
      echo "    ❌ $var is missing"
    fi
  done
else
  echo "  ❌ .env file not found"
  echo "  📋 Create from template: cp .env.example .env"
fi

echo ""
echo "=========================================="
echo " Manual steps required:"
echo "  1. Create Telegram bot via @BotFather"
echo "  2. Create Slack workspace + bot token"
echo "  3. Copy .env.example to .env and fill in values"
echo "  4. Run 'claude' to complete OAuth login"
echo "=========================================="

---

## 파일: [OPS] scripts/setup/setup_colima.sh

#!/usr/bin/env bash
# Install and configure Colima + Docker for FAS
# Requires: Homebrew
#
# Colima provides lightweight Docker runtime on macOS (Apple Silicon native)

set -euo pipefail

echo "[FAS] Setting up Colima + Docker..."

# === 1. Install dependencies ===
if ! command -v colima &>/dev/null; then
  echo "[FAS] Installing Colima..."
  brew install colima
else
  echo "[FAS] Colima already installed: $(colima version | head -1)"
fi

if ! command -v docker &>/dev/null; then
  echo "[FAS] Installing Docker CLI + Compose..."
  brew install docker docker-compose
else
  echo "[FAS] Docker already installed: $(docker --version)"
fi

# === 2. Start Colima with optimized settings for Mac Studio ===
# CPU: 2 cores (n8n doesn't need much)
# Memory: 4GB (n8n + headroom)
# Disk: 20GB
if ! colima status 2>/dev/null | grep -q "Running"; then
  echo "[FAS] Starting Colima..."
  colima start \
    --cpu 2 \
    --memory 4 \
    --disk 20 \
    --arch aarch64 \
    --vm-type vz \
    --mount-type virtiofs
  echo "[FAS] Colima started."
else
  echo "[FAS] Colima already running."
fi

# === 3. Verify Docker ===
echo "[FAS] Docker info:"
docker info --format '  Runtime: {{.ServerVersion}}'
docker info --format '  OS: {{.OperatingSystem}}'
docker info --format '  CPUs: {{.NCPU}}'
docker info --format '  Memory: {{.MemTotal}}'

echo ""
echo "[FAS] Colima + Docker setup complete!"
echo "[FAS] To start n8n: cd $(dirname "$0")/../.. && docker compose up -d"

---

## 파일: [OPS] scripts/setup/setup_gemini_cli.sh

#!/usr/bin/env bash
# FAS Gemini CLI Session Setup for Captain
# Checks prerequisites, validates configs, installs launchd plists,
# and starts tmux sessions for Gemini CLI accounts A and B.
#
# Usage: bash scripts/setup/setup_gemini_cli.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAS_ROOT="${SCRIPT_DIR}/../.."
LOG_DIR="${FAS_ROOT}/logs"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
GEMINI_CONFIG_A="$HOME/.config/gemini/account-a"
GEMINI_CONFIG_B="$HOME/.config/gemini/account-b"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; }

echo "=========================================="
echo " FAS Gemini CLI Setup"
echo "=========================================="
echo ""

# === Step 1: Check gemini CLI is installed ===
echo "[1/6] Checking Gemini CLI installation..."
if command -v gemini &>/dev/null; then
  GEMINI_VERSION=$(gemini --version 2>/dev/null || echo "unknown")
  info "Gemini CLI installed (version: $GEMINI_VERSION)"
else
  fail "Gemini CLI not found"
  echo "  Install with: npm install -g @google/gemini-cli"
  echo "  Or: npx @google/gemini-cli"
  exit 1
fi
echo ""

# === Step 2: Check account A config ===
echo "[2/6] Checking Account A (Research) config..."
if [ -d "$GEMINI_CONFIG_A" ]; then
  info "Account A config exists at $GEMINI_CONFIG_A"
else
  warn "Account A config not found at $GEMINI_CONFIG_A"
  echo "  To set up Account A:"
  echo "    1. mkdir -p $GEMINI_CONFIG_A"
  echo "    2. Run: GEMINI_CONFIG_DIR=$GEMINI_CONFIG_A gemini"
  echo "    3. Follow the Google OAuth flow for Account A"
  echo ""
  read -p "  Set up Account A now? (y/N) " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    mkdir -p "$GEMINI_CONFIG_A"
    echo "  Starting Gemini CLI for Account A auth..."
    GEMINI_CONFIG_DIR="$GEMINI_CONFIG_A" gemini --version
    echo "  Please complete the authentication in the browser."
  fi
fi
echo ""

# === Step 3: Check account B config ===
echo "[3/6] Checking Account B (Cross-verification) config..."
if [ -d "$GEMINI_CONFIG_B" ]; then
  info "Account B config exists at $GEMINI_CONFIG_B"
else
  warn "Account B config not found at $GEMINI_CONFIG_B"
  echo "  To set up Account B:"
  echo "    1. mkdir -p $GEMINI_CONFIG_B"
  echo "    2. Run: GEMINI_CONFIG_DIR=$GEMINI_CONFIG_B gemini"
  echo "    3. Follow the Google OAuth flow for Account B"
  echo ""
  read -p "  Set up Account B now? (y/N) " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    mkdir -p "$GEMINI_CONFIG_B"
    echo "  Starting Gemini CLI for Account B auth..."
    GEMINI_CONFIG_DIR="$GEMINI_CONFIG_B" gemini --version
    echo "  Please complete the authentication in the browser."
  fi
fi
echo ""

# === Step 4: Ensure logs directory exists ===
echo "[4/6] Ensuring logs directory..."
mkdir -p "$LOG_DIR"
info "Logs directory ready: $LOG_DIR"
echo ""

# === Step 5: Install launchd plists ===
echo "[5/6] Installing launchd plists..."
mkdir -p "$LAUNCH_AGENTS_DIR"

for ACCOUNT in a b; do
  PLIST_NAME="com.fas.gemini-${ACCOUNT}.plist"
  SRC="${SCRIPT_DIR}/${PLIST_NAME}"
  DEST="${LAUNCH_AGENTS_DIR}/${PLIST_NAME}"

  if [ ! -f "$SRC" ]; then
    fail "Plist source not found: $SRC"
    continue
  fi

  # Unload existing if loaded
  if launchctl list | grep -q "com.fas.gemini-${ACCOUNT}" 2>/dev/null; then
    echo "  Unloading existing com.fas.gemini-${ACCOUNT}..."
    launchctl unload "$DEST" 2>/dev/null || true
  fi

  cp "$SRC" "$DEST"
  info "Installed $PLIST_NAME to $LAUNCH_AGENTS_DIR"

  launchctl load "$DEST"
  info "Loaded com.fas.gemini-${ACCOUNT} into launchd"
done
echo ""

# === Step 6: Start tmux sessions ===
echo "[6/6] Starting Gemini CLI tmux sessions..."
GEMINI_STARTER="${FAS_ROOT}/scripts/gemini/start_gemini_sessions.sh"

if [ -f "$GEMINI_STARTER" ]; then
  bash "$GEMINI_STARTER" all
  info "Gemini CLI sessions started"
else
  warn "Session starter not found: $GEMINI_STARTER"
  echo "  You can start sessions manually:"
  echo "    tmux new-session -d -s fas-gemini-a 'bash scripts/gemini/gemini_wrapper.sh a'"
  echo "    tmux new-session -d -s fas-gemini-b 'bash scripts/gemini/gemini_wrapper.sh b'"
fi
echo ""

echo "=========================================="
echo " Setup complete!"
echo ""
echo " Verify sessions:"
echo "   tmux ls"
echo ""
echo " Attach to session:"
echo "   tmux attach -t fas-gemini-a"
echo "   tmux attach -t fas-gemini-b"
echo ""
echo " Check logs:"
echo "   tail -f $LOG_DIR/gemini-a.log"
echo "   tail -f $LOG_DIR/gemini-b.log"
echo "=========================================="

---

## 파일: [OPS] scripts/setup/setup_hunter.sh

#!/usr/bin/env bash
# Hunter machine initial setup script
# Run this once on the hunter machine to configure the environment:
#   chmod +x scripts/setup/setup_hunter.sh && ./scripts/setup/setup_hunter.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Default values
DEFAULT_PROFILE_DIR="./fas-google-profile-hunter"
DEFAULT_CAPTAIN_URL="http://[MASKED_IP]:3100"

echo "=== FAS Hunter Machine Setup ==="
echo ""

# ===== Step 0: Account isolation check (SA-001) =====
echo "[0/8] SECURITY: Verifying account isolation..."

if command -v claude &>/dev/null; then
  CLAUDE_USER=$(claude whoami 2>/dev/null || echo "not_logged_in")
  if echo "$CLAUDE_USER" | grep -qi "not_logged_in\|error"; then
    echo "  ✓ Claude Code not logged in — will need Account B login"
  else
    echo ""
    echo "  ⚠️  WARNING: Claude Code is already logged in as:"
    echo "     $CLAUDE_USER"
    echo ""
    echo "  ╔══════════════════════════════════════════════════════════════╗"
    echo "  ║  SECURITY CRITICAL (SA-001)                                 ║"
    echo "  ║  헌터는 반드시 계정 B(별도 격리 계정)를 사용해야 합니다.      ║"
    echo "  ║  주인님 개인 계정(계정 A)으로 로그인되어 있으면 보안 위반!     ║"
    echo "  ║                                                             ║"
    echo "  ║  계정 A(주인님 개인)라면:                                     ║"
    echo "  ║    1. claude logout                                         ║"
    echo "  ║    2. 계정 B로 claude login                                  ║"
    echo "  ║                                                             ║"
    echo "  ║  이미 계정 B라면 Enter를 눌러 계속 진행하세요.               ║"
    echo "  ╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "  계정 B가 맞습니까? (y/N): "
    read -r CONFIRM
    if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
      echo "  → 먼저 계정 B로 전환 후 이 스크립트를 다시 실행하세요."
      echo "    claude logout && claude login"
      exit 1
    fi
  fi
else
  echo "  ✓ Claude Code not installed yet — will set up with Account B"
fi
echo ""

# ===== Step 1: Check prerequisites =====
echo "[1/8] Checking prerequisites..."

# Check Node.js version (20+)
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is not installed. Install Node.js 20+ first."
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required (found v$NODE_VERSION). Please upgrade."
  exit 1
fi
echo "  ✓ Node.js $(node -v)"

# Check pnpm
if ! command -v pnpm &>/dev/null; then
  echo "ERROR: pnpm is not installed. Install with: npm install -g pnpm"
  exit 1
fi
echo "  ✓ pnpm $(pnpm -v)"

# Check if Playwright is available
if ! npx playwright --version &>/dev/null 2>&1; then
  echo "  ! Playwright not found — will install in next step"
else
  echo "  ✓ Playwright $(npx playwright --version 2>/dev/null)"
fi

# ===== Step 2: Install Playwright browsers =====
echo ""
echo "[2/8] Installing Playwright Chromium browser..."
cd "$PROJECT_ROOT"
pnpm install
npx playwright install chromium
echo "  ✓ Chromium installed"

# ===== Step 3: Create Google profile directory =====
echo ""
echo "[3/8] Creating Google Chrome profile directory..."
PROFILE_DIR="${GOOGLE_PROFILE_DIR:-$DEFAULT_PROFILE_DIR}"

if [ -d "$PROFILE_DIR" ]; then
  echo "  ✓ Profile directory already exists: $PROFILE_DIR"
else
  mkdir -p "$PROFILE_DIR"
  echo "  ✓ Created profile directory: $PROFILE_DIR"
fi

# ===== Step 4: Launch Chrome for manual Google login =====
echo ""
echo "[4/8] Launching Chrome for manual Google login..."
echo "  → A Chrome window will open. Please:"
echo "    1. Sign in to your Google account"
echo "    2. Visit https://gemini.google.com/ and accept any terms"
echo "    3. Visit https://notebooklm.google.com/ and accept any terms"
echo "    4. Close the browser window when done"
echo ""
echo "  Press Enter to open Chrome..."
read -r

# Find Chromium binary — try Playwright's bundled version first
CHROMIUM_PATH=$(npx playwright install --dry-run chromium 2>/dev/null | grep -o '/.*chromium.*' | head -1 || true)

if [ -z "$CHROMIUM_PATH" ] || [ ! -f "$CHROMIUM_PATH" ]; then
  # Fallback: use system Chrome/Chromium
  if command -v chromium &>/dev/null; then
    CHROMIUM_PATH="chromium"
  elif command -v google-chrome &>/dev/null; then
    CHROMIUM_PATH="google-chrome"
  elif [ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  else
    echo "  WARNING: Cannot find Chrome/Chromium binary."
    echo "  Please manually open Chrome with: chromium --user-data-dir=$PROFILE_DIR"
    CHROMIUM_PATH=""
  fi
fi

if [ -n "$CHROMIUM_PATH" ]; then
  "$CHROMIUM_PATH" --user-data-dir="$PROFILE_DIR" \
    "https://accounts.google.com" \
    "https://gemini.google.com/" \
    "https://notebooklm.google.com/" &
  CHROME_PID=$!
  echo "  Chrome launched (PID: $CHROME_PID). Close it when login is complete."
  echo "  Press Enter after closing Chrome..."
  read -r
fi

# ===== Step 5: Create .env from .env.example =====
echo ""
echo "[5/8] Setting up .env file..."
cd "$PROJECT_ROOT"

if [ -f ".env" ]; then
  echo "  ✓ .env already exists — skipping (edit manually if needed)"
else
  if [ -f ".env.example" ]; then
    cp .env.example .env
    # Set hunter-specific defaults
    sed -i.bak "s|CAPTAIN_API_URL=.*|CAPTAIN_API_URL=${DEFAULT_CAPTAIN_URL}|" .env
    sed -i.bak "s|GOOGLE_PROFILE_DIR=.*|GOOGLE_PROFILE_DIR=${PROFILE_DIR}|" .env
    sed -i.bak "s|FAS_DEVICE=.*|FAS_DEVICE=hunter|" .env
    rm -f .env.bak
    echo "  ✓ Created .env from .env.example with hunter defaults"
    echo "  → Edit .env to set CAPTAIN_API_URL to your captain's Tailscale IP"
  else
    echo "  WARNING: .env.example not found. Create .env manually."
  fi
fi

# ===== Step 6: Verify Tailscale connection =====
echo ""
echo "[6/8] Checking Tailscale connection..."

if ! command -v tailscale &>/dev/null; then
  echo "  WARNING: Tailscale not found. Install Tailscale for secure captain connection."
else
  TAILSCALE_STATUS=$(tailscale status 2>/dev/null | head -1 || echo "error")
  if echo "$TAILSCALE_STATUS" | grep -qi "logged out\|stopped\|error"; then
    echo "  WARNING: Tailscale is not connected. Run: tailscale up"
  else
    echo "  ✓ Tailscale is running"
    tailscale status 2>/dev/null | head -5
  fi
fi

# ===== Step 7: Test API connectivity =====
echo ""
echo "[7/8] Testing captain API connectivity..."

CAPTAIN_URL="${CAPTAIN_API_URL:-$DEFAULT_CAPTAIN_URL}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "${CAPTAIN_URL}/api/health" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  echo "  ✓ Captain API reachable at ${CAPTAIN_URL}"
elif [ "$HTTP_CODE" = "000" ]; then
  echo "  WARNING: Cannot reach captain at ${CAPTAIN_URL}"
  echo "  → Make sure captain is running and Tailscale is connected"
else
  echo "  WARNING: Captain returned HTTP ${HTTP_CODE}"
fi

# ===== Step 8: Final account isolation verification =====
echo ""
echo "[8/8] Final security check..."

if command -v claude &>/dev/null; then
  echo "  Claude Code account verification:"
  claude whoami 2>/dev/null || echo "  (not logged in — run: claude login with Account B)"
fi

echo ""
echo "  ╔══════════════════════════════════════════════════════════╗"
echo "  ║  CHECKLIST (셋업 완료 전 확인)                           ║"
echo "  ║  □ Claude Code = 계정 B (별도 격리 계정)                  ║"
echo "  ║  □ Google Chrome 프로필 = 별도 구글 계정 (계정 A 아님)    ║"
echo "  ║  □ ChatGPT Pro = 별도 계정                               ║"
echo "  ║  □ 주인님 개인정보가 이 머신에 저장되지 않았는지 확인     ║"
echo "  ╚══════════════════════════════════════════════════════════╝"

# ===== Done =====
echo ""
echo "=== Setup Complete ==="
echo ""
echo "To start the hunter agent:"
echo "  pnpm run hunter"
echo ""
echo "If Google login expired, re-run this script or:"
echo "  chromium --user-data-dir=$PROFILE_DIR https://accounts.google.com"

---

## 파일: [OPS] scripts/setup/setup_tmux.sh

#!/usr/bin/env bash
# FAS tmux environment setup script
# Sets up tmux configuration and session naming conventions
#
# Captain sessions: fas-claude, fas-gemini-a, fas-gemini-b, fas-n8n, fas-gateway, fas-watchdog
# Hunter sessions:  fas-openclaw, fas-watchdog

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "[FAS] Setting up tmux environment..."

# === 1. Install tmux-resurrect (if not already installed) ===
TMUX_PLUGINS_DIR="$HOME/.tmux/plugins"
RESURRECT_DIR="$TMUX_PLUGINS_DIR/tmux-resurrect"

if [ ! -d "$RESURRECT_DIR" ]; then
  echo "[FAS] Installing tmux-resurrect..."
  mkdir -p "$TMUX_PLUGINS_DIR"
  git clone https://github.com/[MASKED_USER]/tmux-resurrect "$RESURRECT_DIR"
  echo "[FAS] tmux-resurrect installed at $RESURRECT_DIR"
else
  echo "[FAS] tmux-resurrect already installed."
fi

# === 2. Create resurrect state directory ===
mkdir -p "$PROJECT_ROOT/.tmux/resurrect"

# === 3. Source FAS tmux config ===
TMUX_CONF="$HOME/.tmux.conf"
FAS_CONF_LINE="source-file $PROJECT_ROOT/config/tmux.conf"

if [ -f "$TMUX_CONF" ]; then
  if ! grep -q "FAS-operations" "$TMUX_CONF"; then
    echo "" >> "$TMUX_CONF"
    echo "# FAS tmux configuration" >> "$TMUX_CONF"
    echo "$FAS_CONF_LINE" >> "$TMUX_CONF"
    echo "[FAS] Added FAS config to existing $TMUX_CONF"
  else
    echo "[FAS] FAS config already referenced in $TMUX_CONF"
  fi
else
  echo "# FAS tmux configuration" > "$TMUX_CONF"
  echo "$FAS_CONF_LINE" >> "$TMUX_CONF"
  echo "[FAS] Created $TMUX_CONF with FAS config"
fi

# === 4. Load resurrect plugin in tmux.conf ===
if [ -d "$RESURRECT_DIR" ] && ! grep -q "tmux-resurrect" "$TMUX_CONF"; then
  echo "run-shell $RESURRECT_DIR/resurrect.tmux" >> "$TMUX_CONF"
  echo "[FAS] Added tmux-resurrect plugin to $TMUX_CONF"
fi

echo "[FAS] tmux setup complete!"
echo "[FAS] Run 'scripts/start_captain_sessions.sh' to create all FAS sessions."

---

## 파일: [OPS] scripts/start_captain_sessions.sh

#!/usr/bin/env bash
# Start all FAS tmux sessions on Captain
# Naming convention: fas-{service}
#
# Sessions:
#   fas-claude    - Claude Code (interactive AI agent)
#   fas-gemini-a  - Gemini CLI Account A (research)
#   fas-gemini-b  - Gemini CLI Account B (validator)
#   fas-n8n       - n8n orchestrator (Docker/Colima)
#   fas-gateway   - Express Gateway + Task API
#   fas-watchdog  - System watchdog daemon

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[FAS] Starting Captain tmux sessions..."

# Helper: create session if it doesn't exist
create_session() {
  local session_name="$1"
  local start_command="$2"
  local working_dir="${3:-$PROJECT_ROOT}"

  if tmux has-session -t "$session_name" 2>/dev/null; then
    echo "[FAS] Session '$session_name' already exists, skipping."
  else
    tmux new-session -d -s "$session_name" -c "$working_dir"
    if [ -n "$start_command" ]; then
      tmux send-keys -t "$session_name" "$start_command" C-m
    fi
    echo "[FAS] Created session '$session_name'"
  fi
}

# === Create sessions ===

# Gateway + Task API (start first, other services depend on it)
create_session "fas-gateway" "pnpm run gateway" "$PROJECT_ROOT"

# Watchdog
create_session "fas-watchdog" "pnpm run watcher" "$PROJECT_ROOT"

# n8n (Docker/Colima) — only if colima is installed
if command -v colima &>/dev/null; then
  create_session "fas-n8n" "cd $PROJECT_ROOT && docker compose up" "$PROJECT_ROOT"
else
  echo "[FAS] Colima not installed, skipping fas-n8n session."
fi

# Claude Code — interactive session, no auto-command
create_session "fas-claude" "" "$PROJECT_ROOT"

# Gemini CLI sessions — placeholder until auth is configured
create_session "fas-gemini-a" "echo 'Gemini A: waiting for auth setup'" "$PROJECT_ROOT"
create_session "fas-gemini-b" "echo 'Gemini B: waiting for auth setup'" "$PROJECT_ROOT"

echo ""
echo "[FAS] Captain sessions ready. List with: tmux list-sessions"
echo "[FAS] Attach to a session: tmux attach -t fas-claude"

---

## 파일: [OPS] scripts/status.sh

#!/usr/bin/env bash
# Show status of all FAS tmux sessions and services

set -euo pipefail

echo "=========================================="
echo " FAS System Status"
echo "=========================================="
echo ""

# === tmux sessions ===
echo "📺 tmux Sessions:"
echo "------------------------------------------"
if tmux list-sessions 2>/dev/null | grep -q "fas-"; then
  tmux list-sessions 2>/dev/null | grep "fas-" | while read -r line; do
    echo "  ✅ $line"
  done
else
  echo "  ❌ No FAS sessions running"
fi
echo ""

# === Gateway health check ===
echo "🌐 Gateway (port 3100):"
echo "------------------------------------------"
if curl -s --max-time 2 http://localhost:3100/api/health >/dev/null 2>&1; then
  HEALTH=$(curl -s --max-time 2 http://localhost:3100/api/health)
  echo "  ✅ Online - $HEALTH"
else
  echo "  ❌ Offline"
fi
echo ""

# === Docker/n8n ===
echo "🐳 Docker (Colima):"
echo "------------------------------------------"
if command -v colima &>/dev/null && colima status 2>/dev/null | grep -q "Running"; then
  echo "  ✅ Colima running"
  if command -v docker &>/dev/null; then
    docker ps --format "  📦 {{.Names}} ({{.Status}})" 2>/dev/null || echo "  ❌ Docker not responding"
  fi
else
  echo "  ❌ Colima not running"
fi
echo ""

# === System resources ===
echo "💻 System Resources:"
echo "------------------------------------------"
echo "  CPU: $(sysctl -n hw.ncpu) cores"
echo "  RAM: $(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))GB total"
echo "  Disk: $(df -h / | awk 'NR==2 {print $4 " available"}')"
echo ""
echo "=========================================="

---

## 파일: [OPS] scripts/stop_all.sh

#!/usr/bin/env bash
# Stop all FAS tmux sessions gracefully
# Sends SIGTERM to running processes, then kills sessions

set -euo pipefail

echo "[FAS] Stopping all FAS sessions..."

FAS_SESSIONS=("fas-gateway" "fas-watchdog" "fas-n8n" "fas-claude" "fas-gemini-a" "fas-gemini-b" "fas-crawlers")

for session in "${FAS_SESSIONS[@]}"; do
  if tmux has-session -t "$session" 2>/dev/null; then
    # Send Ctrl+C to gracefully stop running processes
    tmux send-keys -t "$session" C-c
    sleep 1
    tmux kill-session -t "$session"
    echo "[FAS] Killed session '$session'"
  fi
done

echo "[FAS] All FAS sessions stopped."

---

## 파일: [OPS] scripts/test_notifications.ts

// Quick integration test: send real messages to Telegram and Slack
import 'dotenv/config';
import { create_telegram_client } from '../src/notification/telegram.js';
import { create_slack_client } from '../src/notification/slack.js';

const run = async () => {
  let telegram_ok = false;
  let slack_ok = false;

  // === Telegram ===
  console.log('[TEST] Telegram 전송 중...');
  try {
    const tg = create_telegram_client({
      token: process.env.TELEGRAM_BOT_TOKEN!,
      chat_id: process.env.TELEGRAM_CHAT_ID!,
    });
    const result = await tg.send('🧪 *FAS 테스트* — Telegram 연동 성공!', 'alert');
    telegram_ok = result.success;
    console.log('[Telegram]', result.success ? '✅ 성공' : '❌ 실패', result);
    tg.stop();
  } catch (err) {
    console.error('[Telegram] ❌ 에러:', err);
  }

  // === Slack ===
  console.log('[TEST] Slack 전송 중...');
  try {
    const slack = create_slack_client({
      token: process.env.SLACK_BOT_TOKEN!,
    });
    const result = await slack.send('#fas-alerts', '🧪 *FAS 테스트* — Slack 연동 성공!');
    slack_ok = result;
    console.log('[Slack]', result ? '✅ 성공' : '❌ 실패');
  } catch (err) {
    console.error('[Slack] ❌ 에러:', err);
  }

  // === Summary ===
  console.log('\n========== 결과 ==========');
  console.log(`Telegram: ${telegram_ok ? '✅' : '❌'}`);
  console.log(`Slack:    ${slack_ok ? '✅' : '❌'}`);

  process.exit(telegram_ok && slack_ok ? 0 : 1);
};

run();

---
