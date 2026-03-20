// Grant notification module: connects grant crawl results to Notion + Telegram
// Formats GrantReport for Notion pages and deadline alerts for Telegram
// Uses NotificationRouter for routing — no direct API calls

import type { GrantReport, GrantMatchResult, DeadlineAlert } from './startup_grants.js';
import type { NotificationRouter } from '../notification/router.js';
import type { NotificationEvent } from '../shared/types.js';

// === Notion formatting ===

// Format a GrantReport as structured markdown for Notion page content.
// Groups grants by priority (high → medium → low), includes deadline alerts,
// and omits skip-priority grants from the main section.
export const format_grant_report_for_notion = (report: GrantReport): string => {
  const lines: string[] = [];
  const date = report.generated_at.slice(0, 10); // YYYY-MM-DD

  // Header
  lines.push(`# Grant Report — ${date}`);
  lines.push('');
  lines.push(`Total: ${report.total_grants} | New: ${report.new_grants}`);
  lines.push(`Summary: ${report.summary}`);
  lines.push('');

  // Deadline alerts section (if any)
  if (report.deadline_alerts.length > 0) {
    lines.push('## Deadline Alerts');
    lines.push('');
    for (const alert of report.deadline_alerts) {
      const emoji = alert.alert_level === 'D-1' ? '🔴'
        : alert.alert_level === 'D-3' ? '🟠'
        : alert.alert_level === 'overdue' ? '⚫'
        : '🟡';
      lines.push(`${emoji} **[${alert.alert_level}]** ${alert.grant.title} — 마감: ${alert.grant.deadline ?? 'N/A'} (${alert.days_remaining}일 남음)`);
    }
    lines.push('');
  }

  // Group matches by priority (excluding skip)
  const by_priority = {
    high: report.matches.filter((m) => m.priority === 'high'),
    medium: report.matches.filter((m) => m.priority === 'medium'),
    low: report.matches.filter((m) => m.priority === 'low'),
    skip: report.matches.filter((m) => m.priority === 'skip'),
  };

  // High priority
  if (by_priority.high.length > 0) {
    lines.push('## High Priority');
    lines.push('');
    for (const match of by_priority.high) {
      lines.push(...format_match_block(match));
    }
  }

  // Medium priority
  if (by_priority.medium.length > 0) {
    lines.push('## Medium Priority');
    lines.push('');
    for (const match of by_priority.medium) {
      lines.push(...format_match_block(match));
    }
  }

  // Low priority
  if (by_priority.low.length > 0) {
    lines.push('## Low Priority');
    lines.push('');
    for (const match of by_priority.low) {
      lines.push(...format_match_block(match));
    }
  }

  // Skipped (collapsed, just titles)
  if (by_priority.skip.length > 0) {
    lines.push('## Skipped');
    lines.push('');
    for (const match of by_priority.skip) {
      const reasons = match.disqualify_reasons.join(', ');
      lines.push(`- ~~${match.grant.title}~~ — ${reasons}`);
    }
    lines.push('');
  }

  return lines.join('\n');
};

// Format a single match block for Notion
const format_match_block = (match: GrantMatchResult): string[] => {
  const g = match.grant;
  const lines: string[] = [];

  lines.push(`### ${g.title}`);
  lines.push(`- Organization: ${g.organization}`);
  lines.push(`- Deadline: ${g.deadline ?? 'N/A'}`);
  lines.push(`- Category: ${g.category}`);
  if (g.url) lines.push(`- URL: ${g.url}`);
  if (match.match_reasons.length > 0) {
    lines.push(`- Match reasons: ${match.match_reasons.join(', ')}`);
  }
  lines.push('');

  return lines;
};

// === Telegram formatting ===

// Format deadline alerts as concise Telegram messages.
// Only D-1 and D-3 alerts are included (urgent ones).
// Sorted by urgency (most urgent first).
export const format_deadline_alerts_for_telegram = (alerts: DeadlineAlert[]): string => {
  if (alerts.length === 0) return '';

  // Sort by urgency (fewest days remaining first)
  const sorted = [...alerts].sort((a, b) => a.days_remaining - b.days_remaining);

  const lines: string[] = [];
  lines.push('🚨 창업지원사업 마감 임박');
  lines.push('');

  for (const alert of sorted) {
    const emoji = alert.alert_level === 'D-1' ? '🔴' : alert.alert_level === 'D-3' ? '🟠' : '🟡';
    lines.push(`${emoji} [${alert.alert_level}] ${alert.grant.title}`);
    lines.push(`   마감: ${alert.grant.deadline ?? 'N/A'} (${alert.days_remaining}일 남음)`);
    if (alert.grant.url) {
      lines.push(`   ${alert.grant.url}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
};

// === Alert decision logic ===

// Returns true if any alerts have D-1 or D-3 urgency.
// These are the only levels that warrant a Telegram push notification.
// D-7 is informational (Notion/Slack only), overdue is too late for action.
export const should_send_telegram_alert = (alerts: DeadlineAlert[]): boolean => {
  return alerts.some((a) => a.alert_level === 'D-1' || a.alert_level === 'D-3');
};

// === Notification handler factory ===

export type GrantNotifierDeps = {
  router: NotificationRouter;
};

// Creates a handler function that takes a GrantReport and routes notifications:
// 1. Always: crawl_result → Notion (full formatted report) + Slack
// 2. Conditionally: alert → Telegram (only if D-1 or D-3 deadlines exist)
export const create_grant_notification_handler = (deps: GrantNotifierDeps) => {
  return async (report: GrantReport): Promise<void> => {
    // 1. Always send crawl_result with full Notion-formatted report
    const notion_content = format_grant_report_for_notion(report);
    const crawl_event: NotificationEvent = {
      type: 'crawl_result',
      message: notion_content,
      device: 'captain',
      severity: 'low',
      metadata: {
        total_grants: report.total_grants,
        new_grants: report.new_grants,
        high_priority_count: report.matches.filter((m) => m.priority === 'high').length,
        deadline_alert_count: report.deadline_alerts.length,
      },
    };
    await deps.router.route(crawl_event);

    // 2. Conditionally send Telegram alert for urgent deadlines
    if (should_send_telegram_alert(report.deadline_alerts)) {
      // Filter to only D-1 and D-3 for the Telegram message
      const urgent_alerts = report.deadline_alerts.filter(
        (a) => a.alert_level === 'D-1' || a.alert_level === 'D-3',
      );
      const telegram_message = format_deadline_alerts_for_telegram(urgent_alerts);

      const alert_event: NotificationEvent = {
        type: 'alert',
        message: telegram_message,
        device: 'captain',
        severity: 'high',
        metadata: {
          source: 'grant_notifier',
          urgent_count: urgent_alerts.length,
        },
      };
      await deps.router.route(alert_event);
    }
  };
};
