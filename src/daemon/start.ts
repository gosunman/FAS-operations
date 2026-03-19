// FAS Daemon Entrypoint
//
// Starts the Gateway HTTP server, Telegram Bot, and Slack Bot.
// This process runs independently of Claude Code (Captain), ensuring
// the owner can always command Hunter via Telegram or Slack even when
// Captain is down (e.g., due to API quota exhaustion).
//
// Environment variables:
//   TELEGRAM_BOT_TOKEN   — Telegram Bot API token (required)
//   TELEGRAM_OWNER_ID    — Owner's Telegram chat ID (required)
//   SLACK_BOT_TOKEN      — Slack Bot Token xoxb-... (optional, enables Slack bot)
//   SLACK_CHANNEL_ID     — Slack channel ID for hunter tasks (required if SLACK_BOT_TOKEN set)
//   GATEWAY_PORT         — HTTP port for Gateway (default: 3100)
//   GATEWAY_HOST         — HTTP host for Gateway (default: 0.0.0.0)
//   HUNTER_API_KEY       — API key for hunter authentication
//   NODE_ENV             — 'production' | 'development'
//   FAS_DEV_MODE         — 'true' to skip hunter auth (dev only)
//
// Usage:
//   pnpm tsx src/daemon/start.ts

import { create_task_store } from '../gateway/task_store.js';
import { create_app } from '../gateway/server.js';
import { create_telegram_bot } from './telegram_bot.js';
import { create_slack_bot } from './slack_bot.js';

// === Validate required environment variables ===

const bot_token = process.env.TELEGRAM_BOT_TOKEN;
const owner_id = process.env.TELEGRAM_OWNER_ID;

if (!bot_token) {
  console.error('[Daemon] FATAL: TELEGRAM_BOT_TOKEN is not set');
  process.exit(1);
}

if (!owner_id) {
  console.error('[Daemon] FATAL: TELEGRAM_OWNER_ID is not set');
  process.exit(1);
}

// === Gateway configuration ===

const port = parseInt(process.env.GATEWAY_PORT ?? '3100', 10);
const host = process.env.GATEWAY_HOST ?? '0.0.0.0';

const is_production = process.env.NODE_ENV === 'production';
const dev_mode_requested = process.env.NODE_ENV === 'development' || process.env.FAS_DEV_MODE === 'true';
const dev_mode = dev_mode_requested && !is_production;

if (dev_mode_requested && is_production) {
  console.error('[Daemon] FATAL: FAS_DEV_MODE=true is forbidden when NODE_ENV=production');
  process.exit(1);
}

if (!process.env.HUNTER_API_KEY && !dev_mode) {
  console.error('[Daemon] FATAL: HUNTER_API_KEY is not set and dev mode is off');
  process.exit(1);
}

// === Initialize shared TaskStore ===

const store = create_task_store({
  db_path: './state/tasks.sqlite',
});

// === Start Gateway HTTP server ===

const app = create_app(store, {
  hunter_api_key: process.env.HUNTER_API_KEY,
  dev_mode,
});

const server = app.listen(port, host, () => {
  console.log(`[Daemon] Gateway listening on ${host}:${port}`);
});

// === Start Telegram Bot ===

const bot = create_telegram_bot(
  {
    bot_token,
    owner_chat_id: owner_id,
  },
  store,
);

bot.start();

// === Start Slack Bot (optional) ===

const slack_token = process.env.SLACK_BOT_TOKEN;
const slack_channel = process.env.SLACK_CHANNEL_ID;

let slack_bot: ReturnType<typeof create_slack_bot> | null = null;

if (slack_token && slack_channel) {
  slack_bot = create_slack_bot(
    {
      bot_token: slack_token,
      channel_id: slack_channel,
    },
    store,
  );
  slack_bot.start();
} else if (slack_token && !slack_channel) {
  console.warn('[Daemon] SLACK_BOT_TOKEN is set but SLACK_CHANNEL_ID is missing — Slack bot disabled');
} else {
  console.log('[Daemon] Slack bot disabled (SLACK_BOT_TOKEN not set)');
}

// === Graceful shutdown ===

const shutdown = () => {
  console.log('[Daemon] Shutting down...');
  bot.stop();
  if (slack_bot) slack_bot.stop();
  server.close();
  store.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const components = ['Gateway', 'Telegram Bot'];
if (slack_bot) components.push('Slack Bot');
console.log(`[Daemon] FAS Daemon started — ${components.join(' + ')}`);
