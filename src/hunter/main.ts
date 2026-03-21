// Hunter agent entry point — Dual mode: Captain (polling) + Autonomous (revenue)
//
// Mode Router monitors Captain API health and switches between modes:
//   - Captain mode: polls Task API for assigned work (existing behavior)
//   - Autonomous mode: self-directed revenue project discovery/execution/learning
//
// Usage:
//   npx tsx src/hunter/main.ts
//   # or via package.json:
//   pnpm run hunter
//
// Env vars (existing):
//   CAPTAIN_API_URL          — Captain Task API (default: http://100.64.0.1:3100)
//   HUNTER_POLL_INTERVAL     — Poll interval in ms (default: 10000)
//   HUNTER_LOG_DIR           — Log directory (default: ./logs)
//   HUNTER_HEADLESS          — Headless browser mode (default: true)
//   GOOGLE_PROFILE_DIR       — Chrome profile for Google login (default: ./fas-google-profile-hunter)
//   DEEP_RESEARCH_TIMEOUT_MS — Gemini Deep Research timeout (default: 300000)
//   NOTEBOOKLM_TIMEOUT_MS    — NotebookLM timeout (default: 180000)
//
// Env vars (autonomous mode):
//   HUNTER_DB_PATH                  — Project DB path (default: ./data/hunter_projects.db)
//   HUNTER_REPORTS_DIR              — Reports directory (default: ./reports)
//   HUNTER_SCOUT_INTERVAL_MS        — Scout cycle interval (default: 21600000 = 6h)
//   CAPTAIN_HEALTH_CHECK_INTERVAL_MS — Health check interval (default: 30000 = 30s)
//   CAPTAIN_FAILURE_THRESHOLD        — Failures before autonomous switch (default: 3)

import 'dotenv/config';
import { load_hunter_config } from './config.js';
import { create_api_client } from './api_client.js';
import { create_browser_manager } from './browser.js';
import { create_task_executor } from './task_executor.js';
import { create_poll_loop } from './poll_loop.js';
import { create_logger } from './logger.js';
import { create_hunter_notify } from './notify.js';
import { create_mode_router } from './mode_router.js';
import { create_project_db } from './project_db.js';
import { create_revenue_scout } from './revenue_scout.js';
import { create_project_executor } from './project_executor.js';
import { create_retrospective_engine } from './retrospective.js';
import { create_hunter_reporter } from './reporter.js';

const is_main = import.meta.url === `file://${process.argv[1]}`;

if (is_main) {
  const config = load_hunter_config();
  const logger = create_logger(config.log_dir);

  // Initialize notification module (fire-and-forget, optional)
  const notify = create_hunter_notify({
    telegram_bot_token: config.telegram_bot_token,
    telegram_chat_id: config.telegram_chat_id,
    slack_webhook_url: config.slack_webhook_url,
  });
  if (notify.is_configured()) {
    logger.info('Notification channels configured');
  } else {
    logger.warn('No notification channels configured — alerts will only be logged');
  }

  // Initialize browser manager with optional headless config
  const headless = process.env.HUNTER_HEADLESS !== 'false';
  const browser = create_browser_manager({ headless });

  const api = create_api_client({
    base_url: config.captain_api_url,
    api_key: config.hunter_api_key,
  }, logger);

  // Pass Google profile and timeout config to task executor
  const executor = create_task_executor(logger, browser, {
    google_profile_dir: config.google_profile_dir,
    deep_research_timeout_ms: config.deep_research_timeout_ms,
    notebooklm_timeout_ms: config.notebooklm_timeout_ms,
    chatgpt_timeout_ms: config.chatgpt_timeout_ms,
  });

  // Captain mode: existing poll loop
  const poll_loop = create_poll_loop({ api, executor, logger, config, notify });

  // Autonomous mode: project pipeline DB + revenue modules
  const project_db = create_project_db({ db_path: config.autonomous_db_path });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ProjectDB is a superset of all
  // duck-typed ProjectDBLike interfaces. The only mismatch is get_by_status parameter contravariance
  // (ProjectStatus vs string). Runtime behavior is identical; this is a safe cast.
  const db = project_db as any;
  const scout = create_revenue_scout({ config, logger, project_db: db });
  const project_executor = create_project_executor({ config, logger, project_db: db });
  const retrospective = create_retrospective_engine({ config, logger, project_db: db });
  const reporter = create_hunter_reporter({ config, logger, notify, project_db: db });

  // Mode router: switches between captain and autonomous
  const mode_router = create_mode_router({ config, logger, notify });

  // === Revenue loop — runs Scout → Executor → Retrospective cycle ===
  let revenue_timer: ReturnType<typeof setTimeout> | null = null;
  let revenue_running = false;

  const run_revenue_cycle = async () => {
    logger.info('[Revenue Loop] Starting cycle: Scout → Executor → Retrospective');

    try {
      // Step 1: Scout for new opportunities
      logger.info('[Revenue Loop] Running Revenue Scout...');
      const scout_result = await scout.run_scout_cycle();
      logger.info(`[Revenue Loop] Scout found ${scout_result.opportunities_found} opportunities, created ${scout_result.projects_created.length} projects`);

      // Report any new discoveries
      for (const project_id of scout_result.projects_created) {
        const project = project_db.get_by_id(project_id);
        if (project) {
          await reporter.report_project_discovered(project);
        }
      }

      // Step 2: Execute the most promising project
      logger.info('[Revenue Loop] Running Project Executor...');
      const exec_result = await project_executor.execute_next();
      if (exec_result) {
        logger.info(`[Revenue Loop] Executed project ${exec_result.project_id}: ${exec_result.previous_status} → ${exec_result.new_status}`);

        // Report successes and failures
        const project = project_db.get_by_id(exec_result.project_id);
        if (project) {
          if (exec_result.new_status === 'failed') {
            await retrospective.run_failure_analysis(project);
          }
          if (exec_result.new_status === 'needs_owner' || project.owner_action_needed) {
            await reporter.report_owner_help_needed(project);
          }
          if (project.actual_revenue > 0) {
            await reporter.report_project_success(project);
          }
        }
      } else {
        logger.info('[Revenue Loop] No actionable projects in pipeline');
      }
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Revenue Loop] Cycle error: ${error_msg}`);
    }
  };

  const start_revenue_loop = () => {
    if (revenue_running) return;
    revenue_running = true;
    logger.info('[Revenue Loop] Started');

    const schedule_next = () => {
      if (!revenue_running) return;
      revenue_timer = setTimeout(async () => {
        await run_revenue_cycle();
        schedule_next();
      }, config.scout_interval_ms);
    };

    // Run first cycle immediately, then schedule
    run_revenue_cycle().then(() => schedule_next());
  };

  const stop_revenue_loop = () => {
    revenue_running = false;
    if (revenue_timer) {
      clearTimeout(revenue_timer);
      revenue_timer = null;
    }
    logger.info('[Revenue Loop] Stopped');
  };

  // === Daily scheduled tasks ===
  // 22:00 KST daily Telegram summary
  const schedule_daily_summary = () => {
    const check_interval = 60_000; // Check every minute
    setInterval(async () => {
      const now = new Date();
      // Convert to KST (UTC+9)
      const kst_hours = (now.getUTCHours() + 9) % 24;
      const kst_minutes = now.getUTCMinutes();

      // Trigger at 22:00 KST (within the 1-minute window)
      if (kst_hours === 22 && kst_minutes === 0) {
        logger.info('[Scheduler] Running daily summary (22:00 KST)');
        try {
          reporter.save_daily_summary();
          await reporter.send_daily_telegram_summary();
        } catch (err) {
          logger.error(`[Scheduler] Daily summary failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Daily retrospective at midnight KST
      if (kst_hours === 0 && kst_minutes === 0 && mode_router.get_mode() === 'autonomous') {
        logger.info('[Scheduler] Running daily retrospective (00:00 KST)');
        try {
          await retrospective.run_daily();
        } catch (err) {
          logger.error(`[Scheduler] Daily retrospective failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Weekly retrospective on Mondays at 00:30 KST
      if (now.getDay() === 1 && kst_hours === 0 && kst_minutes === 30 && mode_router.get_mode() === 'autonomous') {
        logger.info('[Scheduler] Running weekly retrospective (Monday 00:30 KST)');
        try {
          await retrospective.run_weekly();
        } catch (err) {
          logger.error(`[Scheduler] Weekly retrospective failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }, check_interval);
  };

  // === Mode transition handler ===
  // Watch mode_router state and start/stop appropriate loops
  let last_known_mode = mode_router.get_mode();

  const watch_mode_transitions = () => {
    setInterval(() => {
      const current_mode = mode_router.get_mode();

      if (current_mode !== last_known_mode) {
        logger.info(`[Mode Switch] ${last_known_mode} → ${current_mode}`);

        if (current_mode === 'autonomous') {
          // Captain went down — start revenue loop, keep poll loop running for recovery detection
          start_revenue_loop();
        } else {
          // Captain recovered — stop revenue loop, poll loop continues
          stop_revenue_loop();
        }

        last_known_mode = current_mode;
      }
    }, 5_000); // Check every 5 seconds
  };

  // === Startup ===
  logger.info('═══════════════════════════════════════════════════');
  logger.info('  Hunter Agent v2.0 — Dual Mode (Captain + Autonomous)');
  logger.info('═══════════════════════════════════════════════════');
  logger.info(`Captain API: ${config.captain_api_url}`);
  logger.info(`Poll interval: ${config.poll_interval_ms}ms`);
  logger.info(`Browser mode: ${headless ? 'headless' : 'headed'}`);
  logger.info(`Google profile: ${config.google_profile_dir}`);
  logger.info(`Project DB: ${config.autonomous_db_path}`);
  logger.info(`Reports dir: ${config.reports_dir}`);
  logger.info(`Scout interval: ${config.scout_interval_ms}ms (${config.scout_interval_ms / 3_600_000}h)`);
  logger.info(`Captain failure threshold: ${config.captain_failure_threshold}`);

  // Start all systems
  poll_loop.start();                // Always running — polls Captain for work
  mode_router.start();              // Always running — monitors Captain health
  watch_mode_transitions();         // Always running — handles mode switches
  schedule_daily_summary();         // Always running — daily summaries

  // Start in autonomous mode immediately if Captain is expected to be down
  // (The mode_router will switch back once Captain is confirmed alive)
  logger.info('Hunter agent started in CAPTAIN mode. Monitoring Captain API health...');
  logger.info('Revenue loop will activate automatically if Captain becomes unreachable.');

  await notify.alert('👁️ Hunter Agent v2.0 started — Dual Mode (Captain + Autonomous)');

  // Graceful shutdown — close all resources
  const shutdown = async () => {
    logger.info('Hunter agent shutting down...');
    poll_loop.stop();
    mode_router.stop();
    stop_revenue_loop();
    project_db.close();
    await browser.close();
    logger.info('All resources closed. Exiting.');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
