// Tests for housing_notifier module
// Verifies Notion formatting, Telegram formatting, and notification routing

import { describe, it, expect, vi } from 'vitest';
import {
  format_housing_report_for_notion,
  format_deadline_alerts_for_telegram,
  should_send_telegram_alert,
  create_housing_notification_handler,
} from './housing_notifier.js';
import type { HousingReport, HousingMatchResult, HousingAnnouncement } from './housing_lottery.js';

// === Test fixtures ===

const make_announcement = (overrides: Partial<HousingAnnouncement> = {}): HousingAnnouncement => ({
  id: 'housing-123',
  title: '래미안 강남 포레스트',
  location: '서울특별시 강남구',
  size_sqm: 59,
  announcement_type: 'regional',
  deadline: '2026-04-15',
  url: 'https://www.applyhome.co.kr/detail?houseManageNo=123',
  discovered_at: '2026-03-21T00:00:00.000Z',
  ...overrides,
});

const make_match = (overrides: Partial<HousingMatchResult> = {}): HousingMatchResult => ({
  announcement: make_announcement(),
  priority: 'residence',
  match_reasons: ['무주택자 자격 충족', 'commute: 0min from 강남'],
  disqualify_reasons: [],
  ...overrides,
});

const make_report = (overrides: Partial<HousingReport> = {}): HousingReport => ({
  generated_at: '2026-03-21T10:00:00.000Z',
  total_announcements: 3,
  new_announcements: 2,
  matches: [
    make_match({ priority: 'residence' }),
    make_match({
      announcement: make_announcement({
        id: 'housing-456',
        title: '수원 호반 써밋',
        location: '경기도 수원시',
        size_sqm: 84,
        deadline: '2026-04-20',
      }),
      priority: 'investment',
      match_reasons: ['investment opportunity: 55min commute exceeds 60min max'],
      disqualify_reasons: [],
    }),
    make_match({
      announcement: make_announcement({
        id: 'housing-789',
        title: '노원 소형 아파트',
        location: '서울특별시 노원구',
        size_sqm: 30,
        deadline: null,
      }),
      priority: 'skip',
      match_reasons: [],
      disqualify_reasons: ['Too far (50min) and too small (30㎡)'],
    }),
  ],
  deadline_alerts: [],
  summary: 'Total: 3 announcements | Residence: 1 | Investment: 1 | Skipped: 1',
  ...overrides,
});

// === format_housing_report_for_notion ===

describe('format_housing_report_for_notion', () => {
  it('includes header with date, total, new counts, and summary', () => {
    const report = make_report();
    const result = format_housing_report_for_notion(report);

    expect(result).toContain('# Housing Report — 2026-03-21');
    expect(result).toContain('Total: 3 | New: 2');
    expect(result).toContain('Summary:');
  });

  it('groups by priority: residence > investment > skip', () => {
    const report = make_report();
    const result = format_housing_report_for_notion(report);

    const residence_idx = result.indexOf('## Residence');
    const investment_idx = result.indexOf('## Investment');
    const skip_idx = result.indexOf('## Skipped');

    // All three sections should exist
    expect(residence_idx).toBeGreaterThan(-1);
    expect(investment_idx).toBeGreaterThan(-1);
    expect(skip_idx).toBeGreaterThan(-1);

    // Correct ordering
    expect(residence_idx).toBeLessThan(investment_idx);
    expect(investment_idx).toBeLessThan(skip_idx);
  });

  it('renders residence matches with full details', () => {
    const report = make_report();
    const result = format_housing_report_for_notion(report);

    expect(result).toContain('### 래미안 강남 포레스트');
    expect(result).toContain('- Location: 서울특별시 강남구');
    expect(result).toContain('- Size: 59㎡');
    expect(result).toContain('- Deadline: 2026-04-15');
    expect(result).toContain('- Type: regional');
    expect(result).toContain('- URL: https://www.applyhome.co.kr/detail?houseManageNo=123');
  });

  it('renders investment matches with details', () => {
    const report = make_report();
    const result = format_housing_report_for_notion(report);

    expect(result).toContain('### 수원 호반 써밋');
    expect(result).toContain('- Location: 경기도 수원시');
  });

  it('renders skipped matches as strikethrough with reasons', () => {
    const report = make_report();
    const result = format_housing_report_for_notion(report);

    expect(result).toContain('- ~~노원 소형 아파트~~ — Too far (50min) and too small (30㎡)');
  });

  it('includes deadline alerts section when alerts exist', () => {
    const report = make_report({
      deadline_alerts: [
        {
          announcement: make_announcement({ title: '긴급 청약' }),
          days_remaining: 1,
          alert_level: 'D-1',
        },
      ],
    });
    const result = format_housing_report_for_notion(report);

    expect(result).toContain('## Deadline Alerts');
    expect(result).toContain('🔴 **[D-1]** 긴급 청약');
    expect(result).toContain('(1일 남음)');
  });

  it('omits deadline alerts section when no alerts', () => {
    const report = make_report({ deadline_alerts: [] });
    const result = format_housing_report_for_notion(report);

    expect(result).not.toContain('## Deadline Alerts');
  });

  it('omits sections with zero matches', () => {
    const report = make_report({
      matches: [make_match({ priority: 'residence' })],
    });
    const result = format_housing_report_for_notion(report);

    expect(result).toContain('## Residence');
    expect(result).not.toContain('## Investment');
    expect(result).not.toContain('## Skipped');
  });
});

// === format_deadline_alerts_for_telegram ===

describe('format_deadline_alerts_for_telegram', () => {
  it('returns empty string for no alerts', () => {
    expect(format_deadline_alerts_for_telegram([])).toBe('');
  });

  it('formats D-1 alert with red emoji', () => {
    const alerts = [
      {
        announcement: make_announcement({ title: 'D-1 청약', location: '서울특별시 강남구' }),
        days_remaining: 1,
        alert_level: 'D-1',
      },
    ];
    const result = format_deadline_alerts_for_telegram(alerts);

    expect(result).toContain('🏠 청약 마감 임박');
    expect(result).toContain('🔴 [D-1] D-1 청약');
    expect(result).toContain('(1일 남음)');
    expect(result).toContain('위치: 서울특별시 강남구 | 59㎡');
  });

  it('formats D-3 alert with orange emoji', () => {
    const alerts = [
      {
        announcement: make_announcement({ title: 'D-3 청약' }),
        days_remaining: 3,
        alert_level: 'D-3',
      },
    ];
    const result = format_deadline_alerts_for_telegram(alerts);

    expect(result).toContain('🟠 [D-3] D-3 청약');
  });

  it('sorts by urgency (most urgent first)', () => {
    const alerts = [
      {
        announcement: make_announcement({ title: '나중 청약' }),
        days_remaining: 3,
        alert_level: 'D-3',
      },
      {
        announcement: make_announcement({ title: '급한 청약' }),
        days_remaining: 1,
        alert_level: 'D-1',
      },
    ];
    const result = format_deadline_alerts_for_telegram(alerts);

    const urgent_idx = result.indexOf('급한 청약');
    const later_idx = result.indexOf('나중 청약');
    expect(urgent_idx).toBeLessThan(later_idx);
  });

  it('includes URL when present', () => {
    const alerts = [
      {
        announcement: make_announcement({ url: 'https://example.com/housing' }),
        days_remaining: 1,
        alert_level: 'D-1',
      },
    ];
    const result = format_deadline_alerts_for_telegram(alerts);

    expect(result).toContain('https://example.com/housing');
  });

  it('handles announcement without URL', () => {
    const alerts = [
      {
        announcement: make_announcement({ url: '' }),
        days_remaining: 1,
        alert_level: 'D-1',
      },
    ];
    const result = format_deadline_alerts_for_telegram(alerts);

    // Should not crash, just no URL line
    expect(result).toContain('🔴 [D-1]');
  });
});

// === should_send_telegram_alert ===

describe('should_send_telegram_alert', () => {
  it('returns true for D-1 alerts', () => {
    const alerts = [{ announcement: make_announcement(), days_remaining: 1, alert_level: 'D-1' }];
    expect(should_send_telegram_alert(alerts)).toBe(true);
  });

  it('returns true for D-3 alerts', () => {
    const alerts = [{ announcement: make_announcement(), days_remaining: 3, alert_level: 'D-3' }];
    expect(should_send_telegram_alert(alerts)).toBe(true);
  });

  it('returns false for D-7 only', () => {
    const alerts = [{ announcement: make_announcement(), days_remaining: 7, alert_level: 'D-7' }];
    expect(should_send_telegram_alert(alerts)).toBe(false);
  });

  it('returns false for overdue only', () => {
    const alerts = [{ announcement: make_announcement(), days_remaining: -1, alert_level: 'overdue' }];
    expect(should_send_telegram_alert(alerts)).toBe(false);
  });

  it('returns false for empty alerts', () => {
    expect(should_send_telegram_alert([])).toBe(false);
  });
});

// === create_housing_notification_handler ===

describe('create_housing_notification_handler', () => {
  const make_mock_router = () => ({
    route: vi.fn().mockResolvedValue(undefined),
  });

  it('routes crawl_result event to Notion + Slack', async () => {
    const router = make_mock_router();
    const handler = create_housing_notification_handler({ router: router as any });

    const report = make_report({ deadline_alerts: [] });
    await handler(report);

    // Should have called route once (crawl_result only, no alert)
    expect(router.route).toHaveBeenCalledTimes(1);

    const event = router.route.mock.calls[0][0];
    expect(event.type).toBe('crawl_result');
    expect(event.device).toBe('captain');
    expect(event.severity).toBe('low');
    expect(event.message).toContain('# Housing Report');
    expect(event.metadata).toMatchObject({
      total_announcements: 3,
      new_announcements: 2,
    });
  });

  it('sends alert event when D-1 deadline exists', async () => {
    const router = make_mock_router();
    const handler = create_housing_notification_handler({ router: router as any });

    const report = make_report({
      deadline_alerts: [
        {
          announcement: make_announcement({ title: '긴급 청약' }),
          days_remaining: 1,
          alert_level: 'D-1',
        },
      ],
    });
    await handler(report);

    // Should route twice: crawl_result + alert
    expect(router.route).toHaveBeenCalledTimes(2);

    const alert_event = router.route.mock.calls[1][0];
    expect(alert_event.type).toBe('alert');
    expect(alert_event.severity).toBe('high');
    expect(alert_event.message).toContain('🏠 청약 마감 임박');
    expect(alert_event.message).toContain('긴급 청약');
    expect(alert_event.metadata).toMatchObject({
      source: 'housing_notifier',
      urgent_count: 1,
    });
  });

  it('sends alert event when D-3 deadline exists', async () => {
    const router = make_mock_router();
    const handler = create_housing_notification_handler({ router: router as any });

    const report = make_report({
      deadline_alerts: [
        {
          announcement: make_announcement({ title: 'D-3 청약' }),
          days_remaining: 3,
          alert_level: 'D-3',
        },
      ],
    });
    await handler(report);

    expect(router.route).toHaveBeenCalledTimes(2);
    const alert_event = router.route.mock.calls[1][0];
    expect(alert_event.type).toBe('alert');
    expect(alert_event.message).toContain('D-3 청약');
  });

  it('does NOT send alert for D-7 only deadlines', async () => {
    const router = make_mock_router();
    const handler = create_housing_notification_handler({ router: router as any });

    const report = make_report({
      deadline_alerts: [
        {
          announcement: make_announcement(),
          days_remaining: 7,
          alert_level: 'D-7',
        },
      ],
    });
    await handler(report);

    // Only crawl_result, no alert
    expect(router.route).toHaveBeenCalledTimes(1);
    expect(router.route.mock.calls[0][0].type).toBe('crawl_result');
  });

  it('filters alert to only include D-1 and D-3 in Telegram message', async () => {
    const router = make_mock_router();
    const handler = create_housing_notification_handler({ router: router as any });

    const report = make_report({
      deadline_alerts: [
        {
          announcement: make_announcement({ title: '급한 것' }),
          days_remaining: 1,
          alert_level: 'D-1',
        },
        {
          announcement: make_announcement({ title: '덜 급한 것' }),
          days_remaining: 7,
          alert_level: 'D-7',
        },
      ],
    });
    await handler(report);

    const alert_event = router.route.mock.calls[1][0];
    expect(alert_event.message).toContain('급한 것');
    expect(alert_event.message).not.toContain('덜 급한 것');
  });

  it('includes residence and investment counts in metadata', async () => {
    const router = make_mock_router();
    const handler = create_housing_notification_handler({ router: router as any });

    const report = make_report({ deadline_alerts: [] });
    await handler(report);

    const event = router.route.mock.calls[0][0];
    expect(event.metadata.residence_count).toBe(1);
    expect(event.metadata.investment_count).toBe(1);
  });
});
