// Activity Integration — thin hooks layer that connects ActivityLogger
// to FAS services (Gateway, NotificationRouter, TelegramCommands, HunterMonitor).
// Each hook is a simple function that logs a structured activity entry.
// All hooks are fire-and-forget (synchronous SQLite writes, never throw to callers).

import type { ActivityLogger } from './activity_logger.js';
import type { RiskLevel } from '../shared/types.js';

// === ActivityHooks — structured logging helpers for each event type ===

export type ActivityHooks = {
  /** Log a new task creation */
  log_task_created: (task_id: string, title: string, assigned_to: string, risk_level?: RiskLevel) => void;
  /** Log a task completion */
  log_task_completed: (task_id: string, title: string) => void;
  /** Log a task failure (blocked/timed out) */
  log_task_failed: (task_id: string, reason: string) => void;
  /** Log a hunter heartbeat received */
  log_hunter_heartbeat: () => void;
  /** Log a notification sent (or failed) */
  log_notification_sent: (channel: string, event_type: string, success: boolean, error?: string) => void;
  /** Log a telegram command received */
  log_telegram_command: (command: string, args: string) => void;
  /** Log an error */
  log_error: (agent: string, message: string, extra?: Record<string, unknown>) => void;
};

// === Factory function ===

export const create_activity_hooks = (logger: ActivityLogger): ActivityHooks => {
  // Wrap each call in try-catch so activity logging never crashes the caller
  const safe_log = (fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ActivityHooks] Failed to log activity: ${msg}`);
    }
  };

  const log_task_created = (task_id: string, title: string, assigned_to: string, risk_level: RiskLevel = 'low'): void => {
    safe_log(() => {
      logger.log_activity({
        agent: 'gateway',
        action: 'task_created',
        risk_level,
        details: { task_id, title, assigned_to },
      });
    });
  };

  const log_task_completed = (task_id: string, title: string): void => {
    safe_log(() => {
      logger.log_activity({
        agent: 'gateway',
        action: 'task_completed',
        risk_level: 'low',
        details: { task_id, title },
      });
    });
  };

  const log_task_failed = (task_id: string, reason: string): void => {
    safe_log(() => {
      logger.log_activity({
        agent: 'gateway',
        action: 'task_failed',
        risk_level: 'mid',
        details: { task_id, reason },
      });
    });
  };

  const log_hunter_heartbeat = (): void => {
    safe_log(() => {
      logger.log_activity({
        agent: 'hunter',
        action: 'hunter_heartbeat',
        risk_level: 'low',
      });
    });
  };

  const log_notification_sent = (channel: string, event_type: string, success: boolean, error?: string): void => {
    safe_log(() => {
      logger.log_activity({
        agent: 'gateway',
        action: 'notification_sent',
        risk_level: success ? 'low' : 'mid',
        details: {
          channel,
          event_type,
          success,
          ...(error ? { error } : {}),
        },
      });
    });
  };

  const log_telegram_command = (command: string, args: string): void => {
    safe_log(() => {
      logger.log_activity({
        agent: 'captain',
        action: 'telegram_command',
        risk_level: 'low',
        details: { command, args },
      });
    });
  };

  const log_error = (agent: string, message: string, extra?: Record<string, unknown>): void => {
    safe_log(() => {
      logger.log_activity({
        agent,
        action: 'error',
        risk_level: 'high',
        details: { message, ...(extra ?? {}) },
      });
    });
  };

  return {
    log_task_created,
    log_task_completed,
    log_task_failed,
    log_hunter_heartbeat,
    log_notification_sent,
    log_telegram_command,
    log_error,
  };
};
