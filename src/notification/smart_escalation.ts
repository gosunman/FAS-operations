// Smart Escalation — time-aware notification routing for high-value results
//
// Daytime (09:00~21:00): high-value results → Telegram alert immediately via discovery event
// Nighttime (21:00~09:00): high-value results → in-memory queue → flush at 09:00 morning briefing
//
// This module is OPTIONAL in result_router deps — if not provided, behavior is unchanged.
// The escalator does NOT replace normal Slack/Notion routing; it ADDS Telegram escalation
// for results that warrant the owner's immediate attention.

import type { NotificationRouter } from './router.js';
import type { NotificationEvent } from '../shared/types.js';

// === Types ===

export type EscalationSeverity = 'high' | 'medium';

export type EscalationItem = {
  title: string;
  summary: string;
  severity: EscalationSeverity;
  queued_at: string; // ISO 8601
};

export type SmartEscalatorConfig = {
  router: NotificationRouter;
  quiet_start?: number; // hour when quiet mode begins (default: 21)
  quiet_end?: number;   // hour when quiet mode ends (default: 9)
};

export type FlushResult = {
  flushed_count: number;
  error?: string;
};

export type SmartEscalator = {
  escalate: (title: string, summary: string, severity: EscalationSeverity, now?: Date) => Promise<void>;
  flush_morning_briefing: () => Promise<FlushResult>;
  get_queued_count: () => number;
  get_queued_items: () => EscalationItem[];
};

// === Quiet hour check ===

// Determines if the given time is in the quiet window.
// For quiet_start=21, quiet_end=9: 21:00 <= t < 09:00 is quiet (wraps midnight).
const is_quiet_hour = (hour: number, minute: number, quiet_start: number, quiet_end: number): boolean => {
  const t = hour * 60 + minute;
  const start = quiet_start * 60;
  const end = quiet_end * 60;

  if (start > end) {
    // Wraps midnight: e.g. 21:00 ~ 09:00
    // Quiet if t >= start OR t < end
    return t >= start || t < end;
  }
  // Same-day range (unusual but handled)
  return t >= start && t < end;
};

// === Factory ===

export const create_smart_escalator = (config: SmartEscalatorConfig): SmartEscalator => {
  const { router, quiet_start = 21, quiet_end = 9 } = config;

  // In-memory queue for nighttime escalations
  const queue: EscalationItem[] = [];

  // Format a single item for immediate Telegram push
  const format_immediate_message = (title: string, summary: string, severity: EscalationSeverity): string => {
    const severity_icon = severity === 'high' ? '🔴' : '🟡';
    return `${severity_icon} [Smart Alert] ${title}\n\n${summary}`;
  };

  // Escalate a high-value result — either send immediately or queue for morning
  const escalate = async (
    title: string,
    summary: string,
    severity: EscalationSeverity,
    now: Date = new Date(),
  ): Promise<void> => {
    const hour = now.getHours();
    const minute = now.getMinutes();

    if (is_quiet_hour(hour, minute, quiet_start, quiet_end)) {
      // Nighttime: queue for morning briefing
      queue.push({
        title,
        summary,
        severity,
        queued_at: now.toISOString(),
      });
      return;
    }

    // Daytime: send Telegram immediately via discovery event type
    const event: NotificationEvent = {
      type: 'discovery',
      message: format_immediate_message(title, summary, severity),
      device: 'captain',
      severity,
    };
    await router.route(event);
  };

  // Flush all queued items as a morning briefing summary
  const flush_morning_briefing = async (): Promise<FlushResult> => {
    if (queue.length === 0) {
      return { flushed_count: 0 };
    }

    // Take snapshot and clear queue immediately (prevent double-flush)
    const items = [...queue];
    const count = items.length;
    queue.length = 0;

    try {
      // Build Telegram summary (concise, one message)
      const high_count = items.filter((i) => i.severity === 'high').length;
      const medium_count = items.filter((i) => i.severity === 'medium').length;
      const severity_line = [
        high_count > 0 ? `🔴 ${high_count} high` : '',
        medium_count > 0 ? `🟡 ${medium_count} medium` : '',
      ].filter(Boolean).join(' | ');

      const item_lines = items.map((item) => {
        const icon = item.severity === 'high' ? '🔴' : '🟡';
        return `${icon} ${item.title}\n  ${item.summary}`;
      }).join('\n\n');

      const telegram_msg = [
        `[Morning Escalation Briefing] 야간 ${count}건 알림`,
        `(${severity_line})`,
        '',
        item_lines,
      ].join('\n');

      // Send Telegram summary (discovery type for Telegram delivery)
      const telegram_event: NotificationEvent = {
        type: 'discovery',
        message: telegram_msg,
        device: 'captain',
        severity: high_count > 0 ? 'high' : 'mid',
      };
      await router.route(telegram_event);

      // Send Slack detail (briefing type for #fas-general)
      const detail_lines = items.map((item) => {
        const icon = item.severity === 'high' ? '🔴' : '🟡';
        return `${icon} *${item.title}*\n${item.summary}\n_queued: ${item.queued_at}_`;
      }).join('\n\n');

      const slack_event: NotificationEvent = {
        type: 'briefing',
        message: `[Morning Escalation Detail] 야간 ${count}건\n\n${detail_lines}`,
        device: 'captain',
        severity: 'low',
      };
      await router.route(slack_event);

      return { flushed_count: count };
    } catch (err) {
      // Queue already cleared — log error but don't re-queue (prevents infinite retry)
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SmartEscalation] Flush failed: ${msg}`);
      return { flushed_count: count, error: msg };
    }
  };

  // Get current queue size (for monitoring dashboards)
  const get_queued_count = (): number => queue.length;

  // Get copy of queued items (for inspection / debugging)
  const get_queued_items = (): EscalationItem[] => [...queue];

  return {
    escalate,
    flush_morning_briefing,
    get_queued_count,
    get_queued_items,
  };
};
