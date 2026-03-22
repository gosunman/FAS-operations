// TDD tests for task_executor — pre-execution cross-approval gate for MID-risk tasks
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_task_executor, type TaskExecutorDeps } from './task_executor.js';
import { create_task_store, type TaskStore } from '../gateway/task_store.js';
import type { NotificationRouter } from '../notification/router.js';
import type { CrossApproval } from '../gateway/cross_approval.js';
import type { CrossApprovalResult } from '../shared/types.js';
import type { ActivityHooks } from '../watchdog/activity_integration.js';

// === Test helpers ===

const create_mock_router = (): NotificationRouter => ({
  route: vi.fn().mockResolvedValue({ telegram: true, slack: true, notion: false }),
  get_rules: vi.fn().mockReturnValue(null),
});

const create_mock_approval = (result: CrossApprovalResult): CrossApproval => ({
  request_approval: vi.fn().mockResolvedValue(result),
});

const approved_result: CrossApprovalResult = {
  decision: 'approved',
  reason: 'Safe operation',
  reviewed_by: 'gemini_a',
  reviewed_at: '2026-03-19T10:00:00.000Z',
};

const rejected_result: CrossApprovalResult = {
  decision: 'rejected',
  reason: 'Potentially dangerous',
  reviewed_by: 'gemini_a',
  reviewed_at: '2026-03-19T10:00:00.000Z',
};

describe('TaskExecutor', () => {
  let store: TaskStore;
  let router: NotificationRouter;

  beforeEach(() => {
    store = create_task_store({ db_path: ':memory:' });
    router = create_mock_router();
  });

  afterEach(() => {
    store.close();
  });

  // === LOW risk tasks: pass through without approval ===

  describe('LOW risk tasks', () => {
    it('should transition low-risk pending tasks to in_progress without approval', async () => {
      // Given: a pending LOW-risk task
      const task = store.create({
        title: 'Web search',
        assigned_to: 'gemini_a',
        risk_level: 'low',
      });

      const approval = create_mock_approval(approved_result);
      const executor = create_task_executor({ store, router, approval });

      // When
      const result = await executor.process_pending();

      // Then: task should be in_progress, no approval requested
      expect(result.approved).toContain(task.id);
      expect(result.rejected).toEqual([]);
      expect(approval.request_approval).not.toHaveBeenCalled();

      const updated = store.get_by_id(task.id);
      expect(updated?.status).toBe('in_progress');
    });
  });

  // === MID risk tasks: require cross-approval ===

  describe('MID risk tasks', () => {
    it('should approve and transition MID-risk task when Gemini approves', async () => {
      // Given: a pending MID-risk task
      const task = store.create({
        title: 'Config change',
        description: 'Update scheduler settings',
        assigned_to: 'claude',
        risk_level: 'mid',
      });

      const approval = create_mock_approval(approved_result);
      const executor = create_task_executor({ store, router, approval });

      // When
      const result = await executor.process_pending();

      // Then
      expect(result.approved).toContain(task.id);
      expect(approval.request_approval).toHaveBeenCalledWith(
        expect.stringContaining('Config change'),
        expect.stringContaining('Update scheduler settings'),
      );

      const updated = store.get_by_id(task.id);
      expect(updated?.status).toBe('in_progress');
    });

    it('should block MID-risk task when Gemini rejects', async () => {
      // Given: a pending MID-risk task
      const task = store.create({
        title: 'Dangerous config change',
        description: 'Modify production settings',
        assigned_to: 'claude',
        risk_level: 'mid',
      });

      const approval = create_mock_approval(rejected_result);
      const executor = create_task_executor({ store, router, approval });

      // When
      const result = await executor.process_pending();

      // Then
      expect(result.rejected).toContain(task.id);
      expect(result.approved).toEqual([]);

      const updated = store.get_by_id(task.id);
      expect(updated?.status).toBe('blocked');
    });

    it('should send Telegram alert when MID-risk task is rejected', async () => {
      // Given
      const task = store.create({
        title: 'Rejected task',
        assigned_to: 'claude',
        risk_level: 'mid',
      });

      const approval = create_mock_approval(rejected_result);
      const executor = create_task_executor({ store, router, approval });

      // When
      await executor.process_pending();

      // Then: blocked event should be routed (Telegram + Slack per routing matrix)
      expect(router.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'blocked',
          message: expect.stringContaining('Rejected task'),
          device: 'captain',
        }),
      );
    });

    it('should send approval_mid notification when MID-risk task is approved', async () => {
      // Given
      store.create({
        title: 'Approved MID task',
        assigned_to: 'claude',
        risk_level: 'mid',
      });

      const approval = create_mock_approval(approved_result);
      const executor = create_task_executor({ store, router, approval });

      // When
      await executor.process_pending();

      // Then
      expect(router.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'approval_mid',
          message: expect.stringContaining('Approved MID task'),
          device: 'captain',
        }),
      );
    });
  });

  // === HIGH / CRITICAL risk tasks: skip (require human approval) ===

  describe('HIGH/CRITICAL risk tasks', () => {
    it('should skip HIGH-risk tasks (human approval required)', async () => {
      // Given
      const task = store.create({
        title: 'Git push',
        assigned_to: 'claude',
        risk_level: 'high',
      });

      const approval = create_mock_approval(approved_result);
      const executor = create_task_executor({ store, router, approval });

      // When
      const result = await executor.process_pending();

      // Then: task remains pending, not processed
      expect(result.approved).toEqual([]);
      expect(result.rejected).toEqual([]);
      expect(result.skipped).toContain(task.id);
      expect(approval.request_approval).not.toHaveBeenCalled();

      const updated = store.get_by_id(task.id);
      expect(updated?.status).toBe('pending');
    });

    it('should skip CRITICAL-risk tasks', async () => {
      // Given
      const task = store.create({
        title: 'Deploy to production',
        assigned_to: 'claude',
        risk_level: 'critical',
      });

      const approval = create_mock_approval(approved_result);
      const executor = create_task_executor({ store, router, approval });

      // When
      const result = await executor.process_pending();

      // Then
      expect(result.skipped).toContain(task.id);

      const updated = store.get_by_id(task.id);
      expect(updated?.status).toBe('pending');
    });
  });

  // === Error handling: graceful fallback to block ===

  describe('error handling', () => {
    it('should block task when cross-approval throws an error', async () => {
      // Given
      const task = store.create({
        title: 'Error task',
        assigned_to: 'claude',
        risk_level: 'mid',
      });

      const approval: CrossApproval = {
        request_approval: vi.fn().mockRejectedValue(new Error('Gemini CLI crashed')),
      };
      const executor = create_task_executor({ store, router, approval });

      const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // When
      const result = await executor.process_pending();

      // Then: task should be blocked (safe default)
      expect(result.rejected).toContain(task.id);
      const updated = store.get_by_id(task.id);
      expect(updated?.status).toBe('blocked');

      // Should send blocked notification
      expect(router.route).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'blocked' }),
      );

      warn_spy.mockRestore();
    });

    it('should continue processing other tasks when one fails', async () => {
      // Given: two MID tasks, first will error, second will approve
      store.create({
        title: 'Error task',
        assigned_to: 'claude',
        risk_level: 'mid',
      });
      const task2 = store.create({
        title: 'Good task',
        assigned_to: 'claude',
        risk_level: 'mid',
      });

      const approval: CrossApproval = {
        request_approval: vi.fn()
          .mockRejectedValueOnce(new Error('Crash'))
          .mockResolvedValueOnce(approved_result),
      };
      const executor = create_task_executor({ store, router, approval });
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      // When
      const result = await executor.process_pending();

      // Then: first blocked, second approved
      expect(result.rejected.length).toBe(1);
      expect(result.approved).toContain(task2.id);

      vi.restoreAllMocks();
    });
  });

  // === No approval client: graceful handling ===

  describe('no approval client', () => {
    it('should block MID-risk tasks when no approval client is provided', async () => {
      // Given: no approval client
      const task = store.create({
        title: 'No approver task',
        assigned_to: 'claude',
        risk_level: 'mid',
      });

      const executor = create_task_executor({ store, router });

      const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // When
      const result = await executor.process_pending();

      // Then: MID tasks blocked (can't approve without Gemini)
      expect(result.rejected).toContain(task.id);
      const updated = store.get_by_id(task.id);
      expect(updated?.status).toBe('blocked');

      warn_spy.mockRestore();
    });

    it('should still pass LOW-risk tasks through without approval client', async () => {
      // Given
      const task = store.create({
        title: 'Safe read task',
        assigned_to: 'gemini_a',
        risk_level: 'low',
      });

      const executor = create_task_executor({ store, router });

      // When
      const result = await executor.process_pending();

      // Then
      expect(result.approved).toContain(task.id);
      const updated = store.get_by_id(task.id);
      expect(updated?.status).toBe('in_progress');
    });
  });

  // === Mixed batch processing ===

  describe('batch processing', () => {
    it('should process a mixed batch of tasks correctly', async () => {
      // Given: tasks of various risk levels
      const low_task = store.create({ title: 'Read file', assigned_to: 'claude', risk_level: 'low' });
      const mid_task = store.create({ title: 'Write config', assigned_to: 'claude', risk_level: 'mid' });
      const high_task = store.create({ title: 'Push code', assigned_to: 'claude', risk_level: 'high' });

      const approval = create_mock_approval(approved_result);
      const executor = create_task_executor({ store, router, approval });

      // When
      const result = await executor.process_pending();

      // Then
      expect(result.approved).toContain(low_task.id);
      expect(result.approved).toContain(mid_task.id);
      expect(result.skipped).toContain(high_task.id);
    });
  });

  // === AI call tracking via activity_hooks ===

  describe('AI call tracking', () => {
    it('should log gemini AI call on successful cross-approval', async () => {
      // Given: a MID-risk task with activity_hooks
      const task = store.create({
        title: 'Config change tracked',
        assigned_to: 'claude',
        risk_level: 'mid',
      });

      const approval = create_mock_approval(approved_result);
      const mock_hooks: ActivityHooks = {
        log_task_created: vi.fn(),
        log_task_completed: vi.fn(),
        log_task_failed: vi.fn(),
        log_hunter_heartbeat: vi.fn(),
        log_notification_sent: vi.fn(),
        log_telegram_command: vi.fn(),
        log_error: vi.fn(),
        log_ai_call: vi.fn(),
      };
      const executor = create_task_executor({ store, router, approval, activity_hooks: mock_hooks });

      // When
      await executor.process_pending();

      // Then: gemini AI call should be logged as success
      expect(mock_hooks.log_ai_call).toHaveBeenCalledWith('gemini', true);
    });

    it('should log gemini AI call on rejection (API call itself succeeded)', async () => {
      // Given: a MID-risk task that gets rejected
      const task = store.create({
        title: 'Rejected tracked',
        assigned_to: 'claude',
        risk_level: 'mid',
      });

      const approval = create_mock_approval(rejected_result);
      const mock_hooks: ActivityHooks = {
        log_task_created: vi.fn(),
        log_task_completed: vi.fn(),
        log_task_failed: vi.fn(),
        log_hunter_heartbeat: vi.fn(),
        log_notification_sent: vi.fn(),
        log_telegram_command: vi.fn(),
        log_error: vi.fn(),
        log_ai_call: vi.fn(),
      };
      const executor = create_task_executor({ store, router, approval, activity_hooks: mock_hooks });

      // When
      await executor.process_pending();

      // Then: gemini AI call logged as success (rejection is a valid API response)
      expect(mock_hooks.log_ai_call).toHaveBeenCalledWith('gemini', true);
    });

    it('should log gemini AI call as failure when cross-approval throws', async () => {
      // Given: cross-approval that throws
      const task = store.create({
        title: 'Error tracked',
        assigned_to: 'claude',
        risk_level: 'mid',
      });

      const approval: CrossApproval = {
        request_approval: vi.fn().mockRejectedValue(new Error('Gemini CLI crashed')),
      };
      const mock_hooks: ActivityHooks = {
        log_task_created: vi.fn(),
        log_task_completed: vi.fn(),
        log_task_failed: vi.fn(),
        log_hunter_heartbeat: vi.fn(),
        log_notification_sent: vi.fn(),
        log_telegram_command: vi.fn(),
        log_error: vi.fn(),
        log_ai_call: vi.fn(),
      };
      const executor = create_task_executor({ store, router, approval, activity_hooks: mock_hooks });

      vi.spyOn(console, 'warn').mockImplementation(() => {});

      // When
      await executor.process_pending();

      // Then: gemini AI call logged as failure with error message
      expect(mock_hooks.log_ai_call).toHaveBeenCalledWith('gemini', false, 'Gemini CLI crashed');

      vi.restoreAllMocks();
    });

    it('should not crash when activity_hooks is not provided', async () => {
      // Given: no activity_hooks (backward compatibility)
      store.create({
        title: 'No hooks task',
        assigned_to: 'claude',
        risk_level: 'mid',
      });

      const approval = create_mock_approval(approved_result);
      const executor = create_task_executor({ store, router, approval });

      // When/Then: should not throw
      const result = await executor.process_pending();
      expect(result.approved).toHaveLength(1);
    });
  });

  // === Polling lifecycle ===

  describe('polling', () => {
    it('should start and stop polling without errors', async () => {
      const approval = create_mock_approval(approved_result);
      const executor = create_task_executor({
        store,
        router,
        approval,
        poll_interval_ms: 100,
      });

      executor.start();

      // Let it run briefly
      await new Promise((r) => setTimeout(r, 50));

      executor.stop();
      // Should not throw
    });
  });
});
