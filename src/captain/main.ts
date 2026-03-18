// Captain main entry point — unified orchestrator for all captain services
// Starts: Gateway API, Output Watcher, Planning Loop
// Handles graceful shutdown

import 'dotenv/config';
import { resolve } from 'node:path';
import { create_app } from '../gateway/server.js';
import { create_task_store } from '../gateway/task_store.js';
import { create_planning_loop } from './planning_loop.js';
import { create_routed_watcher, create_watcher_router } from '../watchdog/output_watcher.js';
import { start_hunter_monitor, stop_hunter_monitor } from '../watchdog/hunter_monitor.js';
import { create_telegram_client } from '../notification/telegram.js';
import { create_slack_client } from '../notification/slack.js';
import { create_notification_router, type NotificationRouter } from '../notification/router.js';
import type { Server } from 'node:http';

// === Constants ===

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT ?? '3100', 10);
const GATEWAY_HOST = process.env.GATEWAY_HOST ?? '0.0.0.0';
const SCHEDULES_PATH = resolve(process.cwd(), 'config/schedules.yml');
const DB_PATH = resolve(process.cwd(), 'state/tasks.sqlite');

const WATCHED_SESSIONS = [
  'fas-claude',
  'fas-gemini-a',
  'fas-gateway',
];

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

  // 7. Status summary
  const stats = store.get_stats();
  console.log('======================================');
  console.log('[Captain] All services started');
  console.log(`[Captain] Tasks: pending=${stats.pending ?? 0}, in_progress=${stats.in_progress ?? 0}, done=${stats.done ?? 0}`);
  console.log(`[Captain] Mode: ${dev_mode ? 'DEV' : 'PRODUCTION'}`);
  console.log('======================================');

  // 8. Graceful shutdown
  const shutdown = () => {
    console.log('[Captain] Shutting down...');
    stop_hunter_monitor();
    watcher.stop();
    server.close();
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
