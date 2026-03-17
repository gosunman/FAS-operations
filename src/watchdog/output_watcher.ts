// FAS Output Watcher
// Monitors tmux session output for predefined patterns
// and routes them to Telegram/Slack notifications.
//
// Patterns detected:
//   [APPROVAL_NEEDED] → Telegram urgent
//   [BLOCKED]         → Telegram urgent
//   [MILESTONE]       → Slack #fas-general
//   [DONE]            → Slack #captain-logs
//   [ERROR]           → Slack #alerts

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

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
};

export class OutputWatcher extends EventEmitter {
  private config: WatcherConfig;
  private running = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  // Track last captured content per session to detect new lines
  private last_content: Map<string, string> = new Map();

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
    } catch {
      // Session might not exist yet, ignore errors silently
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

// === Main entry point ===

const is_main = import.meta.url === `file://${process.argv[1]}`;

if (is_main) {
  const WATCHED_SESSIONS = [
    'fas-claude',
    'fas-gemini-a',
    'fas-gemini-b',
    'fas-gateway',
  ];

  console.log(`[Watcher] Starting output watcher for sessions: ${WATCHED_SESSIONS.join(', ')}`);

  const watcher = new OutputWatcher({
    sessions: WATCHED_SESSIONS,
    poll_interval_ms: 2000,
    on_match: async (match) => {
      console.log(`[Watcher] Pattern detected: [${match.pattern_name}] ${match.description} (session: ${match.session})`);

      // TODO: integrate with notification router once env vars are configured
      // const router = create_notification_router({ telegram, slack });
      // await router.route({ type: map_pattern_to_event(match), ... });
    },
  });

  watcher.start();

  process.on('SIGINT', () => {
    console.log('[Watcher] Shutting down...');
    watcher.stop();
    process.exit(0);
  });
}
