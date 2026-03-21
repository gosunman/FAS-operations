// Main polling loop for Hunter agent
// Cycle: heartbeat → fetch pending → execute first task → submit result → wait
//
// Uses setTimeout recursion instead of setInterval to prevent
// overlapping cycles when task execution takes longer than poll interval.

import type { ApiClient } from './api_client.js';
import type { Logger } from './logger.js';
import type { HunterConfig } from './config.js';
import type { HunterNotify } from './notify.js';

type TaskExecutor = {
  execute: (task: import('../shared/types.js').Task) => Promise<import('../shared/types.js').HunterTaskResult>;
};

export type PollLoopDeps = {
  api: ApiClient;
  executor: TaskExecutor;
  logger: Logger;
  config: HunterConfig;
  notify?: HunterNotify;
};

export type PollLoopState = {
  running: boolean;
  consecutive_failures: number;
  total_tasks_processed: number;
  last_heartbeat_at: string | null;
  processing_task_ids: ReadonlySet<string>;
};

const MAX_BACKOFF_MS = 300_000; // 5 minutes

export const create_poll_loop = (deps: PollLoopDeps) => {
  const { api, executor, logger, config, notify } = deps;

  // Local deduplication set — prevents the same task from being processed twice
  // even if Captain returns it in multiple consecutive polls
  const processing_task_ids = new Set<string>();

  const state: PollLoopState = {
    running: false,
    consecutive_failures: 0,
    total_tasks_processed: 0,
    last_heartbeat_at: null,
    processing_task_ids,
  };

  let timer: ReturnType<typeof setTimeout> | null = null;

  // Exponential backoff: base_interval * 2^failures (capped at MAX_BACKOFF_MS)
  const get_current_interval = (): number => {
    if (state.consecutive_failures === 0) return config.poll_interval_ms;
    const backoff = config.poll_interval_ms * Math.pow(2, state.consecutive_failures);
    return Math.min(backoff, MAX_BACKOFF_MS);
  };

  // Single poll cycle
  const run_cycle = async (): Promise<void> => {
    try {
      // 1. Send heartbeat
      const hb = await api.send_heartbeat();
      if (hb) {
        state.last_heartbeat_at = hb.server_time;
      }

      // 2. Fetch pending tasks
      const tasks = await api.fetch_pending_tasks();

      if (tasks.length === 0) {
        // No work — reset failure counter on successful communication
        state.consecutive_failures = 0;
        return;
      }

      // 3. Execute first non-duplicate task (max_concurrent_tasks: 1)
      // Skip tasks already being processed (race condition prevention)
      const task = tasks.find((t) => !processing_task_ids.has(t.id));
      if (!task) {
        state.consecutive_failures = 0;
        return;
      }

      // Mark as processing IMMEDIATELY to prevent duplicate execution
      processing_task_ids.add(task.id);
      logger.info(`Processing task: ${task.id} — "${task.title}"`);

      try {
        const result = await executor.execute(task);

        // 4. Submit result
        const submitted = await api.submit_result(task.id, result);
        if (submitted) {
          state.total_tasks_processed += 1;
          logger.info(`Task ${task.id} completed: ${result.status}`);

          // Task completion notification is handled by Captain Gateway (crawl_result → Notion + Slack)
          // Hunter does NOT send separate completion reports to avoid notification flooding

          // Report login issues to Slack only (not Telegram — minimize watch alerts)
          if (result.status === 'failure' && result.output?.includes('[LOGIN_REQUIRED]')) {
            await notify?.report('[LOGIN_REQUIRED] Google session expired — manual re-login needed');
          }
        } else {
          logger.warn(`Task ${task.id} result submission failed — will retry`);
        }
      } finally {
        // Remove from processing set after completion (success or failure)
        processing_task_ids.delete(task.id);
      }

      // Success — reset failure counter
      state.consecutive_failures = 0;
    } catch (err) {
      state.consecutive_failures += 1;
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.error(`Poll cycle error (failures: ${state.consecutive_failures}): ${error_msg}`);

      // Report to Slack only when failures pile up (not Telegram — minimize watch alerts)
      if (state.consecutive_failures >= 3) {
        await notify?.report(`[BLOCKED] Hunter poll loop failing (${state.consecutive_failures}x): ${error_msg}`);
      }
    }
  };

  // Schedule next cycle after current one completes
  const schedule_next = () => {
    if (!state.running) return;

    const interval = get_current_interval();
    if (state.consecutive_failures > 0) {
      logger.warn(`Backing off: next poll in ${interval}ms (failures: ${state.consecutive_failures})`);
    }

    timer = setTimeout(async () => {
      await run_cycle();
      schedule_next();
    }, interval);
  };

  const start = () => {
    if (state.running) return;
    state.running = true;
    logger.info('Poll loop started');

    // Run first cycle immediately, then schedule
    run_cycle().then(() => schedule_next());
  };

  const stop = () => {
    state.running = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    logger.info(`Poll loop stopped. Total tasks processed: ${state.total_tasks_processed}`);
  };

  const get_state = (): Readonly<PollLoopState> => ({ ...state });

  return { start, stop, get_state, run_cycle, get_current_interval };
};
