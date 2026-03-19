// Telegram inbound command handler for FAS Captain
// Receives commands from the user via Telegram long polling (getUpdates)
// and creates tasks via the TaskStore directly.
// Uses native fetch (Node 20+) to avoid conflicts with the existing
// node-telegram-bot-api outbound module which uses polling=false.

import type { TaskStore } from '../gateway/task_store.js';
import type { Task } from '../shared/types.js';

// === Configuration ===

export type TelegramCommandConfig = {
  bot_token: string;
  chat_id: string;
  poll_interval_ms?: number; // fallback delay between polls on error (default: 3000)
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

// === Constants ===

const LONG_POLL_TIMEOUT_S = 30;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const MAX_PENDING_DISPLAY = 10;

// === Factory ===

export const create_telegram_commands = (
  config: TelegramCommandConfig,
  store: TaskStore,
) => {
  let running = false;
  let last_update_id = 0;
  let abort_controller: AbortController | null = null;
  const poll_interval = config.poll_interval_ms ?? DEFAULT_POLL_INTERVAL_MS;
  const base_url = `https://api.telegram.org/bot${config.bot_token}`;

  // === Telegram API helpers ===

  /** Send a reply message to the configured chat */
  const reply = async (text: string): Promise<void> => {
    try {
      const res = await fetch(`${base_url}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.chat_id,
          text,
          parse_mode: 'Markdown',
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[TelegramCmd] sendMessage failed: ${res.status} ${body}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[TelegramCmd] sendMessage error: ${msg}`);
    }
  };

  // === Command handlers ===

  /** Create a hunter task with chatgpt_task action */
  const handle_hunter = async (description: string): Promise<void> => {
    const task = store.create({
      title: description.slice(0, 80),
      description,
      action: 'chatgpt_task',
      assigned_to: 'hunter',
      priority: 'medium',
      risk_level: 'low',
    });
    await reply(`*태스크 생성됨* (hunter)\n\`${task.id}\`\n${task.title}`);
  };

  /** Create a captain task */
  const handle_captain = async (description: string): Promise<void> => {
    const task = store.create({
      title: description.slice(0, 80),
      description,
      assigned_to: 'captain',
      priority: 'medium',
      risk_level: 'low',
    });
    await reply(`*태스크 생성됨* (captain)\n\`${task.id}\`\n${task.title}`);
  };

  /** Create a web_crawl task for hunter */
  const handle_crawl = async (url: string): Promise<void> => {
    const task = store.create({
      title: `웹 크롤링: ${url.slice(0, 60)}`,
      description: url,
      action: 'web_crawl',
      assigned_to: 'hunter',
      priority: 'medium',
      risk_level: 'low',
    });
    await reply(`*크롤링 태스크 생성됨*\n\`${task.id}\`\n${url}`);
  };

  /** Create a deep_research task for hunter */
  const handle_research = async (topic: string): Promise<void> => {
    const task = store.create({
      title: `리서치: ${topic.slice(0, 60)}`,
      description: topic,
      action: 'deep_research',
      assigned_to: 'hunter',
      priority: 'medium',
      risk_level: 'low',
    });
    await reply(`*리서치 태스크 생성됨*\n\`${task.id}\`\n${topic}`);
  };

  /** Reply with current task statistics */
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
    await reply(lines.join('\n'));
  };

  /** Reply with list of pending tasks (max 10) */
  const handle_tasks = async (): Promise<void> => {
    const pending = store.get_by_status('pending');
    if (pending.length === 0) {
      await reply('대기중인 태스크가 없습니다.');
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
    await reply(lines.join('\n'));
  };

  /** Cancel (block) a task by ID */
  const handle_cancel = async (task_id: string): Promise<void> => {
    const task = store.get_by_id(task_id);
    if (!task) {
      await reply(`태스크를 찾을 수 없습니다: \`${task_id}\``);
      return;
    }
    const success = store.block_task(task_id, 'Cancelled by user');
    if (success) {
      await reply(`태스크 취소됨: \`${task_id}\`\n${task.title}`);
    } else {
      await reply(`태스크 취소 실패: \`${task_id}\``);
    }
  };

  // === Message dispatcher ===

  /** Parse and dispatch a single message */
  const handle_message = async (text: string, chat_id: string): Promise<void> => {
    // Security: only accept messages from the configured chat
    if (chat_id !== config.chat_id) {
      console.warn(`[TelegramCmd] Rejected message from unauthorized chat: ${chat_id}`);
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;

    try {
      if (trimmed.startsWith('/hunter ')) {
        await handle_hunter(trimmed.slice('/hunter '.length).trim());
      } else if (trimmed.startsWith('/captain ')) {
        await handle_captain(trimmed.slice('/captain '.length).trim());
      } else if (trimmed.startsWith('/crawl ')) {
        await handle_crawl(trimmed.slice('/crawl '.length).trim());
      } else if (trimmed.startsWith('/research ')) {
        await handle_research(trimmed.slice('/research '.length).trim());
      } else if (trimmed === '/status') {
        await handle_status();
      } else if (trimmed === '/tasks') {
        await handle_tasks();
      } else if (trimmed.startsWith('/cancel ')) {
        await handle_cancel(trimmed.slice('/cancel '.length).trim());
      } else if (trimmed.startsWith('/')) {
        // Unknown command — ignore silently to avoid noise
        await reply(`알 수 없는 명령어: ${trimmed.split(' ')[0]}`);
      } else {
        // Default: non-command text → create hunter chatgpt_task
        await handle_hunter(trimmed);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[TelegramCmd] Error handling message: ${msg}`);
      await reply(`오류 발생: ${msg}`);
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

  /** Main polling loop — runs sequentially using setTimeout */
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
        console.error(`[TelegramCmd] Poll error: ${msg}`);
        // Wait before retrying on error
        await new Promise((r) => setTimeout(r, poll_interval));
      }
    }
  };

  // === Public API ===

  const start = () => {
    if (running) return;
    running = true;
    console.log('[TelegramCmd] Command listener started');
    // Fire-and-forget — poll_loop handles its own lifecycle
    poll_loop().catch((err) => {
      console.error('[TelegramCmd] Poll loop crashed:', err);
    });
  };

  const stop = () => {
    running = false;
    if (abort_controller) {
      abort_controller.abort();
      abort_controller = null;
    }
    console.log('[TelegramCmd] Command listener stopped');
  };

  return {
    start,
    stop,
    // Exposed for testing
    _handle_message: handle_message,
    _reply: reply,
  };
};

export type TelegramCommands = ReturnType<typeof create_telegram_commands>;
