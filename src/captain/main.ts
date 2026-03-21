// Captain main entry point — unified orchestrator for all captain services
// Starts: Gateway API, Output Watcher, Planning Loop
// Handles graceful shutdown

import 'dotenv/config';
import { resolve } from 'node:path';
import { create_app } from '../gateway/server.js';
import { create_task_store } from '../gateway/task_store.js';
import { create_planning_loop, type PlanningLoop } from './planning_loop.js';
import { create_persona_injector } from './persona_injector.js';
import { create_routed_watcher, create_watcher_router } from '../watchdog/output_watcher.js';
import { start_hunter_monitor, stop_hunter_monitor } from '../watchdog/hunter_monitor.js';
import { create_activity_logger, type ActivityLogger } from '../watchdog/activity_logger.js';
import { create_activity_hooks, type ActivityHooks } from '../watchdog/activity_integration.js';
import { create_resource_monitor, type ResourceMonitor } from '../watchdog/resource_monitor.js';
import { create_telegram_client } from '../notification/telegram.js';
import { create_slack_client } from '../notification/slack.js';
import { create_notification_router, type NotificationRouter } from '../notification/router.js';
import { create_notion_client, type NotionClient } from '../notification/notion.js';
import { create_feedback_extractor, type FeedbackExtractor } from './feedback_extractor.js';
import { create_telegram_commands, type TelegramCommands } from './telegram_commands.js';
import { create_morning_briefing, type MorningBriefing } from './morning_briefing.js';
import { create_task_executor, type TaskExecutor } from './task_executor.js';
import { create_captain_worker, type CaptainWorker } from './captain_worker.js';
import { create_lighthouse_auditor } from '../pipeline/lighthouse_audit.js';
import { create_cross_approval } from '../gateway/cross_approval.js';
import { create_crash_monitor } from '../watchdog/crash_recovery.js';
import { create_local_script_handler } from './local_script_handler.js';
import { create_crash_alert_bridge } from '../watchdog/alert_integration.js';
import { create_result_router } from '../pipeline/result_router.js';
import { create_research_store } from './research_store.js';
import { create_notebooklm_verifier } from '../gateway/notebooklm_verify.js';
import { safe_fire_forget } from '../shared/safe_fire_forget.js';
import type { GeminiConfig } from '../gemini/types.js';
import { execSync } from 'node:child_process';
import { get_sessions_for_device } from '../shared/agents_config.js';
import type { Server } from 'node:http';

// === Constants ===

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT ?? '3100', 10);
const GATEWAY_HOST = process.env.GATEWAY_HOST ?? '0.0.0.0';
const SCHEDULES_PATH = resolve(process.cwd(), 'config/schedules.yml');
const DB_PATH = resolve(process.cwd(), 'state/tasks.sqlite');

const ACTIVITY_DB_PATH = resolve(process.cwd(), 'state/activity.sqlite');
const CRASH_STATE_PATH = resolve(process.cwd(), 'state/crash_history.json');

// Doctrine memory directory — source of user context for persona injection
const DOCTRINE_MEMORY_DIR = process.env.DOCTRINE_MEMORY_DIR
  ?? '/Users/user/Library/Mobile Documents/com~apple~CloudDocs/claude-config/green-zone/shared/memory';

// Doctrine feedback file — feedback extractor appends lessons learned here
const DOCTRINE_FEEDBACK_PATH = process.env.DOCTRINE_FEEDBACK_PATH
  ?? '/Users/user/Library/Mobile Documents/com~apple~CloudDocs/claude-config/green-zone/shared/memory/feedback_lessons.md';

// Dynamically load watched sessions from config/agents.yml (single source of truth).
// Only watch captain-device sessions that actually exist as tmux sessions.
// The captain daemon's own session (fas-captain) is excluded since watching itself is pointless.
const CAPTAIN_SELF_SESSION = 'fas-captain';

const get_live_tmux_sessions = (): Set<string> => {
  try {
    const output = execSync('tmux list-sessions -F "#{session_name}"', { encoding: 'utf-8' });
    return new Set(output.trim().split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
};

const live_sessions = get_live_tmux_sessions();
const WATCHED_SESSIONS = get_sessions_for_device('captain')
  .filter((s) => s !== CAPTAIN_SELF_SESSION && live_sessions.has(s));

// Planning schedule — hours to run morning (07:30) and night (22:50)
const MORNING_HOUR = 7;
const MORNING_MINUTE = 30;
const NIGHT_HOUR = 22;
const NIGHT_MINUTE = 50;
const SCHEDULE_CHECK_INTERVAL_MS = 60_000; // check every minute
const STALE_CHECK_INTERVAL_MS = 5 * 60_000; // check every 5 minutes
const STALE_TIMEOUT_MS = 30 * 60_000; // 30 minutes

// === Build notification router from env vars ===

const build_notification_stack = (activity_hooks?: ActivityHooks | null): { router: NotificationRouter; notion: NotionClient | null } => {
  const telegram_token = process.env.TELEGRAM_BOT_TOKEN;
  const telegram_chat_id = process.env.TELEGRAM_CHAT_ID;
  const telegram = (telegram_token && telegram_chat_id)
    ? create_telegram_client({ token: telegram_token, chat_id: telegram_chat_id })
    : null;

  const slack_token = process.env.SLACK_BOT_TOKEN;
  const slack = slack_token
    ? create_slack_client({ token: slack_token })
    : null;

  // Notion client (optional — requires NOTION_API_KEY + NOTION_NOTIFICATION_DB)
  // Notion: use NOTION_DAILY_REPORTS_DB as the notification target
  // (briefings and crawl results go here alongside daily reports)
  const notion_api_key = process.env.NOTION_API_KEY;
  const notion_db_id = process.env.NOTION_DAILY_REPORTS_DB ?? process.env.NOTION_TASK_RESULTS_DB;
  const notion = (notion_api_key && notion_db_id)
    ? create_notion_client({ api_key: notion_api_key, database_id: notion_db_id })
    : null;

  if (!telegram) console.warn('[Captain] TELEGRAM_BOT_TOKEN/CHAT_ID not set — Telegram disabled');
  if (!slack) console.warn('[Captain] SLACK_BOT_TOKEN not set — Slack disabled');
  if (!notion) console.warn('[Captain] NOTION_API_KEY not set — Notion routing disabled');

  const router = create_notification_router({ telegram, slack, notion, activity_hooks });
  return { router, notion };
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

  // 1b. Activity logger + hooks (created early so all services can use it)
  const activity_logger = create_activity_logger({ db_path: ACTIVITY_DB_PATH });
  const activity_hooks = create_activity_hooks(activity_logger);
  console.log(`[Captain] Activity logger initialized (${ACTIVITY_DB_PATH})`);

  // 2. Notification router + Notion client (shared between router and morning briefing)
  const { router, notion } = build_notification_stack(activity_hooks);
  console.log('[Captain] Notification router initialized');

  // 2b. Crash recovery monitor — wrapped with alert bridge for Telegram notifications
  const raw_crash_monitor = create_crash_monitor({
    state_path: CRASH_STATE_PATH,
    max_restarts: 3,
    cooldown_ms: 30_000,
  });
  const crash_monitor = create_crash_alert_bridge({
    monitor: raw_crash_monitor,
    router,
    config: { crash_telegram_on_isolation: true },
  });
  console.log(`[Captain] Crash monitor initialized with alert bridge (${CRASH_STATE_PATH})`);

  // 2c. Research store (Deep Research results persistence)
  const RESEARCH_DIR = resolve(process.cwd(), 'research');
  const research_store = create_research_store(RESEARCH_DIR);
  console.log(`[Captain] Research store initialized (${RESEARCH_DIR})`);

  // 2d. Result router (dispatches hunter results to specialized handlers)
  const result_router = create_result_router({ router, research_store });
  console.log('[Captain] Result router initialized');

  // 3. Gateway API server
  const dev_mode = process.env.FAS_DEV_MODE === 'true' && process.env.NODE_ENV !== 'production';

  const app = create_app(store, {
    hunter_api_key: process.env.HUNTER_API_KEY,
    dev_mode,
    notion_backup: (process.env.NOTION_API_KEY && process.env.NOTION_TASK_RESULTS_DB)
      ? { api_key: process.env.NOTION_API_KEY, database_id: process.env.NOTION_TASK_RESULTS_DB }
      : null,
    notification_router: router,
    activity_logger,
    result_router,
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

  // 5. Persona injector (enriches hunter task descriptions with user context)
  const persona_injector = create_persona_injector(DOCTRINE_MEMORY_DIR);
  console.log(`[Captain] Persona injector initialized (${DOCTRINE_MEMORY_DIR})`);

  // 6. Planning loop (with Gemini config for dynamic task discovery)
  const gemini_config: GeminiConfig = {
    account: 'a',
    gemini_command: process.env.GEMINI_COMMAND ?? 'gemini',
  };

  const planning = create_planning_loop({
    store,
    router,
    schedules_path: SCHEDULES_PATH,
    persona_injector,
    gemini_config,
  });

  // Run morning planning on startup (creates due tasks)
  try {
    const morning_result = await planning.run_morning();
    console.log(`[Captain] Morning planning: ${morning_result.created.length} tasks created, ${morning_result.skipped.length} skipped`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Captain] Morning planning failed: ${msg}`);
  }

  // 6b. Morning briefing module (overnight summary + today's schedule + blocked tasks)
  const morning_briefing = create_morning_briefing({
    store,
    router,
    notion,
    schedules_path: SCHEDULES_PATH,
  });

  // Run initial morning briefing on startup (fire-and-forget with Slack alert)
  safe_fire_forget(morning_briefing.run(), 'morning_briefing_startup', { router });
  console.log('[Captain] Morning briefing module initialized');

  // 7. Hunter heartbeat monitor
  start_hunter_monitor({
    gateway_url: `http://localhost:${GATEWAY_PORT}`,
    notification_router: router,
  });
  console.log('[Captain] Hunter monitor started');

  // 8. Feedback extractor (lessons learned from completed tasks → Doctrine)
  const feedback_extractor = create_feedback_extractor({
    feedback_path: DOCTRINE_FEEDBACK_PATH,
  });
  console.log(`[Captain] Feedback extractor initialized (${DOCTRINE_FEEDBACK_PATH})`);

  // 10. Resource monitor (CPU/memory/disk alerts)
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

  // 11. Cross-approval gate + Task executor (MID-risk pre-execution check)
  const cross_approval = create_cross_approval({
    gemini_command: process.env.GEMINI_COMMAND ?? 'gemini',
    timeout_ms: parseInt(process.env.CROSS_APPROVAL_TIMEOUT_MS ?? '600000', 10),
  });

  const task_executor = create_task_executor({
    store,
    router,
    approval: cross_approval,
    poll_interval_ms: parseInt(process.env.TASK_EXECUTOR_POLL_MS ?? '30000', 10),
  });
  task_executor.start();
  console.log('[Captain] Task executor started (cross-approval gate for MID-risk tasks)');

  // 11b. Captain worker — executes captain-assigned tasks (lighthouse_audit, etc.)
  const lighthouse_urls = (process.env.LIGHTHOUSE_URLS ?? '').split(',').map((u) => u.trim()).filter(Boolean);
  const lighthouse_handler = lighthouse_urls.length > 0
    ? async () => {
        const auditor = create_lighthouse_auditor({ urls: lighthouse_urls });
        const results = await auditor.audit_all();
        const degradations = auditor.check_degradation();
        const total_violations = results.reduce((n, r) => n + r.violations.length, 0);
        const summary = `Audited ${results.length} URL(s). Violations: ${total_violations}. Degradations: ${degradations.length}.`;

        // Alert on degradation
        if (degradations.length > 0) {
          await router.route({
            type: 'alert',
            message: `[LIGHTHOUSE] Score degradation detected:\n${degradations.join('\n')}`,
            device: 'captain',
          }).catch(() => {});
        }

        return {
          summary,
          files_created: ['state/lighthouse_history.json'],
        };
      }
    : undefined;

  // local_script handler — executes scripts from task description field
  const local_script_handler = create_local_script_handler({
    allowed_dirs: [resolve(process.cwd(), 'scripts')],
    timeout_ms: 120_000, // 2 min max per script
  });

  const captain_worker = create_captain_worker({
    store,
    router,
    handlers: {
      ...(lighthouse_handler ? { lighthouse_audit: lighthouse_handler } : {}),
      local_script: local_script_handler,
    },
    poll_interval_ms: parseInt(process.env.CAPTAIN_WORKER_POLL_MS ?? '30000', 10),
  });
  captain_worker.start();
  console.log(`[Captain] Captain worker started (handlers: lighthouse_audit, local_script)`);

  // 12. Telegram command listener (inbound commands from user)
  let telegram_commands: TelegramCommands | null = null;
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    telegram_commands = create_telegram_commands(
      {
        bot_token: process.env.TELEGRAM_BOT_TOKEN,
        chat_id: process.env.TELEGRAM_CHAT_ID,
      },
      store,
      activity_hooks,
    );
    telegram_commands.start();
    console.log('[Captain] Telegram command listener started');
  } else {
    console.warn('[Captain] TELEGRAM_BOT_TOKEN/CHAT_ID not set — Telegram commands disabled');
  }

  // 12. Daily planning scheduler — runs morning/night planning automatically
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

      // Morning briefing — runs after planning to include newly created tasks (fire-and-forget)
      morning_briefing.run(now).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Captain] Scheduled morning briefing failed: ${msg}`);
      });
    }

    // Night planning at 22:50 (once per day)
    if (h === NIGHT_HOUR && m === NIGHT_MINUTE && last_night_date !== today) {
      last_night_date = today;
      try {
        const result = await planning.run_night();
        console.log(`[Captain] Scheduled night planning: done=${result.summary.done}, blocked=${result.summary.blocked}`);

        // Extract feedback from today's completed tasks (fire-and-forget)
        const done_tasks = store.get_by_status('done');
        const today_done = done_tasks.filter((t) =>
          t.completed_at && t.completed_at.startsWith(today),
        );
        for (const task of today_done) {
          if (task.output?.summary) {
            safe_fire_forget(
              feedback_extractor.extract(task.title, task.output.summary),
              `feedback_extract:${task.title}`,
              { router },
            );
          }
        }
        if (today_done.length > 0) {
          console.log(`[Captain] Feedback extraction queued for ${today_done.length} completed tasks`);
        }

        // Cleanup old research files (30-day retention)
        try {
          const cleanup = research_store.cleanup_old_research(30);
          if (cleanup.deleted_count > 0) {
            console.log(`[Captain] Research cleanup: deleted ${cleanup.deleted_count} old entries`);
          }
        } catch (err) { console.warn('[Captain] Research cleanup failed:', err); }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Captain] Scheduled night planning failed: ${msg}`);
      }
    }
  }, SCHEDULE_CHECK_INTERVAL_MS);
  if (schedule_timer.unref) schedule_timer.unref();
  console.log(`[Captain] Daily scheduler started (morning ${MORNING_HOUR}:${String(MORNING_MINUTE).padStart(2, '0')}, night ${NIGHT_HOUR}:${String(NIGHT_MINUTE).padStart(2, '0')})`);

  // 13. Stale in_progress task cleanup — timeout tasks stuck for 30+ minutes
  const stale_timer = setInterval(() => {
    try {
      const stale_tasks = store.get_stale_in_progress(STALE_TIMEOUT_MS);
      for (const task of stale_tasks) {
        store.block_task(task.id, 'Timed out: no result received within 30 minutes');
        console.warn(`[Captain] Stale task timed out: "${task.title}" (${task.id})`);
      }
      if (stale_tasks.length > 0) {
        safe_fire_forget(
          router.route({
            type: 'alert',
            message: `[STALE] ${stale_tasks.length} task(s) timed out after 30 minutes: ${stale_tasks.map((t) => t.title).join(', ')}`,
            device: 'captain',
          }),
          'stale_task_alert',
          { router },
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Captain] Stale task cleanup error: ${msg}`);
    }
  }, STALE_CHECK_INTERVAL_MS);
  if (stale_timer.unref) stale_timer.unref();
  console.log(`[Captain] Stale task cleanup started (${STALE_CHECK_INTERVAL_MS / 60_000}min interval, ${STALE_TIMEOUT_MS / 60_000}min timeout)`);

  // 14. Status summary
  const stats = store.get_stats();
  console.log('======================================');
  console.log('[Captain] All services started');
  console.log(`[Captain] Tasks: pending=${stats.pending ?? 0}, in_progress=${stats.in_progress ?? 0}, done=${stats.done ?? 0}`);
  console.log(`[Captain] Mode: ${dev_mode ? 'DEV' : 'PRODUCTION'}`);
  console.log('======================================');

  // 15. Graceful shutdown
  const shutdown = () => {
    console.log('[Captain] Shutting down...');
    clearInterval(schedule_timer);
    clearInterval(stale_timer);
    task_executor.stop();
    captain_worker.stop();
    telegram_commands?.stop();
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
