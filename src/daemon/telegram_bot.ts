// Standalone Telegram Bot Daemon for FAS
//
// Runs independently of Claude Code (Captain). When Captain is down
// (e.g., Claude Code quota exhausted), the owner can still send tasks
// to Hunter via Telegram. This bot creates tasks directly
// in the TaskStore, which Hunter polls for pending work.
//
// Natural language mode:
//   Any message from the owner is automatically converted to a Hunter task.
//   The action type is inferred from message content:
//     - URL detected → web_crawl
//     - Research keywords → deep_research
//     - Everything else → chatgpt_task (default)
//
// Utility slash commands (kept for convenience):
//   /status           — Show task statistics
//   /tasks            — List pending tasks
//   /cancel <task_id> — Cancel a task
//
// Security:
//   - Only accepts messages from the configured owner chat ID
//   - Uses native fetch (Node 20+) for Telegram Bot API

import type { TaskStore } from '../gateway/task_store.js';
import type { PiiDetection } from '../gateway/sanitizer.js';

// === Sanitizer interface for dependency injection ===
// Optional — when not provided, no PII filtering is applied (backward compatible)

export type BotSanitizer = {
  sanitize_text: (text: string) => string;
  contains_critical_pii: (text: string) => boolean;
  detect_pii_with_severity: (text: string) => PiiDetection[];
};

// === Configuration ===

export type TelegramBotConfig = {
  bot_token: string;
  owner_chat_id: string;           // Only this chat ID is allowed
  poll_interval_ms?: number;        // Fallback delay between polls on error (default: 3000)
};

// === Telegram API types (minimal subset) ===

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string };
    chat: { id: number };
    text?: string;
    date: number;
  };
};

type TelegramGetUpdatesResponse = {
  ok: boolean;
  result: TelegramUpdate[];
};

// === Action type inference ===

export type HunterAction = 'web_crawl' | 'deep_research' | 'chatgpt_task';

// URL detection regex — matches http/https URLs
const URL_PATTERN = /https?:\/\/\S+/i;

// Keywords that indicate a research/investigation request
const RESEARCH_KEYWORDS = [
  '리서치', '조사', '알아봐', '찾아봐', '찾아줘',
  '검색', '분석', '비교', '살펴봐',
  'research', 'investigate', 'analyze', 'compare',
];

/** Infer the appropriate Hunter action from message content */
export const infer_action = (text: string): HunterAction => {
  // If a URL is present, treat as web crawl
  if (URL_PATTERN.test(text)) {
    return 'web_crawl';
  }

  // Check for research keywords (case-insensitive)
  const lower = text.toLowerCase();
  for (const keyword of RESEARCH_KEYWORDS) {
    if (lower.includes(keyword)) {
      return 'deep_research';
    }
  }

  // Default: general chatgpt task
  return 'chatgpt_task';
};

// === Constants ===

const LONG_POLL_TIMEOUT_S = 30;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const MAX_PENDING_DISPLAY = 10;
const LOG_PREFIX = '[TelegramBot]';

// Action label mapping for user-friendly confirmation messages
const ACTION_LABELS: Record<HunterAction, string> = {
  web_crawl: 'web_crawl',
  deep_research: 'deep_research',
  chatgpt_task: 'chatgpt_task',
};

// === Factory ===

export const create_telegram_bot = (
  config: TelegramBotConfig,
  store: TaskStore,
  sanitizer?: BotSanitizer,
) => {
  let running = false;
  let last_update_id = 0;
  let abort_controller: AbortController | null = null;
  const poll_interval = config.poll_interval_ms ?? DEFAULT_POLL_INTERVAL_MS;
  const base_url = `https://api.telegram.org/bot${config.bot_token}`;

  // === Telegram API helpers ===

  /** Send a message to the owner */
  const send_message = async (text: string): Promise<void> => {
    try {
      const res = await fetch(`${base_url}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.owner_chat_id,
          text,
          parse_mode: 'Markdown',
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`${LOG_PREFIX} sendMessage failed: ${res.status} ${body}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} sendMessage error: ${msg}`);
    }
  };

  // === Slash command handlers (utility only) ===

  /** /status — Reply with current task statistics */
  const handle_status = async (): Promise<void> => {
    const stats = store.get_stats();
    const lines = [
      '*FAS 태스크 현황*',
      '',
      `대기: ${stats.pending ?? 0}`,
      `진행중: ${stats.in_progress ?? 0}`,
      `완료: ${stats.done ?? 0}`,
      `차단: ${stats.blocked ?? 0}`,
      `격리: ${stats.quarantined ?? 0}`,
    ];
    await send_message(lines.join('\n'));
  };

  /** /tasks — Reply with list of pending tasks (max 10) */
  const handle_tasks = async (): Promise<void> => {
    const pending = store.get_by_status('pending');
    if (pending.length === 0) {
      await send_message('대기중인 태스크가 없습니다.');
      return;
    }

    const display = pending.slice(0, MAX_PENDING_DISPLAY);
    const lines = [
      `*대기중 태스크* (${pending.length}건)`,
      '',
      ...display.map((t, i) =>
        `${i + 1}. \`${t.id.slice(0, 8)}\` [${t.assigned_to}] ${t.title}`,
      ),
    ];
    if (pending.length > MAX_PENDING_DISPLAY) {
      lines.push(`\n...외 ${pending.length - MAX_PENDING_DISPLAY}건`);
    }
    await send_message(lines.join('\n'));
  };

  /** /cancel <task_id> — Cancel (block) a task by ID */
  const handle_cancel = async (args: string): Promise<void> => {
    if (!args) {
      await send_message('사용법: `/cancel <task_id>`\ntask\\_id를 입력해주세요.');
      return;
    }
    const task_id = args;
    const task = store.get_by_id(task_id);
    if (!task) {
      await send_message(`태스크를 찾을 수 없습니다: \`${task_id}\``);
      return;
    }
    const success = store.block_task(task_id, 'Cancelled by owner via Telegram');
    if (success) {
      await send_message(`태스크 취소됨: \`${task_id}\`\n${task.title}`);
    } else {
      await send_message(`태스크 취소 실패: \`${task_id}\``);
    }
  };

  // === Natural language task creation ===

  /** Convert a natural language message into a Hunter task */
  const handle_natural_message = async (text: string): Promise<void> => {
    // PII filtering: block critical PII, auto-mask warning PII
    if (sanitizer) {
      // Check for critical PII first — block entirely if found
      if (sanitizer.contains_critical_pii(text)) {
        const detections = sanitizer.detect_pii_with_severity(text);
        const critical_types = detections
          .filter((d) => d.severity === 'critical')
          .map((d) => d.name)
          .join(', ');
        console.warn(`${LOG_PREFIX} Blocked message with critical PII: ${critical_types}`);
        await send_message(
          `⚠️ 개인정보(${critical_types})가 포함되어 있어 헌터에게 전달할 수 없습니다.\n` +
          '개인정보를 제거한 후 다시 시도해주세요.',
        );
        return;
      }
    }

    const action = infer_action(text);

    // Build title based on action type
    let title: string;
    switch (action) {
      case 'web_crawl': {
        const url_match = text.match(URL_PATTERN);
        title = `웹 크롤링: ${url_match ? url_match[0].slice(0, 60) : text.slice(0, 60)}`;
        break;
      }
      case 'deep_research':
        title = `리서치: ${text.slice(0, 60)}`;
        break;
      default:
        title = text.slice(0, 80);
        break;
    }

    // Apply sanitizer for warning-level PII (auto-mask)
    let sanitized_title = title;
    let sanitized_description = text;
    let has_warning_pii = false;

    if (sanitizer) {
      const detections = sanitizer.detect_pii_with_severity(text);
      has_warning_pii = detections.some((d) => d.severity === 'warning');

      if (has_warning_pii) {
        sanitized_title = sanitizer.sanitize_text(title);
        sanitized_description = sanitizer.sanitize_text(text);
      }
    }

    const task = store.create({
      title: sanitized_title,
      description: sanitized_description,
      action,
      assigned_to: 'hunter',
      priority: 'medium',
      risk_level: 'low',
    });

    await send_message(`👁️ 헌터에게 전달했습니다. (${ACTION_LABELS[action]})\n\`${task.id}\``);

    // Notify owner about auto-masking
    if (has_warning_pii) {
      await send_message('⚠️ 일부 개인정보가 자동 마스킹되었습니다.');
    }
  };

  // === Message dispatcher ===

  /** Parse and dispatch a single message */
  const handle_message = async (text: string, chat_id: string): Promise<void> => {
    // Security: only accept messages from the configured owner
    if (chat_id !== config.owner_chat_id) {
      console.warn(`${LOG_PREFIX} Rejected message from unauthorized chat: ${chat_id}`);
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;

    try {
      // Check for utility slash commands first
      if (trimmed.startsWith('/')) {
        const space_index = trimmed.indexOf(' ');
        const command = space_index > 0 ? trimmed.slice(0, space_index) : trimmed;
        const args = space_index > 0 ? trimmed.slice(space_index + 1).trim() : '';

        switch (command) {
          case '/status':
            await handle_status();
            return;
          case '/tasks':
            await handle_tasks();
            return;
          case '/cancel':
            await handle_cancel(args);
            return;
          default:
            // Unknown slash command — still treat as natural language task
            // (user might have typed /something out of habit)
            break;
        }
      }

      // Natural language: create Hunter task automatically
      await handle_natural_message(trimmed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} Error handling message: ${msg}`);
      await send_message(`오류 발생: ${msg}`);
    }
  };

  // === Polling loop ===

  /** Fetch updates from Telegram using long polling */
  const fetch_updates = async (): Promise<TelegramUpdate[]> => {
    const url = `${base_url}/getUpdates?offset=${last_update_id + 1}&timeout=${LONG_POLL_TIMEOUT_S}&allowed_updates=["message"]`;
    abort_controller = new AbortController();

    const res = await fetch(url, { signal: abort_controller.signal });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`getUpdates failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as TelegramGetUpdatesResponse;
    if (!data.ok) {
      throw new Error('getUpdates returned ok=false');
    }
    return data.result;
  };

  /** Main polling loop — runs sequentially */
  const poll_loop = async (): Promise<void> => {
    while (running) {
      try {
        const updates = await fetch_updates();

        for (const update of updates) {
          last_update_id = update.update_id;

          if (update.message?.text) {
            await handle_message(
              update.message.text,
              String(update.message.chat.id),
            );
          }
        }
      } catch (err) {
        // AbortError is expected when stop() is called
        if (err instanceof Error && err.name === 'AbortError') {
          break;
        }
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${LOG_PREFIX} Poll error: ${msg}`);
        // Wait before retrying on error
        await new Promise((r) => setTimeout(r, poll_interval));
      }
    }
  };

  // === Result notification ===

  /** Notify the owner when a hunter task completes */
  const notify_task_result = async (
    task_id: string,
    title: string,
    summary: string,
  ): Promise<void> => {
    // Truncate long summaries to avoid Telegram message limit (4096 chars)
    const max_summary = 3000;
    const truncated = summary.length > max_summary
      ? summary.slice(0, max_summary) + '\n\n...(생략)'
      : summary;

    const lines = [
      '*태스크 완료*',
      '',
      `*${title}*`,
      `ID: \`${task_id}\``,
      '',
      truncated,
    ];
    await send_message(lines.join('\n'));
  };

  // === Public API ===

  const start = () => {
    if (running) return;
    running = true;
    console.log(`${LOG_PREFIX} Daemon started — polling for messages`);
    // Fire-and-forget — poll_loop handles its own lifecycle
    poll_loop().catch((err) => {
      console.error(`${LOG_PREFIX} Poll loop crashed:`, err);
    });
  };

  const stop = () => {
    running = false;
    if (abort_controller) {
      abort_controller.abort();
      abort_controller = null;
    }
    console.log(`${LOG_PREFIX} Daemon stopped`);
  };

  return {
    start,
    stop,
    send_message,
    notify_task_result,
    // Exposed for testing
    _handle_message: handle_message,
  };
};

export type TelegramBot = ReturnType<typeof create_telegram_bot>;
