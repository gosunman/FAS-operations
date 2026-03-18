// FAS Output Watcher
// Monitors tmux session output for predefined patterns
// and routes them to Telegram/Slack notifications.
//
// Patterns detected:
//   [APPROVAL_NEEDED] → Telegram urgent
//   [BLOCKED]         → Telegram urgent
//   [LOGIN_REQUIRED]  → Telegram urgent (hunter Google login expiry)
//   [GEMINI_BLOCKED]  → Telegram alert (Gemini CLI crashed after retries)
//   [MILESTONE]       → Slack #fas-general
//   [DONE]            → Slack #captain-logs
//   [ERROR]           → Slack #alerts

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { create_telegram_client, type TelegramClient } from '../notification/telegram.js';
import { create_slack_client, type SlackClient } from '../notification/slack.js';
import { create_notification_router, type NotificationRouter } from '../notification/router.js';
import type { NotificationEventType } from '../shared/types.js';

// === Pattern definitions ===

export type PatternMatch = {
  pattern_name: string;
  full_match: string;
  description: string;
  timestamp: string;
  session: string;
};

type WatchPattern = {
  name: string;
  regex: RegExp;
  // extract description from the match
  extract: (match: RegExpMatchArray) => string;
};

const WATCH_PATTERNS: WatchPattern[] = [
  {
    name: 'APPROVAL_NEEDED',
    regex: /\[APPROVAL_NEEDED\]\s*(.*)/,
    extract: (m) => m[1]?.trim() ?? '',
  },
  {
    name: 'BLOCKED',
    regex: /\[BLOCKED\]\s*(.*)/,
    extract: (m) => m[1]?.trim() ?? '',
  },
  {
    name: 'MILESTONE',
    regex: /\[MILESTONE\]\s*(.*)/,
    extract: (m) => m[1]?.trim() ?? '',
  },
  {
    name: 'DONE',
    regex: /\[DONE\]\s*(.*)/,
    extract: (m) => m[1]?.trim() ?? '',
  },
  {
    name: 'ERROR',
    regex: /\[ERROR\]\s*(.*)/,
    extract: (m) => m[1]?.trim() ?? '',
  },
  // Hunter reports Google login session expired — needs manual re-auth
  {
    name: 'LOGIN_REQUIRED',
    regex: /\[LOGIN_REQUIRED\]\s*(.*)/,
    extract: (m) => m[1]?.trim() ?? '',
  },
  // Gemini CLI crashed after max retries — session needs attention
  {
    name: 'GEMINI_BLOCKED',
    regex: /\[GEMINI_BLOCKED\]\s*(.*)/,
    extract: (m) => m[1]?.trim() ?? '',
  },
];

// === Line scanner (pure function, testable) ===

export const scan_line = (line: string, session: string): PatternMatch | null => {
  for (const pattern of WATCH_PATTERNS) {
    const match = line.match(pattern.regex);
    if (match) {
      return {
        pattern_name: pattern.name,
        full_match: match[0],
        description: pattern.extract(match),
        timestamp: new Date().toISOString(),
        session,
      };
    }
  }
  return null;
};

// === Watcher class ===

export type WatcherConfig = {
  sessions: string[];           // tmux session names to watch
  poll_interval_ms?: number;    // how often to capture output (default: 2000)
  on_match: (match: PatternMatch) => void | Promise<void>;
  on_crash?: (session: string, consecutive_failures: number) => void | Promise<void>;
  crash_threshold?: number;     // consecutive failures before on_crash fires (default: 3)
};

export class OutputWatcher extends EventEmitter {
  private config: WatcherConfig;
  private running = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  // Track last captured content per session to detect new lines
  private last_content: Map<string, string> = new Map();
  // Track consecutive capture failures per session for crash detection
  private crash_counts: Map<string, number> = new Map();

  constructor(config: WatcherConfig) {
    super();
    this.config = config;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    for (const session of this.config.sessions) {
      const timer = setInterval(
        () => this.capture_session(session),
        this.config.poll_interval_ms ?? 2000,
      );
      this.timers.push(timer);
    }

    this.emit('started', this.config.sessions);
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
    this.last_content.clear();
    this.emit('stopped');
  }

  is_running(): boolean {
    return this.running;
  }

  // Capture recent output from a tmux session pane
  private async capture_session(session: string): Promise<void> {
    try {
      const output = await this.tmux_capture_pane(session);
      const previous = this.last_content.get(session) ?? '';

      if (output === previous) return; // no new content

      // Find new lines by comparing with previous content
      const new_lines = this.extract_new_lines(previous, output);
      this.last_content.set(session, output);

      // Scan each new line for patterns
      for (const line of new_lines) {
        const match = scan_line(line, session);
        if (match) {
          this.emit('match', match);
          await this.config.on_match(match);
        }
      }

      // Reset crash counter on successful capture
      this.crash_counts.set(session, 0);
    } catch {
      // Track consecutive failures for crash detection
      const count = (this.crash_counts.get(session) ?? 0) + 1;
      this.crash_counts.set(session, count);
      const threshold = this.config.crash_threshold ?? 3;
      // Fire on_crash at threshold (first detection), then repeat every ~5 min
      // to avoid flooding Telegram with alerts every 2 seconds
      const CRASH_REPEAT_INTERVAL = 150; // ~5 min at 2s poll interval
      const should_report = count === threshold
        || (count > threshold && (count - threshold) % CRASH_REPEAT_INTERVAL === 0);
      if (should_report && this.config.on_crash) {
        this.emit('crash', session, count);
        await this.config.on_crash(session, count);
      }
    }
  }

  // Extract lines that are in new_content but not in old_content
  private extract_new_lines(old_content: string, new_content: string): string[] {
    const old_lines = old_content.split('\n');
    const new_lines = new_content.split('\n');

    // Find where old content ends in new content
    if (old_lines.length === 0) return new_lines;

    // Simple approach: return lines after the old content length
    const start_index = old_lines.length > 0 ? old_lines.length - 1 : 0;
    return new_lines.slice(start_index).filter((l) => l.trim().length > 0);
  }

  // Run tmux capture-pane and return output
  private tmux_capture_pane(session: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('tmux', [
        'capture-pane', '-t', session, '-p', '-S', '-50',
      ]);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`tmux capture-pane failed: ${stderr}`));
        }
      });
    });
  }
}

// === Pattern → NotificationEventType mapping ===

const PATTERN_EVENT_MAP: Record<string, NotificationEventType> = {
  APPROVAL_NEEDED: 'approval_high',
  BLOCKED: 'blocked',
  MILESTONE: 'milestone',
  DONE: 'done',
  ERROR: 'error',
  LOGIN_REQUIRED: 'alert',
  GEMINI_BLOCKED: 'alert',
};

const map_pattern_to_event = (pattern_name: string): NotificationEventType =>
  PATTERN_EVENT_MAP[pattern_name] ?? 'agent_log';

// === Build notification clients from env vars (graceful fallback) ===

export const create_watcher_router = (): NotificationRouter | null => {
  let telegram: TelegramClient | null = null;
  let slack: SlackClient | null = null;

  const telegram_token = process.env.TELEGRAM_BOT_TOKEN;
  const telegram_chat_id = process.env.TELEGRAM_CHAT_ID;
  if (telegram_token && telegram_chat_id) {
    telegram = create_telegram_client({ token: telegram_token, chat_id: telegram_chat_id });
    console.log('[Watcher] Telegram client initialized');
  } else {
    console.warn('[Watcher] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — Telegram notifications disabled');
  }

  const slack_token = process.env.SLACK_BOT_TOKEN;
  if (slack_token) {
    slack = create_slack_client({ token: slack_token });
    console.log('[Watcher] Slack client initialized');
  } else {
    console.warn('[Watcher] SLACK_BOT_TOKEN not set — Slack notifications disabled');
  }

  // If neither client is available, return null
  if (!telegram && !slack) {
    console.warn('[Watcher] No notification clients available — running in log-only mode');
    return null;
  }

  return create_notification_router({ telegram, slack });
};

// === Create a watcher with notification routing ===

export const create_routed_watcher = (
  sessions: string[],
  router: NotificationRouter | null,
  poll_interval_ms = 2000,
): OutputWatcher => {
  return new OutputWatcher({
    sessions,
    poll_interval_ms,
    on_match: async (match) => {
      console.log(`[Watcher] Pattern detected: [${match.pattern_name}] ${match.description} (session: ${match.session})`);

      if (router) {
        const event_type = map_pattern_to_event(match.pattern_name);
        const message = `[${match.pattern_name}] ${match.description}\n(session: ${match.session}, ${match.timestamp})`;
        try {
          await router.route({
            type: event_type,
            message,
            device: 'captain',
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Watcher] Failed to route notification: ${msg}`);
        }
      }
    },
    on_crash: async (session, count) => {
      console.error(`[Watcher] Session "${session}" crashed (${count} consecutive failures)`);
      if (router) {
        try {
          await router.route({
            type: 'alert',
            message: `[CRASH] tmux session "${session}" unreachable (${count} consecutive failures)`,
            device: 'captain',
          });
        } catch {
          // Fire-and-forget — don't let crash reporting crash the watcher
        }
      }
    },
  });
};

// === Main entry point ===

const is_main = import.meta.url === `file://${process.argv[1]}`;

if (is_main) {
  const WATCHED_SESSIONS = [
    'fas-claude',
    'fas-gemini-a',
    'fas-gateway',
  ];

  console.log(`[Watcher] Starting output watcher for sessions: ${WATCHED_SESSIONS.join(', ')}`);

  const router = create_watcher_router();
  const watcher = create_routed_watcher(WATCHED_SESSIONS, router);
  watcher.start();

  process.on('SIGINT', () => {
    console.log('[Watcher] Shutting down...');
    watcher.stop();
    process.exit(0);
  });
}
