// Task executor — pre-execution gate for pending tasks
// Checks risk_level before transitioning tasks to in_progress:
// - LOW: auto-approve, move to in_progress immediately
// - MID: request cross-approval from Gemini CLI, block if rejected
// - HIGH/CRITICAL: skip (require human approval via Telegram)
//
// Runs on a configurable polling interval within the captain main loop.

import type { TaskStore } from '../gateway/task_store.js';
import type { CrossApproval } from '../gateway/cross_approval.js';
import type { NotificationRouter } from '../notification/router.js';
import type { Task, RiskLevel } from '../shared/types.js';
import type { ActivityHooks } from '../watchdog/activity_integration.js';

// === Constants ===

const DEFAULT_POLL_INTERVAL_MS = 30_000; // 30 seconds

// Risk levels that require AI cross-approval
const CROSS_APPROVAL_LEVELS: readonly RiskLevel[] = ['mid'] as const;

// Risk levels that skip automatic processing (human approval needed)
const HUMAN_ONLY_LEVELS: readonly RiskLevel[] = ['high', 'critical'] as const;

// === Types ===

export type TaskExecutorDeps = {
  store: TaskStore;
  router: NotificationRouter;
  approval?: CrossApproval;          // Optional: if absent, MID tasks are blocked
  poll_interval_ms?: number;         // Default: 30s
  activity_hooks?: ActivityHooks;    // Optional: for AI usage tracking
};

export type ProcessResult = {
  approved: string[];    // task IDs moved to in_progress
  rejected: string[];    // task IDs moved to blocked
  skipped: string[];     // task IDs left as pending (high/critical)
};

// === Build context string for cross-approval prompt ===

const build_approval_context = (task: Task): string => {
  const parts: string[] = [];
  parts.push(`Task ID: ${task.id}`);
  parts.push(`Assigned to: ${task.assigned_to}`);
  parts.push(`Risk level: ${task.risk_level}`);
  parts.push(`Mode: ${task.mode}`);
  if (task.description) {
    parts.push(`Description: ${task.description}`);
  }
  if (task.action) {
    parts.push(`Action: ${task.action}`);
  }
  return parts.join('\n');
};

// === Factory ===

export const create_task_executor = (deps: TaskExecutorDeps) => {
  let poll_timer: ReturnType<typeof setInterval> | null = null;
  const poll_interval = deps.poll_interval_ms ?? DEFAULT_POLL_INTERVAL_MS;

  // Process a single pending task based on its risk level
  const process_task = async (task: Task): Promise<'approved' | 'rejected' | 'skipped'> => {
    const level = task.risk_level;

    // HIGH / CRITICAL — skip, require human approval
    if ((HUMAN_ONLY_LEVELS as readonly string[]).includes(level)) {
      return 'skipped';
    }

    // LOW — auto-approve
    if (!(CROSS_APPROVAL_LEVELS as readonly string[]).includes(level)) {
      deps.store.update_status(task.id, 'in_progress');
      return 'approved';
    }

    // MID — request cross-approval from Gemini
    if (!deps.approval) {
      // No approval client available — block by default (secure)
      console.warn(`[TaskExecutor] No approval client — blocking MID task "${task.title}"`);
      deps.store.block_task(task.id, 'No cross-approval client available (Gemini CLI not configured)');
      await deps.router.route({
        type: 'blocked',
        message: `[BLOCKED] MID-risk task "${task.title}" — no cross-approval client available`,
        device: 'captain',
      }).catch(() => {}); // fire-and-forget notification
      return 'rejected';
    }

    try {
      const action = `[MID] ${task.title}`;
      const context = build_approval_context(task);
      const result = await deps.approval.request_approval(action, context);

      // Track Gemini AI call — both approved and rejected are successful API calls
      deps.activity_hooks?.log_ai_call('gemini', true);

      if (result.decision === 'approved') {
        deps.store.update_status(task.id, 'in_progress');
        // Notify approval_mid channel
        await deps.router.route({
          type: 'approval_mid',
          message: `[APPROVED] MID-risk task "${task.title}" approved by ${result.reviewed_by}: ${result.reason}`,
          device: 'captain',
        }).catch(() => {}); // fire-and-forget
        return 'approved';
      } else {
        // Rejected — block the task
        deps.store.block_task(task.id, `Cross-approval rejected by ${result.reviewed_by}: ${result.reason}`);
        await deps.router.route({
          type: 'blocked',
          message: `[BLOCKED] MID-risk task "${task.title}" rejected by ${result.reviewed_by}: ${result.reason}`,
          device: 'captain',
        }).catch(() => {}); // fire-and-forget
        return 'rejected';
      }
    } catch (err) {
      // Cross-approval threw unexpectedly — block as safe default
      const error_msg = err instanceof Error ? err.message : String(err);
      console.warn(`[TaskExecutor] Cross-approval error for "${task.title}": ${error_msg}`);

      // Track Gemini AI call failure
      deps.activity_hooks?.log_ai_call('gemini', false, error_msg);

      deps.store.block_task(task.id, `Cross-approval error: ${error_msg}`);
      await deps.router.route({
        type: 'blocked',
        message: `[BLOCKED] MID-risk task "${task.title}" — cross-approval error: ${error_msg}`,
        device: 'captain',
      }).catch(() => {}); // fire-and-forget
      return 'rejected';
    }
  };

  // Process all pending tasks in the store
  const process_pending = async (): Promise<ProcessResult> => {
    const pending = deps.store.get_by_status('pending');
    const result: ProcessResult = {
      approved: [],
      rejected: [],
      skipped: [],
    };

    for (const task of pending) {
      const outcome = await process_task(task);
      switch (outcome) {
        case 'approved':
          result.approved.push(task.id);
          break;
        case 'rejected':
          result.rejected.push(task.id);
          break;
        case 'skipped':
          result.skipped.push(task.id);
          break;
      }
    }

    return result;
  };

  // Start periodic polling
  const start = () => {
    if (poll_timer) return; // already running

    poll_timer = setInterval(async () => {
      try {
        const result = await process_pending();
        const total = result.approved.length + result.rejected.length;
        if (total > 0) {
          console.log(
            `[TaskExecutor] Processed: ${result.approved.length} approved, ${result.rejected.length} rejected, ${result.skipped.length} skipped`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[TaskExecutor] Polling error: ${msg}`);
      }
    }, poll_interval);

    // Don't keep the process alive just for this timer
    if (poll_timer.unref) poll_timer.unref();
  };

  // Stop polling
  const stop = () => {
    if (poll_timer) {
      clearInterval(poll_timer);
      poll_timer = null;
    }
  };

  return {
    process_pending,
    start,
    stop,
  };
};

export type TaskExecutor = ReturnType<typeof create_task_executor>;
