// Hunter agent entry point
// Polls Captain's Task API, executes tasks via Playwright browser automation
//
// Usage:
//   npx tsx src/hunter/main.ts
//   # or via package.json:
//   pnpm run hunter
//
// Env vars:
//   CAPTAIN_API_URL          — Captain Task API (default: http://100.64.0.1:3100)
//   HUNTER_POLL_INTERVAL     — Poll interval in ms (default: 10000)
//   HUNTER_LOG_DIR           — Log directory (default: ./logs)
//   HUNTER_HEADLESS          — Headless browser mode (default: true)
//   GOOGLE_PROFILE_DIR       — Chrome profile for Google login (default: ./fas-google-profile-hunter)
//   DEEP_RESEARCH_TIMEOUT_MS — Gemini Deep Research timeout (default: 300000)
//   NOTEBOOKLM_TIMEOUT_MS    — NotebookLM timeout (default: 180000)

import { load_hunter_config } from './config.js';
import { create_api_client } from './api_client.js';
import { create_browser_manager } from './browser.js';
import { create_task_executor } from './task_executor.js';
import { create_poll_loop } from './poll_loop.js';
import { create_logger } from './logger.js';

const is_main = import.meta.url === `file://${process.argv[1]}`;

if (is_main) {
  const config = load_hunter_config();
  const logger = create_logger(config.log_dir);

  // Initialize browser manager with optional headless config
  const headless = process.env.HUNTER_HEADLESS !== 'false';
  const browser = create_browser_manager({ headless });

  const api = create_api_client({ base_url: config.captain_api_url }, logger);

  // Pass Google profile and timeout config to task executor
  const executor = create_task_executor(logger, browser, {
    google_profile_dir: config.google_profile_dir,
    deep_research_timeout_ms: config.deep_research_timeout_ms,
    notebooklm_timeout_ms: config.notebooklm_timeout_ms,
  });

  const loop = create_poll_loop({ api, executor, logger, config });

  logger.info(`Hunter agent starting — polling ${config.captain_api_url} every ${config.poll_interval_ms}ms`);
  logger.info(`Browser mode: ${headless ? 'headless' : 'headed'}`);
  logger.info(`Google profile: ${config.google_profile_dir}`);
  loop.start();

  // Graceful shutdown — close browser and stop polling
  const shutdown = async () => {
    logger.info('Hunter agent shutting down...');
    loop.stop();
    await browser.close();
    logger.info('Browser closed. Exiting.');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
