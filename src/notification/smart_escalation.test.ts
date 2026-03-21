// Smart escalation tests — time-aware notification routing
// Daytime (09:00~21:00): high-value results → Telegram immediately
// Nighttime (21:00~09:00): high-value results → queue, flush at 09:00 morning briefing

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_smart_escalator, type EscalationItem } from './smart_escalation.js';
import type { NotificationRouter } from './router.js';

// === Mock factory ===

const make_mock_router = (): NotificationRouter => ({
  route: vi.fn().mockResolvedValue({ telegram: true, slack: true, notion: false }),
  get_rules: vi.fn().mockReturnValue(null),
  get_queue_sizes: vi.fn().mockReturnValue({ telegram: 0, slack: 0, notion: 0 }),
  stop: vi.fn(),
});

// Helper to create Date at a specific hour (local time)
const make_date = (hour: number, minute = 0): Date => {
  const d = new Date('2026-03-21T00:00:00');
  d.setHours(hour, minute, 0, 0);
  return d;
};

// === Tests ===

describe('Smart Escalation', () => {
  let mock_router: NotificationRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    mock_router = make_mock_router();
  });

  describe('create_smart_escalator', () => {
    it('creates an escalator with default quiet hours', () => {
      const escalator = create_smart_escalator({ router: mock_router });
      expect(escalator).toBeDefined();
      expect(escalator.escalate).toBeTypeOf('function');
      expect(escalator.flush_morning_briefing).toBeTypeOf('function');
      expect(escalator.get_queued_count).toBeTypeOf('function');
    });

    it('creates an escalator with custom quiet hours', () => {
      const escalator = create_smart_escalator({
        router: mock_router,
        quiet_start: 22,
        quiet_end: 8,
      });
      expect(escalator).toBeDefined();
    });
  });

  describe('daytime escalation (09:00~21:00)', () => {
    it('sends immediately at 10:00 (daytime)', async () => {
      const escalator = create_smart_escalator({ router: mock_router });
      const now = make_date(10);

      await escalator.escalate('Grant Alert', 'New high-priority grant found', 'high', now);

      expect(mock_router.route).toHaveBeenCalledTimes(1);
      expect(mock_router.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'discovery',
          message: expect.stringContaining('Grant Alert'),
          severity: 'high',
        }),
      );
      expect(escalator.get_queued_count()).toBe(0);
    });

    it('sends immediately at 12:00 (midday)', async () => {
      const escalator = create_smart_escalator({ router: mock_router });
      const now = make_date(12);

      await escalator.escalate('Hot Post', 'Blind hot post', 'medium', now);

      expect(mock_router.route).toHaveBeenCalledTimes(1);
      expect(escalator.get_queued_count()).toBe(0);
    });

    it('sends immediately at 20:59 (just before quiet)', async () => {
      const escalator = create_smart_escalator({ router: mock_router });
      const now = make_date(20, 59);

      await escalator.escalate('Last Alert', 'Summary', 'high', now);

      expect(mock_router.route).toHaveBeenCalledTimes(1);
      expect(escalator.get_queued_count()).toBe(0);
    });
  });

  describe('nighttime queuing (21:00~09:00)', () => {
    it('queues at 21:00 (quiet start boundary)', async () => {
      const escalator = create_smart_escalator({ router: mock_router });
      const now = make_date(21, 0);

      await escalator.escalate('Night Alert', 'Summary', 'high', now);

      expect(mock_router.route).not.toHaveBeenCalled();
      expect(escalator.get_queued_count()).toBe(1);
    });

    it('queues at 23:00 (late night)', async () => {
      const escalator = create_smart_escalator({ router: mock_router });
      const now = make_date(23);

      await escalator.escalate('Late Night', 'Summary', 'medium', now);

      expect(mock_router.route).not.toHaveBeenCalled();
      expect(escalator.get_queued_count()).toBe(1);
    });

    it('queues at 03:00 (early morning)', async () => {
      const escalator = create_smart_escalator({ router: mock_router });
      const now = make_date(3);

      await escalator.escalate('Early Morning', 'Summary', 'high', now);

      expect(mock_router.route).not.toHaveBeenCalled();
      expect(escalator.get_queued_count()).toBe(1);
    });

    it('queues at 08:59 (just before quiet end)', async () => {
      const escalator = create_smart_escalator({ router: mock_router });
      const now = make_date(8, 59);

      await escalator.escalate('Almost Morning', 'Summary', 'high', now);

      expect(mock_router.route).not.toHaveBeenCalled();
      expect(escalator.get_queued_count()).toBe(1);
    });

    it('sends immediately at 09:00 (quiet end boundary — daytime starts)', async () => {
      const escalator = create_smart_escalator({ router: mock_router });
      const now = make_date(9, 0);

      await escalator.escalate('Morning Start', 'Summary', 'high', now);

      expect(mock_router.route).toHaveBeenCalledTimes(1);
      expect(escalator.get_queued_count()).toBe(0);
    });

    it('accumulates multiple queued items', async () => {
      const escalator = create_smart_escalator({ router: mock_router });
      const now = make_date(22);

      await escalator.escalate('Alert 1', 'Summary 1', 'high', now);
      await escalator.escalate('Alert 2', 'Summary 2', 'medium', now);
      await escalator.escalate('Alert 3', 'Summary 3', 'high', now);

      expect(mock_router.route).not.toHaveBeenCalled();
      expect(escalator.get_queued_count()).toBe(3);
    });
  });

  describe('flush_morning_briefing', () => {
    it('sends all queued items as one Telegram + Slack message', async () => {
      const escalator = create_smart_escalator({ router: mock_router });
      const night = make_date(23);

      // Queue 3 items overnight
      await escalator.escalate('Grant: 예비창업패키지', '신규 공고', 'high', night);
      await escalator.escalate('Housing: 강남 청약', '거주지 우선', 'high', night);
      await escalator.escalate('Blind: Hot Post', '댓글 80+', 'medium', night);

      expect(escalator.get_queued_count()).toBe(3);

      // Flush at 09:00
      const result = await escalator.flush_morning_briefing();

      expect(result.flushed_count).toBe(3);
      // Should send one Telegram alert (discovery) and one Slack detail (briefing)
      expect(mock_router.route).toHaveBeenCalledTimes(2);

      // First call: Telegram summary (discovery type)
      const telegram_call = (mock_router.route as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(telegram_call.type).toBe('discovery');
      expect(telegram_call.message).toContain('Grant: 예비창업패키지');
      expect(telegram_call.message).toContain('Housing: 강남 청약');
      expect(telegram_call.message).toContain('Blind: Hot Post');
      expect(telegram_call.message).toContain('3건');

      // Second call: Slack detail (briefing type)
      const slack_call = (mock_router.route as ReturnType<typeof vi.fn>).mock.calls[1][0];
      expect(slack_call.type).toBe('briefing');

      // Queue should be cleared
      expect(escalator.get_queued_count()).toBe(0);
    });

    it('does nothing when queue is empty', async () => {
      const escalator = create_smart_escalator({ router: mock_router });

      const result = await escalator.flush_morning_briefing();

      expect(result.flushed_count).toBe(0);
      expect(mock_router.route).not.toHaveBeenCalled();
    });

    it('clears queue even if router fails', async () => {
      const failing_router = make_mock_router();
      (failing_router.route as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));

      const escalator = create_smart_escalator({ router: failing_router });
      const night = make_date(23);

      await escalator.escalate('Alert', 'Summary', 'high', night);
      expect(escalator.get_queued_count()).toBe(1);

      const result = await escalator.flush_morning_briefing();

      // Queue should still be cleared to prevent infinite retry
      expect(escalator.get_queued_count()).toBe(0);
      expect(result.flushed_count).toBe(1);
      expect(result.error).toBeDefined();
    });
  });

  describe('custom quiet hours', () => {
    it('respects custom quiet_start=22 quiet_end=8', async () => {
      const escalator = create_smart_escalator({
        router: mock_router,
        quiet_start: 22,
        quiet_end: 8,
      });

      // 21:30 is daytime with custom hours (quiet starts at 22)
      await escalator.escalate('Alert', 'Summary', 'high', make_date(21, 30));
      expect(mock_router.route).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // 22:00 is quiet with custom hours
      await escalator.escalate('Alert', 'Summary', 'high', make_date(22, 0));
      expect(mock_router.route).not.toHaveBeenCalled();
      expect(escalator.get_queued_count()).toBe(1);
    });
  });

  describe('message formatting', () => {
    it('includes severity indicator in immediate message', async () => {
      const escalator = create_smart_escalator({ router: mock_router });
      const now = make_date(14);

      await escalator.escalate('Grant Alert', 'New grant found', 'high', now);

      const call_arg = (mock_router.route as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call_arg.message).toContain('Grant Alert');
      expect(call_arg.message).toContain('New grant found');
    });

    it('does NOT include approval prompt for informational alerts', async () => {
      const escalator = create_smart_escalator({ router: mock_router });
      const now = make_date(14);

      await escalator.escalate('Trend Alert', 'AI trend found', 'medium', now);

      const call_arg = (mock_router.route as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // Must NOT contain approval prompt — this is informational, not approval
      expect(call_arg.message).not.toContain('승인하시겠습니까');
    });
  });

  describe('get_queued_items', () => {
    it('returns copy of queued items', async () => {
      const escalator = create_smart_escalator({ router: mock_router });
      const night = make_date(23);

      await escalator.escalate('Alert 1', 'Summary 1', 'high', night);
      await escalator.escalate('Alert 2', 'Summary 2', 'medium', night);

      const items = escalator.get_queued_items();
      expect(items).toHaveLength(2);
      expect(items[0].title).toBe('Alert 1');
      expect(items[1].title).toBe('Alert 2');

      // Mutating returned array should not affect internal queue
      items.pop();
      expect(escalator.get_queued_count()).toBe(2);
    });
  });
});
