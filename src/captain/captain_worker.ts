// Captain worker — executes captain-assigned tasks that are in_progress
// Polls TaskStore for in_progress tasks where assigned_to === 'captain',
// dispatches to the appropriate handler based on the action field,
// and completes or blocks the task based on the handler result.
//
// Currently supported: lighthouse_audit
// Extensible via the handlers map for future captain-local actions.

import type { TaskStore } from '../gateway/task_store.js';
import type { NotificationRouter } from '../notification/router.js';
import type { Task } from '../shared/types.js';

// === Constants ===

const DEFAULT_POLL_INTERVAL_MS = 30_000; // 30 seconds

// === Types ===

// Handler function signature: receives a task, returns output data
export type CaptainActionHandler = (task: Task) => Promise<{
  summary: string;
  files_created: string[];
}>;

// Action dispatch map: action name → handler
export type CaptainActionHandlers = Record<string, CaptainActionHandler>;

export type CaptainWorkerDeps = {
  store: TaskStore;
  router: NotificationRouter;
  handlers: CaptainActionHandlers;
  poll_interval_ms?: number;
};

export type ProcessTasksResult = {
  completed: string[];   // task IDs marked as done
  failed: string[];      // task IDs marked as blocked
  skipped: string[];     // task IDs with no matching handler
};

// === Factory ===

export const create_captain_worker = (deps: CaptainWorkerDeps) => {
  let poll_timer: ReturnType<typeof setInterval> | null = null;
  const poll_interval = deps.poll_interval_ms ?? DEFAULT_POLL_INTERVAL_MS;

  // Process a single captain task by dispatching to the matching handler
  const process_task = async (task: Task): Promise<'completed' | 'failed' | 'skipped'> => {
    const action = task.action;

    // No action field or no matching handler — skip
    if (!action || !(action in deps.handlers)) {
      return 'skipped';
    }

    const handler = deps.handlers[action];

    try {
      const output = await handler(task);

      // Mark task as done with output
      deps.store.complete_task(task.id, {
        summary: output.summary,
        files_created: output.files_created,
      });

      // Send completion notification (fire-and-forget)
      await deps.router.route({
        type: 'done',
        message: `[DONE] Captain task "${task.title}" completed: ${output.summary}`,
        device: 'captain',
      }).catch(() => {}); // fire-and-forget

      return 'completed';
    } catch (err) {
      // Handler threw — block the task with error details
      const error_msg = err instanceof Error ? err.message : String(err);

      deps.store.block_task(task.id, `Captain worker error: ${error_msg}`);

      // Send blocked notification (fire-and-forget)
      await deps.router.route({
        type: 'blocked',
        message: `[BLOCKED] Captain task "${task.title}" failed: ${error_msg}`,
        device: 'captain',
      }).catch(() => {}); // fire-and-forget

      return 'failed';
    }
  };

  // Process all in_progress captain tasks
  const process_tasks = async (): Promise<ProcessTasksResult> => {
    // Get in_progress tasks assigned to captain
    const in_progress = deps.store.get_by_status('in_progress');
    const captain_tasks = in_progress.filter((t) => t.assigned_to === 'captain');

    const result: ProcessTasksResult = {
      completed: [],
      failed: [],
      skipped: [],
    };

    for (const task of captain_tasks) {
      const outcome = await process_task(task);
      switch (outcome) {
        case 'completed':
          result.completed.push(task.id);
          break;
        case 'failed':
          result.failed.push(task.id);
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
        const result = await process_tasks();
        const total = result.completed.length + result.failed.length;
        if (total > 0) {
          console.log(
            `[CaptainWorker] Processed: ${result.completed.length} completed, ${result.failed.length} failed, ${result.skipped.length} skipped`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[CaptainWorker] Polling error: ${msg}`);
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
    process_tasks,
    start,
    stop,
  };
};

export type CaptainWorker = ReturnType<typeof create_captain_worker>;
