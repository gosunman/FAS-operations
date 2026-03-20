// Housing notification module: connects housing crawl results to Notion + Telegram
// Formats HousingReport for Notion pages and deadline alerts for Telegram
// Uses NotificationRouter for routing — no direct API calls

import type { HousingReport, HousingMatchResult } from './housing_lottery.js';
import type { NotificationRouter } from '../notification/router.js';
import type { NotificationEvent } from '../shared/types.js';

// === Types ===

// Deadline alert from HousingReport (mirrors the shape in housing_lottery.ts)
export type HousingDeadlineAlert = HousingReport['deadline_alerts'][number];

// === Notion formatting ===

// Format a HousingReport as structured markdown for Notion page content.
// Groups announcements by priority (residence → investment → skip),
// includes deadline alerts, and collapses skip-priority announcements.
export const format_housing_report_for_notion = (report: HousingReport): string => {
  const lines: string[] = [];
  const date = report.generated_at.slice(0, 10); // YYYY-MM-DD

  // Header
  lines.push(`# Housing Report — ${date}`);
  lines.push('');
  lines.push(`Total: ${report.total_announcements} | New: ${report.new_announcements}`);
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
      lines.push(`${emoji} **[${alert.alert_level}]** ${alert.announcement.title} — 마감: ${alert.announcement.deadline ?? 'N/A'} (${alert.days_remaining}일 남음)`);
    }
    lines.push('');
  }

  // Group matches by priority
  const by_priority = {
    residence: report.matches.filter((m) => m.priority === 'residence'),
    investment: report.matches.filter((m) => m.priority === 'investment'),
    skip: report.matches.filter((m) => m.priority === 'skip'),
  };

  // Residence priority (거주용 — most important)
  if (by_priority.residence.length > 0) {
    lines.push('## Residence (거주용)');
    lines.push('');
    for (const match of by_priority.residence) {
      lines.push(...format_match_block(match));
    }
  }

  // Investment priority (수익형)
  if (by_priority.investment.length > 0) {
    lines.push('## Investment (수익형)');
    lines.push('');
    for (const match of by_priority.investment) {
      lines.push(...format_match_block(match));
    }
  }

  // Skipped (collapsed, just titles with reasons)
  if (by_priority.skip.length > 0) {
    lines.push('## Skipped');
    lines.push('');
    for (const match of by_priority.skip) {
      const reasons = match.disqualify_reasons.join(', ');
      lines.push(`- ~~${match.announcement.title}~~ — ${reasons}`);
    }
    lines.push('');
  }

  return lines.join('\n');
};

// Format a single match block for Notion
const format_match_block = (match: HousingMatchResult): string[] => {
  const a = match.announcement;
  const lines: string[] = [];

  lines.push(`### ${a.title}`);
  lines.push(`- Location: ${a.location}`);
  lines.push(`- Size: ${a.size_sqm}㎡`);
  lines.push(`- Deadline: ${a.deadline ?? 'N/A'}`);
  lines.push(`- Type: ${a.announcement_type}`);
  if (a.url) lines.push(`- URL: ${a.url}`);
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
export const format_deadline_alerts_for_telegram = (alerts: HousingDeadlineAlert[]): string => {
  if (alerts.length === 0) return '';

  // Sort by urgency (fewest days remaining first)
  const sorted = [...alerts].sort((a, b) => a.days_remaining - b.days_remaining);

  const lines: string[] = [];
  lines.push('🏠 청약 마감 임박');
  lines.push('');

  for (const alert of sorted) {
    const emoji = alert.alert_level === 'D-1' ? '🔴' : alert.alert_level === 'D-3' ? '🟠' : '🟡';
    lines.push(`${emoji} [${alert.alert_level}] ${alert.announcement.title}`);
    lines.push(`   마감: ${alert.announcement.deadline ?? 'N/A'} (${alert.days_remaining}일 남음)`);
    lines.push(`   위치: ${alert.announcement.location} | ${alert.announcement.size_sqm}㎡`);
    if (alert.announcement.url) {
      lines.push(`   ${alert.announcement.url}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
};

// === Alert decision logic ===

// Returns true if any alerts have D-1 or D-3 urgency.
// These are the only levels that warrant a Telegram push notification.
// D-7 is informational (Notion/Slack only), overdue is too late for action.
export const should_send_telegram_alert = (alerts: HousingDeadlineAlert[]): boolean => {
  return alerts.some((a) => a.alert_level === 'D-1' || a.alert_level === 'D-3');
};

// === Notification handler factory ===

export type HousingNotifierDeps = {
  router: NotificationRouter;
};

// Creates a handler function that takes a HousingReport and routes notifications:
// 1. Always: crawl_result → Notion (full formatted report) + Slack
// 2. Conditionally: alert → Telegram (only if D-1 or D-3 deadlines exist)
export const create_housing_notification_handler = (deps: HousingNotifierDeps) => {
  return async (report: HousingReport): Promise<void> => {
    // 1. Always send crawl_result with full Notion-formatted report
    const notion_content = format_housing_report_for_notion(report);
    const crawl_event: NotificationEvent = {
      type: 'crawl_result',
      message: notion_content,
      device: 'captain',
      severity: 'low',
      metadata: {
        total_announcements: report.total_announcements,
        new_announcements: report.new_announcements,
        residence_count: report.matches.filter((m) => m.priority === 'residence').length,
        investment_count: report.matches.filter((m) => m.priority === 'investment').length,
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
          source: 'housing_notifier',
          urgent_count: urgent_alerts.length,
        },
      };
      await deps.router.route(alert_event);
    }
  };
};
