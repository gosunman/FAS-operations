// Morning briefing tests — vitest, Given-When-Then pattern
// Tests: data collection, formatting, notification routing, fire-and-forget error handling

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { create_task_store, type TaskStore } from '../gateway/task_store.js';
import type { NotificationRouter } from '../notification/router.js';
import type { NotionClient } from '../notification/notion.js';
import type { Task } from '../shared/types.js';
import {
  collect_briefing_data,
  format_short_briefing,
  format_detailed_briefing,
  create_morning_briefing,
  check_google_messages_health,
  type BriefingData,
} from './morning_briefing.js';

// === Test helpers ===

const create_test_schedules = (dir: string): string => {
  const schedules_path = join(dir, 'schedules.yml');
  const content = `schedules:
  ai_trends:
    title: "AI 트렌드 리서치"
    type: daily
    time: "01:00"
    mode: sleep
    agent: gemini_a
    risk_level: low
    requires_personal_info: false
    action: research
    description: "Daily AI trends"
  morning_briefing:
    title: "모닝 브리핑"
    type: daily
    time: "07:30"
    mode: awake
    workflow: WF-4
  weekly_task:
    title: "주간 리서치"
    type: weekly
    day: wednesday
    time: "02:00"
    agent: hunter
    action: chatgpt_task
    description: "Weekly research"
`;
  writeFileSync(schedules_path, content, 'utf-8');
  return schedules_path;
};

const create_mock_router = (): NotificationRouter => ({
  route: vi.fn().mockResolvedValue({ telegram: true, slack: true, notion: false }),
  get_rules: vi.fn().mockReturnValue({ telegram: true, slack: true, notion: true }),
});

const create_mock_notion = (): NotionClient => ({
  send_notification: vi.fn().mockResolvedValue({ page_id: 'test-page', url: 'https://notion.so/test' }),
  send_with_result: vi.fn().mockResolvedValue({ channel: 'notion', success: true, attempts: 1 }),
  create_page: vi.fn().mockResolvedValue({ page_id: 'test-page', url: 'https://notion.so/test' }),
  create_daily_briefing: vi.fn().mockResolvedValue({ page_id: 'briefing-page', url: 'https://notion.so/briefing' }),
  _client: {} as never,
});

// === Tests ===

describe('morning_briefing', () => {
  let store: TaskStore;
  let schedules_path: string;
  let test_dir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    test_dir = join(tmpdir(), `fas-briefing-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(test_dir, { recursive: true });

    store = create_task_store({ db_path: ':memory:' });
    schedules_path = create_test_schedules(test_dir);
  });

  describe('collect_briefing_data', () => {
    it('should return empty overnight when no tasks completed overnight', () => {
      // Given: no tasks in store
      const now = new Date('2026-03-19T07:30:00Z');

      // When: collecting briefing data
      const data = collect_briefing_data(store, schedules_path, now);

      // Then: overnight should be empty
      expect(data.overnight.total_count).toBe(0);
      expect(data.overnight.completed_tasks).toEqual([]);
    });

    it('should capture tasks completed within overnight window (22:00~07:00)', () => {
      // Given: a task completed at 03:00 today
      const now = new Date('2026-03-19T07:30:00Z');

      const task = store.create({
        title: 'AI Trends Research',
        assigned_to: 'gemini_a',
        mode: 'sleep',
      });
      // Manually complete the task at 03:00 overnight
      store.complete_task(task.id, { summary: 'Found 5 interesting papers' });

      // Hack: update completed_at to simulate overnight completion
      store._db.prepare('UPDATE tasks SET completed_at = ? WHERE id = ?')
        .run('2026-03-19T03:00:00Z', task.id);

      // When: collecting briefing data
      const data = collect_briefing_data(store, schedules_path, now);

      // Then: should include the overnight task
      expect(data.overnight.total_count).toBe(1);
      expect(data.overnight.completed_tasks[0].title).toBe('AI Trends Research');
    });

    it('should NOT include tasks completed outside overnight window', () => {
      // Given: a task completed at 15:00 yesterday (outside window)
      const now = new Date('2026-03-19T07:30:00Z');

      const task = store.create({
        title: 'Afternoon Task',
        assigned_to: 'claude',
        mode: 'awake',
      });
      store.complete_task(task.id, { summary: 'Done' });
      store._db.prepare('UPDATE tasks SET completed_at = ? WHERE id = ?')
        .run('2026-03-18T15:00:00Z', task.id);

      // When: collecting briefing data
      const data = collect_briefing_data(store, schedules_path, now);

      // Then: should not include the afternoon task
      expect(data.overnight.total_count).toBe(0);
    });

    it('should include tasks completed at 22:30 previous day (within window)', () => {
      // Given: a task completed at 22:30 previous day
      const now = new Date('2026-03-19T07:30:00Z');

      const task = store.create({
        title: 'Late Night Task',
        assigned_to: 'hunter',
        mode: 'sleep',
      });
      store.complete_task(task.id, { summary: 'Crawled 100 pages' });
      store._db.prepare('UPDATE tasks SET completed_at = ? WHERE id = ?')
        .run('2026-03-18T22:30:00Z', task.id);

      // When: collecting briefing data
      const data = collect_briefing_data(store, schedules_path, now);

      // Then: should include the late night task
      expect(data.overnight.total_count).toBe(1);
    });

    it('should list today\'s scheduled tasks from schedules.yml', () => {
      // Given: schedules.yml with daily + weekly tasks, today is Wednesday
      // 2026-03-18 is a Wednesday
      const wednesday = new Date('2026-03-18T07:30:00Z');

      // When: collecting briefing data
      const data = collect_briefing_data(store, schedules_path, wednesday);

      // Then: should include daily tasks and Wednesday weekly task
      const titles = data.today_schedules.map((s) => s.title);
      expect(titles).toContain('AI 트렌드 리서치');
      expect(titles).toContain('모닝 브리핑');
      expect(titles).toContain('주간 리서치');
    });

    it('should exclude weekly tasks on non-matching days', () => {
      // Given: today is Thursday (weekly task is for Wednesday)
      // 2026-03-19 is a Thursday
      const thursday = new Date('2026-03-19T07:30:00Z');

      // When: collecting briefing data
      const data = collect_briefing_data(store, schedules_path, thursday);

      // Then: weekly task should be excluded
      const titles = data.today_schedules.map((s) => s.title);
      expect(titles).not.toContain('주간 리서치');
    });

    it('should report blocked, pending, and in_progress tasks', () => {
      // Given: various task statuses
      store.create({ title: 'Blocked Task', assigned_to: 'hunter' });
      const blocked = store.create({ title: 'Really Blocked', assigned_to: 'hunter' });
      store.block_task(blocked.id, 'API rate limited');

      const pending = store.create({ title: 'Waiting Task', assigned_to: 'gemini_a' });
      const in_prog = store.create({ title: 'Running Task', assigned_to: 'claude' });
      store.update_status(in_prog.id, 'in_progress');

      const now = new Date('2026-03-19T07:30:00Z');

      // When: collecting briefing data
      const data = collect_briefing_data(store, schedules_path, now);

      // Then: status counts should match
      expect(data.blocked.blocked_tasks.length).toBe(1);
      expect(data.blocked.pending_tasks.length).toBe(2); // 'Blocked Task' is still pending, 'Waiting Task' is pending
      expect(data.blocked.in_progress_tasks.length).toBe(1);
    });
  });

  describe('format_short_briefing', () => {
    it('should format a concise briefing message', () => {
      // Given: briefing data with overnight tasks and schedules
      const data: BriefingData = {
        date: '2026-03-19',
        overnight: {
          completed_tasks: [
            { id: '1', title: 'AI Crawl', assigned_to: 'hunter', output: { summary: 'Found 3 items', files_created: [] } } as Task,
          ],
          total_count: 1,
        },
        today_schedules: [
          { title: 'Morning Briefing', time: '07:30', agent: 'system', action: 'WF-4' },
        ],
        blocked: {
          blocked_tasks: [],
          pending_tasks: [{ id: '2', title: 'Pending Task' } as Task],
          in_progress_tasks: [],
        },
      };

      // When: formatting
      const result = format_short_briefing(data);

      // Then: should contain key sections
      expect(result).toContain('[Morning Briefing] 2026-03-19');
      expect(result).toContain('1 task(s) completed');
      expect(result).toContain('AI Crawl');
      expect(result).toContain('Found 3 items');
      expect(result).toContain("Today's Schedule (1 tasks)");
      expect(result).toContain('[07:30] Morning Briefing');
      expect(result).toContain('Blocked: 0');
      expect(result).toContain('Pending: 1');
    });

    it('should show "No tasks completed" when overnight is empty', () => {
      // Given: empty overnight data
      const data: BriefingData = {
        date: '2026-03-19',
        overnight: { completed_tasks: [], total_count: 0 },
        today_schedules: [],
        blocked: { blocked_tasks: [], pending_tasks: [], in_progress_tasks: [] },
      };

      // When: formatting
      const result = format_short_briefing(data);

      // Then: should indicate no overnight tasks
      expect(result).toContain('No tasks completed overnight');
    });

    it('should list blocked tasks with truncated reasons', () => {
      // Given: blocked tasks
      const data: BriefingData = {
        date: '2026-03-19',
        overnight: { completed_tasks: [], total_count: 0 },
        today_schedules: [],
        blocked: {
          blocked_tasks: [
            { id: '1', title: 'API Task', output: { summary: 'Rate limited by external API, retry scheduled for 03:00', files_created: [] } } as Task,
          ],
          pending_tasks: [],
          in_progress_tasks: [],
        },
      };

      // When: formatting
      const result = format_short_briefing(data);

      // Then: should show blocked task info
      expect(result).toContain('Blocked: 1');
      expect(result).toContain('API Task');
      expect(result).toContain('Rate limited');
    });
  });

  describe('format_detailed_briefing', () => {
    it('should produce sections for Notion backup', () => {
      // Given: full briefing data
      const data: BriefingData = {
        date: '2026-03-19',
        overnight: {
          completed_tasks: [
            {
              id: '1',
              title: 'Crawl Task',
              assigned_to: 'hunter',
              completed_at: '2026-03-19T02:00:00Z',
              output: { summary: 'Crawled 50 pages', files_created: ['results.json'] },
            } as Task,
          ],
          total_count: 1,
        },
        today_schedules: [
          { title: 'AI Research', time: '01:00', agent: 'gemini_a', action: 'research' },
        ],
        blocked: {
          blocked_tasks: [{ id: '2', title: 'Stuck Task', output: { summary: 'Timeout', files_created: [] } } as Task],
          pending_tasks: [],
          in_progress_tasks: [{ id: '3', title: 'Working', assigned_to: 'claude' } as Task],
        },
      };

      // When: formatting for Notion
      const result = format_detailed_briefing(data);

      // Then: should have proper structure
      expect(result.title).toBe('Morning Briefing — 2026-03-19');
      expect(result.sections).toHaveLength(3);
      expect(result.sections[0].title).toBe('Overnight Completed Tasks');
      expect(result.sections[0].content).toContain('Crawl Task');
      expect(result.sections[0].content).toContain('results.json');
      expect(result.sections[1].title).toBe("Today's Scheduled Tasks");
      expect(result.sections[1].content).toContain('AI Research');
      expect(result.sections[2].title).toBe('Task Status Overview');
      expect(result.sections[2].content).toContain('Blocked: 1');
      expect(result.sections[2].content).toContain('In Progress: 1');
    });
  });

  describe('check_google_messages_health', () => {
    it('should return unknown status as stub implementation', () => {
      // Given: no external dependencies (stub)

      // When: checking Google Messages health
      const result = check_google_messages_health();

      // Then: should return unknown status with message
      expect(result.status).toBe('unknown');
      expect(result.message).toBe('Health check not yet implemented');
      expect(result.checked_at).toBeTruthy();
    });

    it('should return a valid ISO timestamp in checked_at', () => {
      // Given: calling health check

      // When: checking result
      const result = check_google_messages_health();

      // Then: checked_at should be a valid ISO date string
      const parsed = new Date(result.checked_at);
      expect(parsed.getTime()).not.toBeNaN();
    });
  });

  describe('create_morning_briefing', () => {
    it('should send briefing via router and Notion', async () => {
      // Given: briefing module with mock dependencies
      const router = create_mock_router();
      const notion = create_mock_notion();
      const now = new Date('2026-03-19T07:30:00Z');

      const briefing = create_morning_briefing({
        store,
        router,
        notion,
        schedules_path,
      });

      // When: running the briefing
      const result = await briefing.run(now);

      // Then: should succeed and call both channels
      expect(result.success).toBe(true);
      expect(result.channels.telegram_slack).toBe(true);
      expect(result.channels.notion).toBe(true);
      expect(router.route).toHaveBeenCalledOnce();
      expect(notion.create_daily_briefing).toHaveBeenCalledOnce();

      // Verify the router was called with a briefing event
      const route_call = (router.route as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(route_call.type).toBe('briefing');
      expect(route_call.device).toBe('captain');
      expect(route_call.message).toContain('[Morning Briefing]');
    });

    it('should succeed even when Notion is null', async () => {
      // Given: no Notion client
      const router = create_mock_router();
      const now = new Date('2026-03-19T07:30:00Z');

      const briefing = create_morning_briefing({
        store,
        router,
        notion: null,
        schedules_path,
      });

      // When: running the briefing
      const result = await briefing.run(now);

      // Then: should succeed with router only
      expect(result.success).toBe(true);
      expect(result.channels.telegram_slack).toBe(true);
      expect(result.channels.notion).toBe(false);
    });

    it('should not crash when router fails (fire-and-forget)', async () => {
      // Given: router that throws
      const router = create_mock_router();
      (router.route as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network down'));
      const notion = create_mock_notion();
      const now = new Date('2026-03-19T07:30:00Z');

      const briefing = create_morning_briefing({
        store,
        router,
        notion,
        schedules_path,
      });

      // When: running the briefing
      const result = await briefing.run(now);

      // Then: should not throw, Notion still succeeds
      expect(result.channels.telegram_slack).toBe(false);
      expect(result.channels.notion).toBe(true);
      expect(result.success).toBe(true); // Notion fallback
    });

    it('should not crash when Notion fails (fire-and-forget)', async () => {
      // Given: Notion that throws
      const router = create_mock_router();
      const notion = create_mock_notion();
      (notion.create_daily_briefing as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Notion API error'));
      const now = new Date('2026-03-19T07:30:00Z');

      const briefing = create_morning_briefing({
        store,
        router,
        notion,
        schedules_path,
      });

      // When: running the briefing
      const result = await briefing.run(now);

      // Then: should not throw, router still succeeds
      expect(result.channels.telegram_slack).toBe(true);
      expect(result.channels.notion).toBe(false);
      expect(result.success).toBe(true); // Router fallback
    });

    it('should report failure when all channels fail', async () => {
      // Given: both router and Notion fail
      const router = create_mock_router();
      (router.route as ReturnType<typeof vi.fn>).mockResolvedValue({ telegram: false, slack: false, notion: false });
      const notion = create_mock_notion();
      (notion.create_daily_briefing as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
      const now = new Date('2026-03-19T07:30:00Z');

      const briefing = create_morning_briefing({
        store,
        router,
        notion,
        schedules_path,
      });

      // When: running the briefing
      const result = await briefing.run(now);

      // Then: should indicate failure without crashing
      expect(result.success).toBe(false);
      expect(result.channels.telegram_slack).toBe(false);
      expect(result.channels.notion).toBe(false);
    });

    it('should include correct briefing data in the result', async () => {
      // Given: a store with an overnight completed task and a blocked task
      const now = new Date('2026-03-19T07:30:00Z');

      const task = store.create({ title: 'Overnight Crawl', assigned_to: 'hunter', mode: 'sleep' });
      store.complete_task(task.id, { summary: 'Crawled successfully' });
      store._db.prepare('UPDATE tasks SET completed_at = ? WHERE id = ?')
        .run('2026-03-19T01:00:00Z', task.id);

      const blocked = store.create({ title: 'Stuck Task', assigned_to: 'hunter' });
      store.block_task(blocked.id, 'API limit reached');

      const router = create_mock_router();
      const briefing = create_morning_briefing({ store, router, notion: null, schedules_path });

      // When: running the briefing
      const result = await briefing.run(now);

      // Then: data should reflect store state
      expect(result.data.overnight.total_count).toBe(1);
      expect(result.data.overnight.completed_tasks[0].title).toBe('Overnight Crawl');
      expect(result.data.blocked.blocked_tasks.length).toBe(1);
      expect(result.data.date).toBe('2026-03-19');
    });
  });
});
