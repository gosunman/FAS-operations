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
import { create_gemini_fallback } from './gemini_fallback.js';
import { create_usage_monitor } from './usage_monitor.js';
import type { CaptainMode } from './usage_monitor.js';

// === Validate required environment variables ===

const bot_token = process.env.TELEGRAM_BOT_TOKEN;
const owner_id = process.env.TELEGRAM_OWNER_ID ?? process.env.TELEGRAM_CHAT_ID;

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

// === Start Telegram Bot (skipped when Captain is running — avoids 409 conflict) ===

// Auto-detect Captain process to prevent 409 Conflict on getUpdates.
// If SKIP_TELEGRAM_BOT is explicitly set, respect it.
// Otherwise, check if captain/main.ts is already running — if so, skip daemon bot.
import { execFileSync } from 'child_process';

const detect_captain_running = (): boolean => {
  if (process.env.SKIP_TELEGRAM_BOT === 'true') return true;
  if (process.env.SKIP_TELEGRAM_BOT === 'false') return false;

  try {
    const result = execFileSync('pgrep', ['-f', 'captain/main.ts'], {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    if (result) {
      console.log(`[Daemon] Captain process detected (PID: ${result.split('\n')[0]}) — auto-skipping Telegram bot`);
      return true;
    }
  } catch {
    // pgrep exits non-zero when no match — that's fine, Captain isn't running
  }
  return false;
};

const skip_telegram = detect_captain_running();

const bot = create_telegram_bot(
  {
    bot_token,
    owner_chat_id: owner_id,
  },
  store,
);

if (skip_telegram) {
  console.log('[Daemon] Telegram bot SKIPPED (SKIP_TELEGRAM_BOT=true — Captain handles Telegram)');
} else {
  bot.start();
}

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

// === Initialize Gemini Fallback & Usage Monitor ===

const gemini_fallback = create_gemini_fallback({
  timeout_ms: parseInt(process.env.GEMINI_TIMEOUT_MS ?? '120000', 10),
  model: process.env.GEMINI_MODEL,
});

const usage_monitor = create_usage_monitor({
  failure_threshold: parseInt(process.env.CLAUDE_FAILURE_THRESHOLD ?? '5', 10),
  warning_threshold: parseInt(process.env.CLAUDE_WARNING_THRESHOLD ?? '3', 10),
});

// Handle mode transitions — notify owner via Telegram
usage_monitor.on_mode_change((old_mode: CaptainMode, new_mode: CaptainMode) => {
  const mode_labels: Record<CaptainMode, string> = {
    normal: 'Claude Code (정상)',
    warning: 'Claude Code (경고)',
    fallback: 'Gemini CLI (응급)',
  };

  const message = [
    `*캡틴 모드 전환*`,
    `${mode_labels[old_mode]} → ${mode_labels[new_mode]}`,
    '',
    new_mode === 'fallback'
      ? 'Claude Code 사용량 소진. Gemini CLI로 응급 대응 중입니다.'
      : new_mode === 'warning'
        ? 'Claude Code 연속 실패 감지. 곧 Gemini 폴백으로 전환될 수 있습니다.'
        : 'Claude Code 복구 완료. 정상 운영으로 복귀합니다.',
  ].join('\n');

  // Fire-and-forget notification
  bot.send_message(message).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Daemon] Failed to send mode change notification: ${msg}`);
  });
});

usage_monitor.start();

// === Graceful shutdown ===

const shutdown = () => {
  console.log('[Daemon] Shutting down...');
  usage_monitor.stop();
  bot.stop();
  if (slack_bot) slack_bot.stop();
  server.close();
  store.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const components = ['Gateway', skip_telegram ? 'Telegram Bot (SKIPPED)' : 'Telegram Bot', 'UsageMonitor', 'GeminiFallback'];
if (slack_bot) components.push('Slack Bot');
console.log(`[Daemon] FAS Daemon started — ${components.join(' + ')}`);

// Check Gemini availability on startup
gemini_fallback.is_available().then((available) => {
  if (available) {
    console.log('[Daemon] Gemini CLI is available — fallback ready');
  } else {
    console.warn('[Daemon] Gemini CLI is NOT available — fallback will not work');
  }
}).catch(() => {
  console.warn('[Daemon] Could not check Gemini CLI availability');
});
