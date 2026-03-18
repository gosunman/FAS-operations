// TDD tests for planning loop (morning/night scheduling)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_planning_loop } from './planning_loop.js';
import { create_task_store, type TaskStore } from '../gateway/task_store.js';
import type { NotificationRouter } from '../notification/router.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
  });
});
