// Alert Integration — Bridge between file_logger/crash_recovery and notification router
// Sends alerts to appropriate channels based on severity.
//
// Design: Wrapper/bridge pattern — does NOT modify existing file_logger or crash_recovery.
// Enhanced instances delegate to originals and also fire notifications via the router.
// All notification dispatches are fire-and-forget (async, never block the caller).

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FileLogger, LogLevel } from './file_logger.js';
import type { CrashMonitor, CrashRecord } from './crash_recovery.js';
import type { NotificationRouter } from '../notification/router.js';
import type { NotificationEvent, DeviceName } from '../shared/types.js';

// === Configuration ===

export type AlertBridgeConfig = {
  slack_error_threshold: LogLevel;     // default: 'error' — send to Slack for error+
  telegram_threshold: LogLevel;         // default: 'critical' — send to Telegram for critical
  crash_telegram_on_isolation: boolean; // default: true — Telegram when agent isolated
};

const DEFAULT_CONFIG: AlertBridgeConfig = {
  slack_error_threshold: 'error',
  telegram_threshold: 'critical',
  crash_telegram_on_isolation: true,
};

// === Log level severity ordering ===

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  critical: 4,
};

// === Helpers ===

// Map agent name to DeviceName for notification routing
const agent_to_device = (agent: string): DeviceName => {
  if (agent === 'hunter') return 'hunter';
  return 'captain'; // captain, gemini_a, openclaw, watchdog, gateway → all captain device
};

// Fire-and-forget async notification — never throws, never blocks
const safe_route = (router: NotificationRouter, event: NotificationEvent): void => {
  // Intentionally not awaited — fire-and-forget
  router.route(event).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AlertBridge] Failed to route notification: ${msg}`);
  });
};

// === Log Alert Bridge ===
// Wraps a FileLogger to also send Slack/Telegram notifications for error/critical logs.

export type LogAlertBridgeDeps = {
  logger: FileLogger;
  router: NotificationRouter;
  config?: Partial<AlertBridgeConfig>;
};

export const create_log_alert_bridge = (deps: LogAlertBridgeDeps): FileLogger => {
  const cfg: AlertBridgeConfig = { ...DEFAULT_CONFIG, ...deps.config };

  const log = (agent: string, level: LogLevel, message: string): void => {
    // Always delegate to the underlying logger first
    deps.logger.log(agent, level, message);

    const severity_num = LOG_LEVEL_SEVERITY[level];
    const slack_threshold_num = LOG_LEVEL_SEVERITY[cfg.slack_error_threshold];
    const telegram_threshold_num = LOG_LEVEL_SEVERITY[cfg.telegram_threshold];

    // Check if this log level meets the notification threshold
    if (severity_num < slack_threshold_num) {
      return; // Below threshold — no notification
    }

    // Determine notification type and severity based on log level
    const is_critical = severity_num >= telegram_threshold_num;

    const event: NotificationEvent = {
      // 'error' type routes to Telegram in the routing matrix; 'alert' routes to Slack #alerts
      type: is_critical ? 'error' : 'alert',
      severity: is_critical ? 'critical' : 'high',
      message: `[${level.toUpperCase()}] ${agent}: ${message}`,
      device: agent_to_device(agent),
      metadata: {
        source: 'file_logger',
        log_level: level,
        agent,
      },
    };

    safe_route(deps.router, event);
  };

  // log_approval is passed through unchanged — no notifications for approvals
  const log_approval = deps.logger.log_approval;

  return { log, log_approval };
};

// === Crash Alert Bridge ===
// Wraps a CrashMonitor to send Slack warnings on crashes and Telegram alerts on isolation.

export type CrashAlertBridgeDeps = {
  monitor: CrashMonitor;
  router: NotificationRouter;
  config?: Partial<AlertBridgeConfig>;
};

export const create_crash_alert_bridge = (deps: CrashAlertBridgeDeps): CrashMonitor => {
  const cfg: AlertBridgeConfig = { ...DEFAULT_CONFIG, ...deps.config };

  const record_crash = (agent: string, error_message: string): CrashRecord => {
    // Delegate to the underlying monitor first
    const record = deps.monitor.record_crash(agent, error_message);

    // Send crash warning notification (Slack #alerts)
    const crash_event: NotificationEvent = {
      type: 'alert',
      severity: 'high',
      message: `[crash] ${agent}: ${error_message} (attempt #${record.restart_attempt})`,
      device: agent_to_device(agent),
      metadata: {
        source: 'crash_recovery',
        agent,
        restart_attempt: record.restart_attempt,
        crashed_at: record.crashed_at,
      },
    };
    safe_route(deps.router, crash_event);

    // Check if agent is now isolated (max_restarts reached)
    const can_restart = deps.monitor.should_restart(agent);
    if (!can_restart && cfg.crash_telegram_on_isolation) {
      // Send critical isolation alert (routes to Telegram via 'error' type)
      const isolation_event: NotificationEvent = {
        type: 'error',
        severity: 'critical',
        message: `[ISOLATED] ${agent} has been isolated after ${record.restart_attempt} crashes. Last error: ${error_message}. Manual intervention required.`,
        device: agent_to_device(agent),
        metadata: {
          source: 'crash_recovery',
          agent,
          restart_attempt: record.restart_attempt,
          isolated: true,
        },
      };
      safe_route(deps.router, isolation_event);
    }

    return record;
  };

  // Pass-through methods — no additional notifications needed
  const should_restart = deps.monitor.should_restart;
  const get_crash_history = deps.monitor.get_crash_history;
  const reset = deps.monitor.reset;

  return { record_crash, should_restart, get_crash_history, reset };
};

// === Daily Log Summary ===
// Generates a summary of all agent logs for a given date.
// Used for the morning briefing.

export type AgentLogCounts = {
  debug: number;
  info: number;
  warn: number;
  error: number;
  critical: number;
  total: number;
};

export type DailyLogSummary = {
  date: string;
  agents: Record<string, AgentLogCounts>;
  total_entries: number;
  total_errors: number;
  total_critical: number;
  formatted_text: string;
};

// Parse a log line and extract its level
// Expected format: [YYYY-MM-DD HH:mm:ss] [{LEVEL}] {agent}: {message}
const parse_log_level = (line: string): LogLevel | null => {
  // Match the level token: ] [LEVEL] — after the timestamp bracket
  const match = line.match(/\]\s+\[(DEBUG|INFO|WARN|ERROR|CRITICAL)\]/i);
  if (!match) return null;

  const level_str = match[1].toLowerCase();
  if (['debug', 'info', 'warn', 'error', 'critical'].includes(level_str)) {
    return level_str as LogLevel;
  }
  return null;
};

export const create_daily_log_summary = (base_dir: string, date: string): DailyLogSummary => {
  const agents: Record<string, AgentLogCounts> = {};
  let total_entries = 0;
  let total_errors = 0;
  let total_critical = 0;

  // Read all agent directories
  let dir_entries: fs.Dirent[];
  try {
    dir_entries = fs.readdirSync(base_dir, { withFileTypes: true });
  } catch {
    // base_dir doesn't exist — return empty summary
    return {
      date,
      agents: {},
      total_entries: 0,
      total_errors: 0,
      total_critical: 0,
      formatted_text: format_summary(date, {}, 0, 0, 0),
    };
  }

  for (const entry of dir_entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'approvals') continue; // Skip approval logs

    const agent_name = entry.name;
    const log_file = path.join(base_dir, agent_name, `${date}.log`);

    if (!fs.existsSync(log_file)) continue;

    let content: string;
    try {
      content = fs.readFileSync(log_file, 'utf-8');
    } catch {
      continue;
    }

    const counts: AgentLogCounts = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      critical: 0,
      total: 0,
    };

    const lines = content.split('\n').filter(l => l.trim().length > 0);
    for (const line of lines) {
      const level = parse_log_level(line);
      if (!level) continue;

      counts[level] += 1;
      counts.total += 1;
      total_entries += 1;

      if (level === 'error') total_errors += 1;
      if (level === 'critical') total_critical += 1;
    }

    if (counts.total > 0) {
      agents[agent_name] = counts;
    }
  }

  return {
    date,
    agents,
    total_entries,
    total_errors,
    total_critical,
    formatted_text: format_summary(date, agents, total_entries, total_errors, total_critical),
  };
};

// Format the summary as a human-readable text block (for Slack briefing)
const format_summary = (
  date: string,
  agents: Record<string, AgentLogCounts>,
  total_entries: number,
  total_errors: number,
  total_critical: number,
): string => {
  const lines: string[] = [];
  lines.push(`=== Daily Log Summary: ${date} ===`);
  lines.push(`Total: ${total_entries} entries, ${total_errors} errors, ${total_critical} critical`);
  lines.push('');

  const agent_names = Object.keys(agents).sort();
  for (const name of agent_names) {
    const c = agents[name];
    lines.push(`[${name}] total=${c.total} | debug=${c.debug} info=${c.info} warn=${c.warn} error=${c.error} critical=${c.critical}`);
  }

  if (agent_names.length === 0) {
    lines.push('(no log entries found)');
  }

  return lines.join('\n');
};
