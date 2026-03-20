import { describe, it, expect, vi } from 'vitest';
import {
  format_grant_report_for_notion,
  format_deadline_alerts_for_telegram,
  should_send_telegram_alert,
  create_grant_notification_handler,
} from './grant_notifier.js';
import type { GrantReport, GrantMatchResult, DeadlineAlert, GrantAnnouncement } from './startup_grants.js';
import type { NotificationRouter } from '../notification/router.js';

// === Test fixtures ===

const make_grant = (overrides: Partial<GrantAnnouncement> = {}): GrantAnnouncement => ({
  id: 'kstartup-001',
  title: '2026년 예비창업패키지 모집공고',
  organization: '창업진흥원',
  deadline: '2026-04-30',
  description: '2026.03.01 ~ 2026.04.30',
  url: 'https://www.k-startup.go.kr/board/view?no=12345',
  category: '창업지원',
  discovered_at: '2026-03-21T00:00:00.000Z',
  ...overrides,
});

const make_match = (overrides: Partial<GrantMatchResult> = {}): GrantMatchResult => ({
  grant: make_grant(),
  priority: 'high',
  match_reasons: ['Matches high-priority keyword: 창업', 'User is a startup founder'],
  disqualify_reasons: [],
  ...overrides,
});

const make_alert = (overrides: Partial<DeadlineAlert> = {}): DeadlineAlert => ({
  grant: make_grant(),
  days_remaining: 1,
  alert_level: 'D-1',
  ...overrides,
});

const make_report = (overrides: Partial<GrantReport> = {}): GrantReport => ({
  generated_at: '2026-03-21T09:00:00.000Z',
  total_grants: 3,
  new_grants: 2,
  matches: [
    make_match({ priority: 'high' }),
    make_match({
      grant: make_grant({ id: 'kstartup-002', title: 'AI 스타트업 사업화 지원', deadline: '2026-05-15' }),
      priority: 'medium',
      match_reasons: ['Matches keyword: 사업화'],
    }),
    make_match({
      grant: make_grant({ id: 'kstartup-003', title: '농촌 창업 지원사업', deadline: null }),
      priority: 'skip',
      match_reasons: [],
      disqualify_reasons: ['Contains disqualifying keyword: 농촌'],
    }),
  ],
  deadline_alerts: [
    make_alert({ alert_level: 'D-1', days_remaining: 1 }),
    make_alert({
      grant: make_grant({ id: 'kstartup-002', title: 'AI 스타트업 사업화 지원', deadline: '2026-05-15' }),
      alert_level: 'D-7',
      days_remaining: 5,
    }),
  ],
  summary: 'Total: 3 grants | High priority: 1 | Medium: 1 | Skipped: 1 | URGENT deadlines: 1',
  ...overrides,
});

// === format_grant_report_for_notion ===

describe('format_grant_report_for_notion', () => {
  it('should include report header with timestamp and summary', () => {
    const report = make_report();
    const result = format_grant_report_for_notion(report);

    expect(result).toContain('2026-03-21');
    expect(result).toContain('3'); // total grants
    expect(result).toContain('2'); // new grants
  });

  it('should list high-priority matches first', () => {
    const report = make_report();
    const result = format_grant_report_for_notion(report);

    // High priority grant should appear before medium
    const high_idx = result.indexOf('예비창업패키지');
    const medium_idx = result.indexOf('AI 스타트업 사업화');
    expect(high_idx).toBeGreaterThan(-1);
    expect(medium_idx).toBeGreaterThan(-1);
    expect(high_idx).toBeLessThan(medium_idx);
  });

  it('should include deadline information', () => {
    const report = make_report();
    const result = format_grant_report_for_notion(report);

    expect(result).toContain('2026-04-30');
    expect(result).toContain('D-1');
  });

  it('should include match reasons for non-skip grants', () => {
    const report = make_report();
    const result = format_grant_report_for_notion(report);

    expect(result).toContain('창업');
  });

  it('should exclude skip-priority grants from the main section', () => {
    const report = make_report();
    const result = format_grant_report_for_notion(report);

    // Skip grants should be in a separate section or omitted from main listing
    // The main section should not show the skip grant's title prominently
    const sections = result.split(/#{2,3}/);
    // Find the main grants section (not the skipped section)
    const high_section = sections.find((s) => s.includes('예비창업패키지'));
    expect(high_section).toBeDefined();
    expect(high_section).not.toContain('농촌 창업 지원사업');
  });

  it('should handle empty report gracefully', () => {
    const report = make_report({
      total_grants: 0,
      new_grants: 0,
      matches: [],
      deadline_alerts: [],
      summary: 'Total: 0 grants',
    });
    const result = format_grant_report_for_notion(report);

    expect(result).toContain('0');
    expect(result.length).toBeGreaterThan(0);
  });
});

// === format_deadline_alerts_for_telegram ===

describe('format_deadline_alerts_for_telegram', () => {
  it('should format D-1 alert with warning emoji', () => {
    const alerts = [make_alert({ alert_level: 'D-1', days_remaining: 1 })];
    const result = format_deadline_alerts_for_telegram(alerts);

    expect(result).toContain('D-1');
    expect(result).toContain('예비창업패키지');
  });

  it('should format D-3 alert', () => {
    const alerts = [make_alert({ alert_level: 'D-3', days_remaining: 3 })];
    const result = format_deadline_alerts_for_telegram(alerts);

    expect(result).toContain('D-3');
  });

  it('should format multiple alerts sorted by urgency', () => {
    const alerts = [
      make_alert({ alert_level: 'D-3', days_remaining: 3 }),
      make_alert({
        grant: make_grant({ id: 'kstartup-002', title: 'AI 지원사업' }),
        alert_level: 'D-1',
        days_remaining: 1,
      }),
    ];
    const result = format_deadline_alerts_for_telegram(alerts);

    // D-1 should appear before D-3
    const d1_idx = result.indexOf('D-1');
    const d3_idx = result.indexOf('D-3');
    expect(d1_idx).toBeLessThan(d3_idx);
  });

  it('should include grant URL when available', () => {
    const alerts = [make_alert()];
    const result = format_deadline_alerts_for_telegram(alerts);

    expect(result).toContain('k-startup.go.kr');
  });

  it('should return empty string for empty alerts', () => {
    const result = format_deadline_alerts_for_telegram([]);
    expect(result).toBe('');
  });
});

// === should_send_telegram_alert ===

describe('should_send_telegram_alert', () => {
  it('should return true for D-1 alerts', () => {
    const alerts = [make_alert({ alert_level: 'D-1', days_remaining: 1 })];
    expect(should_send_telegram_alert(alerts)).toBe(true);
  });

  it('should return true for D-3 alerts', () => {
    const alerts = [make_alert({ alert_level: 'D-3', days_remaining: 3 })];
    expect(should_send_telegram_alert(alerts)).toBe(true);
  });

  it('should return false for only D-7 alerts', () => {
    const alerts = [make_alert({ alert_level: 'D-7', days_remaining: 7 })];
    expect(should_send_telegram_alert(alerts)).toBe(false);
  });

  it('should return false for only overdue alerts', () => {
    const alerts = [make_alert({ alert_level: 'overdue', days_remaining: -2 })];
    expect(should_send_telegram_alert(alerts)).toBe(false);
  });

  it('should return true if mixed alerts include D-1 or D-3', () => {
    const alerts = [
      make_alert({ alert_level: 'D-7', days_remaining: 7 }),
      make_alert({ alert_level: 'D-3', days_remaining: 3 }),
    ];
    expect(should_send_telegram_alert(alerts)).toBe(true);
  });

  it('should return false for empty alerts', () => {
    expect(should_send_telegram_alert([])).toBe(false);
  });
});

// === create_grant_notification_handler ===

describe('create_grant_notification_handler', () => {
  const make_mock_router = () => ({
    route: vi.fn().mockResolvedValue({ telegram: true, slack: true, notion: true }),
    get_rules: vi.fn().mockReturnValue({ telegram: true, slack: true, notion: true }),
  });

  it('should route crawl_result to Notion with formatted report', async () => {
    const router = make_mock_router();
    const handler = create_grant_notification_handler({ router: router as unknown as NotificationRouter });
    const report = make_report();

    await handler(report);

    // Should have called route with a crawl_result event containing the Notion-formatted report
    const crawl_call = router.route.mock.calls.find(
      (call: unknown[]) => (call[0] as { type: string }).type === 'crawl_result',
    );
    expect(crawl_call).toBeDefined();
    expect(crawl_call![0].message).toContain('예비창업패키지');
  });

  it('should route alert to Telegram when urgent deadlines exist', async () => {
    const router = make_mock_router();
    const handler = create_grant_notification_handler({ router: router as unknown as NotificationRouter });
    const report = make_report({
      deadline_alerts: [make_alert({ alert_level: 'D-1', days_remaining: 1 })],
    });

    await handler(report);

    // Should have called route with an alert event for Telegram
    const alert_call = router.route.mock.calls.find(
      (call: unknown[]) => (call[0] as { type: string }).type === 'alert',
    );
    expect(alert_call).toBeDefined();
    expect(alert_call![0].message).toContain('D-1');
  });

  it('should NOT send Telegram alert when no urgent deadlines', async () => {
    const router = make_mock_router();
    const handler = create_grant_notification_handler({ router: router as unknown as NotificationRouter });
    const report = make_report({
      deadline_alerts: [make_alert({ alert_level: 'D-7', days_remaining: 7 })],
    });

    await handler(report);

    // Should NOT have called route with an alert event
    const alert_call = router.route.mock.calls.find(
      (call: unknown[]) => (call[0] as { type: string }).type === 'alert',
    );
    expect(alert_call).toBeUndefined();
  });

  it('should always send crawl_result regardless of urgency', async () => {
    const router = make_mock_router();
    const handler = create_grant_notification_handler({ router: router as unknown as NotificationRouter });
    const report = make_report({ deadline_alerts: [] });

    await handler(report);

    const crawl_call = router.route.mock.calls.find(
      (call: unknown[]) => (call[0] as { type: string }).type === 'crawl_result',
    );
    expect(crawl_call).toBeDefined();
  });

  it('should handle empty report without errors', async () => {
    const router = make_mock_router();
    const handler = create_grant_notification_handler({ router: router as unknown as NotificationRouter });
    const report = make_report({
      total_grants: 0,
      new_grants: 0,
      matches: [],
      deadline_alerts: [],
      summary: 'Total: 0 grants',
    });

    await expect(handler(report)).resolves.not.toThrow();
  });
});
