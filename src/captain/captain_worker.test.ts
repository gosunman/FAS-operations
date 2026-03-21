// TDD tests for captain_worker — executes captain-assigned tasks (e.g., lighthouse_audit)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_captain_worker, type CaptainWorkerDeps, type CaptainActionHandler } from './captain_worker.js';
import { create_task_store, type TaskStore } from '../gateway/task_store.js';
import type { NotificationRouter } from '../notification/router.js';

// === Test helpers ===

const create_mock_router = (): NotificationRouter => ({
  route: vi.fn().mockResolvedValue({ telegram: true, slack: true, notion: false }),
  get_rules: vi.fn().mockReturnValue(null),
});

describe('CaptainWorker', () => {
  let store: TaskStore;
  let router: NotificationRouter;

  beforeEach(() => {
    store = create_task_store({ db_path: ':memory:' });
    router = create_mock_router();
  });

  afterEach(() => {
    store.close();
  });

  // === Core: picks up captain in_progress tasks and dispatches to handler ===

  describe('task dispatch', () => {
    it('should pick up in_progress captain tasks and dispatch to matching handler', async () => {
      // Given: an in_progress captain task with action=lighthouse_audit
      const task = store.create({
        title: 'Lighthouse SEO audit',
        assigned_to: 'captain',
        action: 'lighthouse_audit',
        risk_level: 'low',
      });
      store.update_status(task.id, 'in_progress');

      const mock_handler: CaptainActionHandler = vi.fn().mockResolvedValue({
        summary: 'Audited 2 URLs. All passed.',
        files_created: ['state/lighthouse_history.json'],
      });

      const worker = create_captain_worker({
        store,
        router,
        handlers: { lighthouse_audit: mock_handler },
      });

      // When
      const result = await worker.process_tasks();

      // Then
      expect(result.completed).toContain(task.id);
      expect(result.failed).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(mock_handler).toHaveBeenCalledWith(
        expect.objectContaining({ id: task.id, action: 'lighthouse_audit', status: 'in_progress' }),
      );

      const updated = store.get_by_id(task.id);
      expect(updated?.status).toBe('done');
      expect(updated?.output?.summary).toBe('Audited 2 URLs. All passed.');
      expect(updated?.output?.files_created).toEqual(['state/lighthouse_history.json']);
    });

    it('should skip tasks that are not assigned to captain', async () => {
      // Given: an in_progress task assigned to hunter
      const task = store.create({
        title: 'Hunter crawl task',
        assigned_to: 'hunter',
        action: 'web_crawl',
        risk_level: 'low',
      });
      store.update_status(task.id, 'in_progress');

      const worker = create_captain_worker({
        store,
        router,
        handlers: {},
      });

      // When
      const result = await worker.process_tasks();

      // Then: not touched by captain worker
      expect(result.completed).toEqual([]);
      expect(result.failed).toEqual([]);
      expect(result.skipped).toEqual([]);
    });

    it('should skip tasks with no matching handler', async () => {
      // Given: an in_progress captain task with an unknown action
      const task = store.create({
        title: 'Unknown action task',
        assigned_to: 'captain',
        action: 'unknown_action',
        risk_level: 'low',
      });
      store.update_status(task.id, 'in_progress');

      const worker = create_captain_worker({
        store,
        router,
        handlers: { lighthouse_audit: vi.fn() },
      });

      // When
      const result = await worker.process_tasks();

      // Then
      expect(result.skipped).toContain(task.id);
      expect(result.completed).toEqual([]);
      expect(result.failed).toEqual([]);
    });

    it('should skip tasks with no action field', async () => {
      // Given: an in_progress captain task without action
      const task = store.create({
        title: 'No action task',
        assigned_to: 'captain',
        risk_level: 'low',
      });
      store.update_status(task.id, 'in_progress');

      const worker = create_captain_worker({
        store,
        router,
        handlers: { lighthouse_audit: vi.fn() },
      });

      // When
      const result = await worker.process_tasks();

      // Then
      expect(result.skipped).toContain(task.id);
    });
  });

  // === Error handling: handler failure blocks the task ===

  describe('error handling', () => {
    it('should block task when handler throws an error', async () => {
      // Given: an in_progress captain task whose handler will fail
      const task = store.create({
        title: 'Failing audit',
        assigned_to: 'captain',
        action: 'lighthouse_audit',
        risk_level: 'low',
      });
      store.update_status(task.id, 'in_progress');

      const failing_handler: CaptainActionHandler = vi.fn().mockRejectedValue(
        new Error('Chrome crashed during audit'),
      );

      const worker = create_captain_worker({
        store,
        router,
        handlers: { lighthouse_audit: failing_handler },
      });

      // When
      const result = await worker.process_tasks();

      // Then: task should be blocked with error message
      expect(result.failed).toContain(task.id);
      expect(result.completed).toEqual([]);

      const updated = store.get_by_id(task.id);
      expect(updated?.status).toBe('blocked');
      expect(updated?.output?.summary).toContain('Chrome crashed during audit');
    });

    it('should send notification on handler failure', async () => {
      // Given
      const task = store.create({
        title: 'Failing audit',
        assigned_to: 'captain',
        action: 'lighthouse_audit',
        risk_level: 'low',
      });
      store.update_status(task.id, 'in_progress');

      const worker = create_captain_worker({
        store,
        router,
        handlers: {
          lighthouse_audit: vi.fn().mockRejectedValue(new Error('Timeout')),
        },
      });

      // When
      await worker.process_tasks();

      // Then: blocked notification sent
      expect(router.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'blocked',
          message: expect.stringContaining('Failing audit'),
          device: 'captain',
        }),
      );
    });

    it('should send notification on task completion', async () => {
      // Given
      const task = store.create({
        title: 'Lighthouse SEO audit',
        assigned_to: 'captain',
        action: 'lighthouse_audit',
        risk_level: 'low',
      });
      store.update_status(task.id, 'in_progress');

      const worker = create_captain_worker({
        store,
        router,
        handlers: {
          lighthouse_audit: vi.fn().mockResolvedValue({
            summary: 'All passed',
            files_created: [],
          }),
        },
      });

      // When
      await worker.process_tasks();

      // Then: done notification sent
      expect(router.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'done',
          message: expect.stringContaining('Lighthouse SEO audit'),
          device: 'captain',
        }),
      );
    });

    it('should continue processing remaining tasks when one handler fails', async () => {
      // Given: two captain tasks, first fails, second succeeds
      const task1 = store.create({
        title: 'Failing task',
        assigned_to: 'captain',
        action: 'lighthouse_audit',
        risk_level: 'low',
      });
      store.update_status(task1.id, 'in_progress');

      const task2 = store.create({
        title: 'Succeeding task',
        assigned_to: 'captain',
        action: 'lighthouse_audit',
        risk_level: 'low',
      });
      store.update_status(task2.id, 'in_progress');

      const handler = vi.fn()
        .mockRejectedValueOnce(new Error('First failed'))
        .mockResolvedValueOnce({ summary: 'OK', files_created: [] });

      const worker = create_captain_worker({
        store,
        router,
        handlers: { lighthouse_audit: handler },
      });

      // When
      const result = await worker.process_tasks();

      // Then: first failed, second completed
      expect(result.failed).toContain(task1.id);
      expect(result.completed).toContain(task2.id);
    });
  });

  // === Polling lifecycle ===

  describe('polling', () => {
    it('should start and stop polling without errors', async () => {
      const worker = create_captain_worker({
        store,
        router,
        handlers: {},
        poll_interval_ms: 100,
      });

      worker.start();

      // Let it run briefly
      await new Promise((r) => setTimeout(r, 50));

      worker.stop();
      // Should not throw
    });

    it('should not start polling twice', () => {
      const worker = create_captain_worker({
        store,
        router,
        handlers: {},
        poll_interval_ms: 100,
      });

      worker.start();
      worker.start(); // second call should be no-op

      worker.stop();
    });
  });

  // === Multiple handlers ===

  describe('extensible handler map', () => {
    it('should dispatch to correct handler based on action field', async () => {
      // Given: two different captain actions
      const audit_task = store.create({
        title: 'Lighthouse audit',
        assigned_to: 'captain',
        action: 'lighthouse_audit',
        risk_level: 'low',
      });
      store.update_status(audit_task.id, 'in_progress');

      const custom_task = store.create({
        title: 'Custom action',
        assigned_to: 'captain',
        action: 'custom_report',
        risk_level: 'low',
      });
      store.update_status(custom_task.id, 'in_progress');

      const audit_handler = vi.fn().mockResolvedValue({ summary: 'Audit done', files_created: [] });
      const custom_handler = vi.fn().mockResolvedValue({ summary: 'Report done', files_created: [] });

      const worker = create_captain_worker({
        store,
        router,
        handlers: {
          lighthouse_audit: audit_handler,
          custom_report: custom_handler,
        },
      });

      // When
      const result = await worker.process_tasks();

      // Then: each handler called with its respective task
      expect(result.completed).toContain(audit_task.id);
      expect(result.completed).toContain(custom_task.id);
      expect(audit_handler).toHaveBeenCalledWith(expect.objectContaining({ id: audit_task.id }));
      expect(custom_handler).toHaveBeenCalledWith(expect.objectContaining({ id: custom_task.id }));
    });
  });
});
