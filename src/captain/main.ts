// Captain main entry point — unified orchestrator for all captain services
// Starts: Gateway API, Output Watcher, Planning Loop
// Handles graceful shutdown

import 'dotenv/config';
import { resolve } from 'node:path';
import { create_app } from '../gateway/server.js';
import { create_task_store } from '../gateway/task_store.js';
import { create_planning_loop, type PlanningLoop } from './planning_loop.js';
import { create_routed_watcher, create_watcher_router } from '../watchdog/output_watcher.js';
import { start_hunter_monitor, stop_hunter_monitor } from '../watchdog/hunter_monitor.js';
import { create_activity_logger, type ActivityLogger } from '../watchdog/activity_logger.js';
import { create_resource_monitor, type ResourceMonitor } from '../watchdog/resource_monitor.js';
import { create_telegram_client } from '../notification/telegram.js';
import { create_slack_client } from '../notification/slack.js';
import { create_notification_router, type NotificationRouter } from '../notification/router.js';
import type { Server } from 'node:http';

// === Constants ===

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT ?? '3100', 10);
const GATEWAY_HOST = process.env.GATEWAY_HOST ?? '0.0.0.0';
const SCHEDULES_PATH = resolve(process.cwd(), 'config/schedules.yml');
const DB_PATH = resolve(process.cwd(), 'state/tasks.sqlite');

const ACTIVITY_DB_PATH = resolve(process.cwd(), 'state/activity.sqlite');

const WATCHED_SESSIONS = [
  'fas-claude',
  'fas-gemini-a',
  'fas-captain',
];

// Planning schedule — hours to run morning (07:30) and night (22:50)
const MORNING_HOUR = 7;
const MORNING_MINUTE = 30;
const NIGHT_HOUR = 22;
const NIGHT_MINUTE = 50;
const SCHEDULE_CHECK_INTERVAL_MS = 60_000; // check every minute

// === Build notification router from env vars ===

const build_router = (): NotificationRouter => {
  const telegram_token = process.env.TELEGRAM_BOT_TOKEN;
  const telegram_chat_id = process.env.TELEGRAM_CHAT_ID;
  const telegram = (telegram_token && telegram_chat_id)
    ? create_telegram_client({ token: telegram_token, chat_id: telegram_chat_id })
    : null;

  const slack_token = process.env.SLACK_BOT_TOKEN;
  const slack = slack_token
    ? create_slack_client({ token: slack_token })
    : null;

  if (!telegram) console.warn('[Captain] TELEGRAM_BOT_TOKEN/CHAT_ID not set — Telegram disabled');
  if (!slack) console.warn('[Captain] SLACK_BOT_TOKEN not set — Slack disabled');

  return create_notification_router({ telegram, slack });
};

// === Main bootstrap ===

const main = async () => {
  console.log('======================================');
  console.log('[Captain] FAS Captain starting...');
  console.log(`[Captain] Time: ${new Date().toISOString()}`);
  console.log('======================================');

  // 1. Task store
  const store = create_task_store({ db_path: DB_PATH });
  console.log(`[Captain] Task store initialized (${DB_PATH})`);

  // 2. Notification router
  const router = build_router();
  console.log('[Captain] Notification router initialized');

  // 3. Gateway API server
  const dev_mode = process.env.FAS_DEV_MODE === 'true' && process.env.NODE_ENV !== 'production';

  const app = create_app(store, {
    hunter_api_key: process.env.HUNTER_API_KEY,
    dev_mode,
    notion_backup: (process.env.NOTION_API_KEY && process.env.NOTION_TASK_RESULTS_DB)
      ? { api_key: process.env.NOTION_API_KEY, database_id: process.env.NOTION_TASK_RESULTS_DB }
      : null,
  });

  const server: Server = await new Promise((resolve) => {
    const srv = app.listen(GATEWAY_PORT, GATEWAY_HOST, () => {
      console.log(`[Captain] Gateway API listening on ${GATEWAY_HOST}:${GATEWAY_PORT}`);
      resolve(srv);
    });
  });

  // 4. Output watcher
  const watcher_router = create_watcher_router();
  const watcher = create_routed_watcher(WATCHED_SESSIONS, watcher_router);
  watcher.start();
  console.log(`[Captain] Output watcher started (sessions: ${WATCHED_SESSIONS.join(', ')})`);

  // 5. Planning loop
  const planning = create_planning_loop({
    store,
    router,
    schedules_path: SCHEDULES_PATH,
  });

  // Run morning planning on startup (creates due tasks)
  try {
    const morning_result = await planning.run_morning();
    console.log(`[Captain] Morning planning: ${morning_result.created.length} tasks created, ${morning_result.skipped.length} skipped`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Captain] Morning planning failed: ${msg}`);
  }

  // 6. Hunter heartbeat monitor
  start_hunter_monitor({
    gateway_url: `http://localhost:${GATEWAY_PORT}`,
    notification_router: router,
  });
  console.log('[Captain] Hunter monitor started');

  // 7. Activity logger (audit trail)
  const activity_logger = create_activity_logger({ db_path: ACTIVITY_DB_PATH });
  console.log(`[Captain] Activity logger initialized (${ACTIVITY_DB_PATH})`);

  // 8. Resource monitor (CPU/memory/disk alerts)
  const resource_monitor = create_resource_monitor({
    check_interval_ms: 120_000, // every 2 minutes
    on_alert: async (metric, value, threshold) => {
      const msg = `[RESOURCE] ${metric} at ${value.toFixed(1)}% (threshold: ${threshold}%)`;
      console.warn(msg);
      await router.route({ type: 'alert', message: msg, device: 'captain' });
    },
  });
  resource_monitor.start();
  console.log('[Captain] Resource monitor started (2min interval)');

  // 9. Daily planning scheduler — runs morning/night planning automatically
  let last_morning_date = '';
  let last_night_date = '';

  const schedule_timer = setInterval(async () => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const today = now.toISOString().slice(0, 10);

    // Morning planning at 07:30 (once per day)
    if (h === MORNING_HOUR && m === MORNING_MINUTE && last_morning_date !== today) {
      last_morning_date = today;
      try {
        const result = await planning.run_morning(now);
        console.log(`[Captain] Scheduled morning planning: ${result.created.length} tasks created`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Captain] Scheduled morning planning failed: ${msg}`);
      }
    }

    // Night planning at 22:50 (once per day)
    if (h === NIGHT_HOUR && m === NIGHT_MINUTE && last_night_date !== today) {
      last_night_date = today;
      try {
        const result = await planning.run_night();
        console.log(`[Captain] Scheduled night planning: done=${result.summary.done}, blocked=${result.summary.blocked}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Captain] Scheduled night planning failed: ${msg}`);
      }
    }
  }, SCHEDULE_CHECK_INTERVAL_MS);
  if (schedule_timer.unref) schedule_timer.unref();
  console.log(`[Captain] Daily scheduler started (morning ${MORNING_HOUR}:${String(MORNING_MINUTE).padStart(2, '0')}, night ${NIGHT_HOUR}:${String(NIGHT_MINUTE).padStart(2, '0')})`);

  // 10. Status summary
  const stats = store.get_stats();
  console.log('======================================');
  console.log('[Captain] All services started');
  console.log(`[Captain] Tasks: pending=${stats.pending ?? 0}, in_progress=${stats.in_progress ?? 0}, done=${stats.done ?? 0}`);
  console.log(`[Captain] Mode: ${dev_mode ? 'DEV' : 'PRODUCTION'}`);
  console.log('======================================');

  // 11. Graceful shutdown
  const shutdown = () => {
    console.log('[Captain] Shutting down...');
    clearInterval(schedule_timer);
    resource_monitor.stop();
    stop_hunter_monitor();
    watcher.stop();
    server.close();
    activity_logger.close();
    store.close();
    console.log('[Captain] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

// Run
main().catch((err) => {
  console.error('[Captain] Fatal error:', err);
  process.exit(1);
});
