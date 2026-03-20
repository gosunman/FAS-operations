// n8n webhook integration routes for FAS Gateway
// Provides HTTP endpoints that n8n workflows call via Cron triggers
//
// Routes:
//   POST /planning/morning  — trigger morning planning loop
//   POST /planning/night    — trigger night planning loop + discovery
//   POST /task-result-webhook — receive task result and route to notification channels
//   GET  /metrics           — system metrics for n8n dashboard (task counts, mode, agents)

import { Router } from 'express';
import type { PlanningLoop } from '../captain/planning_loop.js';
import type { NotificationRouter } from '../notification/router.js';
import type { TaskStore } from './task_store.js';
import type { ModeManager } from './mode_manager.js';
import type { NotificationEventType } from '../shared/types.js';

// === Dependency injection ===

export type N8nWebhookDeps = {
  planning_loop: PlanningLoop;
  router: NotificationRouter;
  store: TaskStore;
  mode_manager: ModeManager;
};

// === Result type to notification event mapping ===

const RESULT_TYPE_MAP: Record<string, NotificationEventType> = {
  crawl: 'crawl_result',
  error: 'alert',
  discovery: 'discovery',
  blocked: 'blocked',
  done: 'done',
};

const VALID_RESULT_TYPES = new Set(Object.keys(RESULT_TYPE_MAP));

// === Factory ===

export const create_n8n_routes = (deps: N8nWebhookDeps): Router => {
  const n8n_router = Router();

  // POST /planning/morning — triggered by n8n Cron at 07:30 KST
  // Reads schedules.yml, creates due tasks, sends morning briefing
  n8n_router.post('/planning/morning', async (_req, res) => {
    try {
      const result = await deps.planning_loop.run_morning();
      res.json({
        created: result.created,
        skipped: result.skipped,
        created_count: result.created.length,
        skipped_count: result.skipped.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        error: 'PLANNING_ERROR',
        message: `Morning planning failed: ${message}`,
      });
    }
  });

  // POST /planning/night — triggered by n8n Cron at 23:00 KST
  // Sends daily summary + discovers opportunities from crawl results
  n8n_router.post('/planning/night', async (_req, res) => {
    try {
      const result = await deps.planning_loop.run_night();
      res.json({
        summary: result.summary,
        discovery: result.discovery,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        error: 'PLANNING_ERROR',
        message: `Night planning failed: ${message}`,
      });
    }
  });

  // POST /task-result-webhook — receives task result notification from server.ts
  // Routes to appropriate notification channel based on result_type
  n8n_router.post('/task-result-webhook', async (req, res) => {
    const { task_id, result_type, title, summary } = req.body;

    // Validate required fields
    if (!task_id || !result_type || !title || !summary) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'task_id, result_type, title, and summary are required',
      });
      return;
    }

    // Validate result_type
    if (!VALID_RESULT_TYPES.has(result_type)) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: `Invalid result_type "${result_type}". Must be one of: ${[...VALID_RESULT_TYPES].join(', ')}`,
      });
      return;
    }

    // Map result_type to notification event type
    const event_type = RESULT_TYPE_MAP[result_type];
    const channel = event_type;

    // Route notification
    try {
      await deps.router.route({
        type: event_type,
        message: `[${title}] ${summary}`,
        device: 'captain',
        severity: result_type === 'error' ? 'high' : result_type === 'discovery' ? 'mid' : 'low',
      });

      res.json({
        routed: true,
        channel,
        task_id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        error: 'NOTIFICATION_ERROR',
        message: `Failed to route notification: ${message}`,
      });
    }
  });

  // GET /metrics — system metrics for n8n dashboard and alerting
  // Returns task counts, mode state, and timestamp
  n8n_router.get('/metrics', (_req, res) => {
    const stats = deps.store.get_stats();
    const mode_state = deps.mode_manager.get_state();

    res.json({
      tasks: {
        pending: stats.pending ?? 0,
        in_progress: stats.in_progress ?? 0,
        done: stats.done ?? 0,
        blocked: stats.blocked ?? 0,
        quarantined: stats.quarantined ?? 0,
      },
      mode: {
        current_mode: mode_state.current_mode,
        switched_at: mode_state.switched_at,
        next_scheduled_switch: mode_state.next_scheduled_switch,
      },
      timestamp: new Date().toISOString(),
    });
  });

  return n8n_router;
};
