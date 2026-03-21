// TDD tests for schedule wiring — verifies that housing_lottery, bigtech_jobs,
// and weekly_test schedules are correctly loaded and create tasks via planning_loop.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_planning_loop } from './planning_loop.js';
import { create_task_store, type TaskStore } from '../gateway/task_store.js';
import type { NotificationRouter } from '../notification/router.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Mock the Gemini CLI wrapper (required by planning_loop module)
vi.mock('../gemini/cli_wrapper.js', () => ({
  spawn_gemini: vi.fn(),
}));

// === Helpers ===

const create_mock_router = (): NotificationRouter => ({
  route: vi.fn().mockResolvedValue({ telegram: true, slack: true, notion: false }),
  get_rules: vi.fn().mockReturnValue(null),
});

// Path to the real schedules.yml
const SCHEDULES_PATH = join(import.meta.dirname ?? __dirname, 'schedules.yml');

describe('Schedule Wiring — housing_lottery, bigtech_jobs, weekly_test', () => {
  let store: TaskStore;
  let router: NotificationRouter;

  beforeEach(() => {
    store = create_task_store({ db_path: ':memory:' });
    router = create_mock_router();
  });

  afterEach(() => {
    store.close();
  });

  // ========================================
  // 1. schedules.yml loads and contains the 3 new entries
  // ========================================

  describe('schedules.yml loading', () => {
    it('should load schedules.yml without errors', () => {
      // Given: the real schedules.yml path
      const loop = create_planning_loop({
        store,
        router,
        schedules_path: SCHEDULES_PATH,
      });

      // When: loading schedules
      const schedules = loop._load_schedules();

      // Then: should have entries
      expect(Object.keys(schedules).length).toBeGreaterThan(0);
    });

    it('should contain housing_lottery entry', () => {
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH });
      const schedules = loop._load_schedules();

      expect(schedules.housing_lottery).toBeDefined();
      expect(schedules.housing_lottery.title).toBe('청약홈 공고 스캔');
      expect(schedules.housing_lottery.type).toBe('every_3_days');
      expect(schedules.housing_lottery.agent).toBe('hunter');
      expect(schedules.housing_lottery.action).toBe('web_crawl');
    });

    it('should contain bigtech_jobs entry', () => {
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH });
      const schedules = loop._load_schedules();

      expect(schedules.bigtech_jobs).toBeDefined();
      expect(schedules.bigtech_jobs.title).toBe('빅테크 채용공고 스캔');
      expect(schedules.bigtech_jobs.type).toBe('every_3_days');
      expect(schedules.bigtech_jobs.agent).toBe('hunter');
      expect(schedules.bigtech_jobs.action).toBe('web_crawl');
    });

    it('should contain weekly_test entry', () => {
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH });
      const schedules = loop._load_schedules();

      expect(schedules.weekly_test).toBeDefined();
      expect(schedules.weekly_test.title).toBe('주간 테스트 생성');
      expect(schedules.weekly_test.type).toBe('weekly');
      expect(schedules.weekly_test.day).toBe('friday');
      expect(schedules.weekly_test.agent).toBe('claude');
      expect(schedules.weekly_test.action).toBe('generate_test');
    });
  });

  // ========================================
  // 2. housing_lottery wiring — every_3_days
  // ========================================

  describe('housing_lottery wiring (every_3_days)', () => {
    it('should create housing_lottery task on day 0 from epoch', async () => {
      // Given: epoch day (day 0, divisible by 3)
      const epoch = new Date('2026-01-01T00:00:00Z');
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH, epoch });

      // When: running morning on epoch day
      const result = await loop.run_morning(new Date('2026-01-01T07:00:00Z'));

      // Then: housing_lottery should be created
      expect(result.created).toContain('청약홈 공고 스캔');
    });

    it('should NOT create housing_lottery task on day 1 from epoch', async () => {
      // Given: day 1 (not divisible by 3)
      const epoch = new Date('2026-01-01T00:00:00Z');
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH, epoch });

      // When: running morning on day 1
      const result = await loop.run_morning(new Date('2026-01-02T07:00:00Z'));

      // Then: housing_lottery should NOT be created
      expect(result.created).not.toContain('청약홈 공고 스캔');
    });

    it('should create housing_lottery task on day 3 from epoch', async () => {
      // Given: day 3 (divisible by 3)
      const epoch = new Date('2026-01-01T00:00:00Z');
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH, epoch });

      // When: running morning on day 3
      const result = await loop.run_morning(new Date('2026-01-04T07:00:00Z'));

      // Then: housing_lottery should be created
      expect(result.created).toContain('청약홈 공고 스캔');
    });

    it('should set correct task properties for housing_lottery', async () => {
      const epoch = new Date('2026-01-01T00:00:00Z');
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH, epoch });

      await loop.run_morning(new Date('2026-01-01T07:00:00Z'));

      // Verify task was stored with correct properties
      const all_tasks = store.get_all();
      const housing_task = all_tasks.find((t) => t.title === '청약홈 공고 스캔');

      expect(housing_task).toBeDefined();
      expect(housing_task!.assigned_to).toBe('hunter');
      expect(housing_task!.action).toBe('web_crawl');
      expect(housing_task!.risk_level).toBe('low');
      expect(housing_task!.requires_personal_info).toBe(false);
      expect(housing_task!.status).toBe('pending');
    });
  });

  // ========================================
  // 3. bigtech_jobs wiring — every_3_days
  // ========================================

  describe('bigtech_jobs wiring (every_3_days)', () => {
    it('should create bigtech_jobs task on day 0 from epoch', async () => {
      const epoch = new Date('2026-01-01T00:00:00Z');
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH, epoch });

      const result = await loop.run_morning(new Date('2026-01-01T07:00:00Z'));

      expect(result.created).toContain('빅테크 채용공고 스캔');
    });

    it('should NOT create bigtech_jobs task on day 2 from epoch', async () => {
      const epoch = new Date('2026-01-01T00:00:00Z');
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH, epoch });

      const result = await loop.run_morning(new Date('2026-01-03T07:00:00Z'));

      expect(result.created).not.toContain('빅테크 채용공고 스캔');
    });

    it('should set correct task properties for bigtech_jobs', async () => {
      const epoch = new Date('2026-01-01T00:00:00Z');
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH, epoch });

      await loop.run_morning(new Date('2026-01-01T07:00:00Z'));

      const all_tasks = store.get_all();
      const job_task = all_tasks.find((t) => t.title === '빅테크 채용공고 스캔');

      expect(job_task).toBeDefined();
      expect(job_task!.assigned_to).toBe('hunter');
      expect(job_task!.action).toBe('web_crawl');
      expect(job_task!.risk_level).toBe('low');
      expect(job_task!.requires_personal_info).toBe(false);
    });

    it('should create both housing_lottery and bigtech_jobs on same day', async () => {
      // Both are every_3_days, so they should fire on the same days
      const epoch = new Date('2026-01-01T00:00:00Z');
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH, epoch });

      const result = await loop.run_morning(new Date('2026-01-01T07:00:00Z'));

      expect(result.created).toContain('청약홈 공고 스캔');
      expect(result.created).toContain('빅테크 채용공고 스캔');
    });
  });

  // ========================================
  // 4. weekly_test wiring — every Friday 22:00
  // ========================================

  describe('weekly_test wiring (weekly/friday)', () => {
    it('should create weekly_test task on Friday', async () => {
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH });

      // 2026-03-20 is a Friday (use 07:00Z to stay same day in all timezones)
      const result = await loop.run_morning(new Date('2026-03-20T07:00:00Z'));

      expect(result.created).toContain('주간 테스트 생성');
    });

    it('should NOT create weekly_test task on Monday', async () => {
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH });

      // 2026-03-16 is a Monday
      const result = await loop.run_morning(new Date('2026-03-16T07:00:00Z'));

      expect(result.created).not.toContain('주간 테스트 생성');
    });

    it('should NOT create weekly_test task on Thursday', async () => {
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH });

      // 2026-03-19 is a Thursday
      const result = await loop.run_morning(new Date('2026-03-19T07:00:00Z'));

      expect(result.created).not.toContain('주간 테스트 생성');
    });

    it('should NOT create weekly_test task on Saturday', async () => {
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH });

      // 2026-03-21 is a Saturday
      const result = await loop.run_morning(new Date('2026-03-21T07:00:00Z'));

      expect(result.created).not.toContain('주간 테스트 생성');
    });

    it('should set correct task properties for weekly_test', async () => {
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH });

      // 2026-03-20 is a Friday (use 07:00Z to stay same day in all timezones)
      await loop.run_morning(new Date('2026-03-20T07:00:00Z'));

      const all_tasks = store.get_all();
      const test_task = all_tasks.find((t) => t.title === '주간 테스트 생성');

      expect(test_task).toBeDefined();
      expect(test_task!.assigned_to).toBe('claude');
      expect(test_task!.action).toBe('generate_test');
      expect(test_task!.risk_level).toBe('low');
      expect(test_task!.requires_personal_info).toBe(false);
      expect(test_task!.mode).toBe('recurring');
    });
  });

  // ========================================
  // 4b. remote_degree_check wiring — monthly on 1st
  // ========================================

  describe('remote_degree_check wiring (monthly/1st)', () => {
    it('should contain remote_degree_check entry in schedules.yml', () => {
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH });
      const schedules = loop._load_schedules();

      expect(schedules.remote_degree_check).toBeDefined();
      expect(schedules.remote_degree_check.title).toBe('원격 학위 과정 조사');
      expect(schedules.remote_degree_check.type).toBe('monthly');
      expect(schedules.remote_degree_check.agent).toBe('gemini_a');
      expect(schedules.remote_degree_check.action).toBe('research');
    });

    it('should create remote_degree_check task on 1st of month', async () => {
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH });

      // 2026-04-01 is the 1st of April
      const result = await loop.run_morning(new Date('2026-04-01T07:00:00Z'));

      expect(result.created).toContain('원격 학위 과정 조사');
    });

    it('should NOT create remote_degree_check task on 2nd of month', async () => {
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH });

      // 2026-04-02 is the 2nd
      const result = await loop.run_morning(new Date('2026-04-02T07:00:00Z'));

      expect(result.created).not.toContain('원격 학위 과정 조사');
    });

    it('should set correct task properties for remote_degree_check', async () => {
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH });

      await loop.run_morning(new Date('2026-04-01T07:00:00Z'));

      const all_tasks = store.get_all();
      const degree_task = all_tasks.find((t) => t.title === '원격 학위 과정 조사');

      expect(degree_task).toBeDefined();
      expect(degree_task!.assigned_to).toBe('gemini_a');
      expect(degree_task!.action).toBe('research');
      expect(degree_task!.risk_level).toBe('low');
      expect(degree_task!.requires_personal_info).toBe(false);
    });
  });

  // ========================================
  // 5. Deduplication — all 3 schedules
  // ========================================

  describe('deduplication', () => {
    it('should not duplicate housing_lottery on second run', async () => {
      const epoch = new Date('2026-01-01T00:00:00Z');
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH, epoch });

      // First run
      await loop.run_morning(new Date('2026-01-01T07:00:00Z'));

      // Second run — same day
      const result2 = await loop.run_morning(new Date('2026-01-01T08:00:00Z'));

      expect(result2.skipped).toContainEqual(expect.stringContaining('청약홈 공고 스캔'));
      expect(result2.created).not.toContain('청약홈 공고 스캔');
    });

    it('should not duplicate bigtech_jobs on second run', async () => {
      const epoch = new Date('2026-01-01T00:00:00Z');
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH, epoch });

      await loop.run_morning(new Date('2026-01-01T07:00:00Z'));
      const result2 = await loop.run_morning(new Date('2026-01-01T08:00:00Z'));

      expect(result2.skipped).toContainEqual(expect.stringContaining('빅테크 채용공고 스캔'));
    });

    it('should not duplicate weekly_test on second run', async () => {
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH });

      // 2026-03-20 is a Friday (use 07:00Z to stay same day in all timezones)
      await loop.run_morning(new Date('2026-03-20T07:00:00Z'));
      const result2 = await loop.run_morning(new Date('2026-03-20T08:00:00Z'));

      expect(result2.skipped).toContainEqual(expect.stringContaining('주간 테스트 생성'));
    });
  });

  // ========================================
  // 6. System workflows should still be skipped
  // ========================================

  describe('system workflows', () => {
    it('should skip morning_briefing (system workflow, no agent)', async () => {
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH });

      const result = await loop.run_morning(new Date('2026-03-20T07:00:00Z'));

      expect(result.skipped).toContainEqual(expect.stringContaining('모닝 브리핑'));
      expect(result.created).not.toContain('모닝 브리핑');
    });

    it('should skip night_summary (system workflow, no agent)', async () => {
      const loop = create_planning_loop({ store, router, schedules_path: SCHEDULES_PATH });

      const result = await loop.run_morning(new Date('2026-03-20T07:00:00Z'));

      expect(result.skipped).toContainEqual(expect.stringContaining('나이트 서머리'));
      expect(result.created).not.toContain('나이트 서머리');
    });
  });
});
