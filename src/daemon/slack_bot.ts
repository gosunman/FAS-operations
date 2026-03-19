// Standalone Slack Bot Daemon for FAS
//
// Mirrors the Telegram bot pattern but uses Slack Web API polling.
// Provides thread-based context management:
//   - Owner sends message in the hunter channel -> new task + thread confirmation
//   - Hunter result arrives -> reply in the original task's thread
//   - Each task gets its own thread for clean context separation
//
// Natural language mode (shared with telegram_bot via infer_action):
//   URL detected -> web_crawl
//   Research keywords -> deep_research
//   Everything else -> chatgpt_task (default)
//
// Utility keyword commands:
//   "상태" / "status"     -> Task statistics
//   "목록" / "tasks"      -> List pending tasks
//   "취소 <id>" / "cancel <id>" -> Cancel a task
//
// Security:
//   - Only listens to a specific channel (SLACK_CHANNEL_ID)
//   - Ignores bot messages (prevents self-loop)
//   - Uses native fetch (Node 20+) for Slack Web API

import type { TaskStore } from '../gateway/task_store.js';
import { infer_action, type HunterAction, type BotSanitizer } from './telegram_bot.js';

// === Configuration ===

export type SlackBotConfig = {
  bot_token: string;           // Slack Bot Token (xoxb-...)
  channel_id: string;          // Channel ID to listen on
  poll_interval_ms?: number;   // Polling interval (default: 3000)
};

// === Slack API types (minimal subset) ===

type SlackMessage = {
  ts: string;
  text: string;
  user?: string;
  bot_id?: string;
  thread_ts?: string;
};

// === Constants ===

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const MAX_PENDING_DISPLAY = 10;
const MAX_SUMMARY_LENGTH = 3_000;
const LOG_PREFIX = '[SlackBot]';
const SLACK_API_BASE = 'https://slack.com/api';

// Action label mapping for user-friendly confirmation messages
const ACTION_LABELS: Record<HunterAction, string> = {
  web_crawl: 'web_crawl',
  deep_research: 'deep_research',
  chatgpt_task: 'chatgpt_task',
};

// Utility command patterns (keyword-based, not slash)
const STATUS_KEYWORDS = ['상태', 'status'];
const TASKS_KEYWORDS = ['목록', 'tasks'];
const CANCEL_PATTERN = /^(취소|cancel)\s+(.+)$/i;
const CANCEL_NO_ARG_PATTERN = /^(취소|cancel)$/i;

// URL detection regex — matches http/https URLs (shared logic with telegram_bot)
const URL_PATTERN = /https?:\/\/\S+/i;

// === Factory ===

export const create_slack_bot = (
  config: SlackBotConfig,
  store: TaskStore,
  sanitizer?: BotSanitizer,
) => {
  let running = false;
  let last_ts = '0'; // Track the latest message ts to avoid reprocessing
  let abort_controller: AbortController | null = null;
  const poll_interval = config.poll_interval_ms ?? DEFAULT_POLL_INTERVAL_MS;

  // Bidirectional mapping: task_id <-> slack thread_ts
  const task_to_thread = new Map<string, string>();
  const thread_to_task = new Map<string, string>();

  // === Slack API helpers ===

  /** Post a message to the configured channel, optionally in a thread */
  const send_message = async (text: string, thread_ts?: string): Promise<string | null> => {
    try {
      const body: Record<string, unknown> = {
        channel: config.channel_id,
        text,
      };
      if (thread_ts) {
        body.thread_ts = thread_ts;
      }

      const res = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.bot_token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        console.error(`${LOG_PREFIX} chat.postMessage HTTP error: ${res.status}`);
        return null;
      }

      const data = await res.json() as { ok: boolean; ts?: string; error?: string };
      if (!data.ok) {
        console.error(`${LOG_PREFIX} chat.postMessage API error: ${data.error}`);
        return null;
      }

      return data.ts ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} send_message error: ${msg}`);
      return null;
    }
  };

  // === Utility command handlers ===

  /** "상태"/"status" -> Reply with current task statistics */
  const handle_status = async (thread_ts: string): Promise<void> => {
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
    await send_message(lines.join('\n'), thread_ts);
  };

  /** "목록"/"tasks" -> Reply with list of pending tasks (max 10) */
  const handle_tasks = async (thread_ts: string): Promise<void> => {
    const pending = store.get_by_status('pending');
    if (pending.length === 0) {
      await send_message('대기중인 태스크가 없습니다.', thread_ts);
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
    await send_message(lines.join('\n'), thread_ts);
  };

  /** "취소 <id>"/"cancel <id>" -> Cancel (block) a task by ID */
  const handle_cancel = async (task_id: string, thread_ts: string): Promise<void> => {
    const task = store.get_by_id(task_id);
    if (!task) {
      await send_message(`태스크를 찾을 수 없습니다: \`${task_id}\``, thread_ts);
      return;
    }
    const success = store.block_task(task_id, 'Cancelled by owner via Slack');
    if (success) {
      await send_message(`태스크 취소됨: \`${task_id}\`\n${task.title}`, thread_ts);
    } else {
      await send_message(`태스크 취소 실패: \`${task_id}\``, thread_ts);
    }
  };

  // === Natural language task creation ===

  /** Convert a natural language message into a Hunter task */
  const handle_natural_message = async (text: string, thread_ts: string): Promise<void> => {
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
          thread_ts,
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

    // Store bidirectional mapping for thread-based context
    task_to_thread.set(task.id, thread_ts);
    thread_to_task.set(thread_ts, task.id);

    await send_message(
      `헌터에게 전달했습니다. (${ACTION_LABELS[action]})\n\`${task.id}\``,
      thread_ts,
    );

    // Notify owner about auto-masking
    if (has_warning_pii) {
      await send_message('⚠️ 일부 개인정보가 자동 마스킹되었습니다.', thread_ts);
    }
  };

  // === Message dispatcher ===

  /** Parse and dispatch a single Slack message */
  const handle_message = async (msg: {
    text: string;
    ts: string;
    user?: string;
    bot_id?: string;
    thread_ts?: string;
  }): Promise<void> => {
    // Ignore bot messages to prevent self-loop
    if (msg.bot_id) return;

    // Ignore thread replies (only handle top-level channel messages)
    if (msg.thread_ts && msg.thread_ts !== msg.ts) return;

    const trimmed = (msg.text ?? '').trim();
    if (!trimmed) return;

    // Use the message ts as the thread root
    const thread_ts = msg.ts;

    try {
      // Check for utility keyword commands
      const lower = trimmed.toLowerCase();

      if (STATUS_KEYWORDS.includes(lower)) {
        await handle_status(thread_ts);
        return;
      }

      if (TASKS_KEYWORDS.includes(lower)) {
        await handle_tasks(thread_ts);
        return;
      }

      // Cancel with argument
      const cancel_match = trimmed.match(CANCEL_PATTERN);
      if (cancel_match) {
        await handle_cancel(cancel_match[2].trim(), thread_ts);
        return;
      }

      // Cancel without argument
      if (CANCEL_NO_ARG_PATTERN.test(trimmed)) {
        await send_message('사용법: `취소 <task_id>` 또는 `cancel <task_id>`\ntask_id를 입력해주세요.', thread_ts);
        return;
      }

      // Natural language: create Hunter task automatically
      await handle_natural_message(trimmed, thread_ts);
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} Error handling message: ${error_msg}`);
      await send_message(`오류 발생: ${error_msg}`, thread_ts);
    }
  };

  // === Polling loop ===

  /** Fetch new messages from the Slack channel using conversations.history */
  const fetch_messages = async (): Promise<SlackMessage[]> => {
    abort_controller = new AbortController();

    const url = new URL(`${SLACK_API_BASE}/conversations.history`);
    url.searchParams.set('channel', config.channel_id);
    url.searchParams.set('oldest', last_ts);
    url.searchParams.set('limit', '100');

    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${config.bot_token}` },
      signal: abort_controller.signal,
    });

    if (!res.ok) {
      throw new Error(`conversations.history HTTP error: ${res.status}`);
    }

    const data = await res.json() as { ok: boolean; messages?: SlackMessage[]; error?: string };
    if (!data.ok) {
      throw new Error(`conversations.history API error: ${data.error}`);
    }

    return data.messages ?? [];
  };

  /** Main polling loop */
  const poll_loop = async (): Promise<void> => {
    while (running) {
      try {
        const messages = await fetch_messages();

        // Slack returns messages newest-first, process oldest-first
        const sorted = [...messages].sort((a, b) =>
          parseFloat(a.ts) - parseFloat(b.ts),
        );

        for (const msg of sorted) {
          // Skip messages at or before last_ts (oldest param is exclusive in theory,
          // but Slack sometimes returns the boundary message)
          if (parseFloat(msg.ts) <= parseFloat(last_ts)) continue;

          last_ts = msg.ts;
          await handle_message(msg);
        }

        // Wait between polls
        await new Promise((r) => setTimeout(r, poll_interval));
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          break;
        }
        const error_msg = err instanceof Error ? err.message : String(err);
        console.error(`${LOG_PREFIX} Poll error: ${error_msg}`);
        await new Promise((r) => setTimeout(r, poll_interval));
      }
    }
  };

  // === Result notification ===

  /** Notify the owner when a hunter task completes — reply in the original thread */
  const notify_task_result = async (
    task_id: string,
    title: string,
    summary: string,
  ): Promise<void> => {
    // Truncate long summaries to stay within Slack message limits
    const truncated = summary.length > MAX_SUMMARY_LENGTH
      ? summary.slice(0, MAX_SUMMARY_LENGTH) + '\n\n...(생략)'
      : summary;

    const lines = [
      '*태스크 완료*',
      '',
      `*${title}*`,
      `ID: \`${task_id}\``,
      '',
      truncated,
    ];

    // Try to reply in the original thread if mapping exists
    const thread_ts = task_to_thread.get(task_id);
    await send_message(lines.join('\n'), thread_ts);
  };

  // === Public API ===

  const start = () => {
    if (running) return;
    running = true;
    console.log(`${LOG_PREFIX} Daemon started — polling channel ${config.channel_id}`);
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
    _get_thread_ts: (task_id: string) => task_to_thread.get(task_id),
    _get_task_id: (thread_ts: string) => thread_to_task.get(thread_ts),
  };
};

export type SlackBot = ReturnType<typeof create_slack_bot>;
