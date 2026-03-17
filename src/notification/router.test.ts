// TDD tests for notification router
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_notification_router } from './router.js';
import type { NotificationEvent } from '../shared/types.js';
import type { TelegramClient } from './telegram.js';
import type { SlackClient } from './slack.js';

// Create mock clients
const create_mock_telegram = (): TelegramClient => ({
  send: vi.fn().mockResolvedValue({ message_id: 1, success: true }),
  wait_for_approval: vi.fn().mockResolvedValue(null),
  format_approval_message: vi.fn().mockReturnValue('formatted'),
  format_alert: vi.fn().mockReturnValue('alert'),
  format_briefing: vi.fn().mockReturnValue('briefing'),
  stop: vi.fn(),
  _bot: {} as never,
  _pending_approvals: new Map(),
});

const create_mock_slack = (): SlackClient => ({
  send: vi.fn().mockResolvedValue(true),
  route: vi.fn().mockResolvedValue(true),
  resolve_channel: vi.fn().mockReturnValue('#fas-general'),
  format_milestone: vi.fn().mockReturnValue('milestone'),
  format_done: vi.fn().mockReturnValue('done'),
  format_blocked: vi.fn().mockReturnValue('blocked'),
  format_error: vi.fn().mockReturnValue('error'),
  _web: {} as never,
});

describe('Notification Router', () => {
  let mock_telegram: TelegramClient;
  let mock_slack: SlackClient;
  let router: ReturnType<typeof create_notification_router>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock_telegram = create_mock_telegram();
    mock_slack = create_mock_slack();
    router = create_notification_router({
      telegram: mock_telegram,
      slack: mock_slack,
    });
  });

  // === Routing matrix tests ===

  describe('briefing event', () => {
    it('should route to telegram + slack', async () => {
      const event: NotificationEvent = {
        type: 'briefing',
        message: 'Good morning',
        device: 'captain',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(true);
      expect(result.slack).toBe(true);
      expect(mock_telegram.send).toHaveBeenCalledWith(
        'Good morning',
        'briefing',
      );
      expect(mock_slack.route).toHaveBeenCalledWith(event);
    });
  });

  describe('agent_log event', () => {
    it('should route to slack only', async () => {
      const event: NotificationEvent = {
        type: 'agent_log',
        message: 'Claude finished task',
        device: 'captain',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(false);
      expect(result.slack).toBe(true);
      expect(mock_telegram.send).not.toHaveBeenCalled();
      expect(mock_slack.route).toHaveBeenCalled();
    });
  });

  describe('approval_high event', () => {
    it('should route to telegram (as approval) + slack', async () => {
      const event: NotificationEvent = {
        type: 'approval_high',
        message: 'Approve git push?',
        device: 'captain',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(true);
      expect(result.slack).toBe(true);
      expect(mock_telegram.send).toHaveBeenCalledWith(
        'Approve git push?',
        'approval',
      );
    });
  });

  describe('alert event', () => {
    it('should route to telegram (as alert) + slack', async () => {
      const event: NotificationEvent = {
        type: 'alert',
        message: 'Agent crashed!',
        device: 'captain',
        severity: 'critical',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(true);
      expect(result.slack).toBe(true);
      expect(mock_telegram.send).toHaveBeenCalledWith(
        'Agent crashed!',
        'alert',
      );
    });
  });

  describe('blocked event', () => {
    it('should route to telegram + slack', async () => {
      const event: NotificationEvent = {
        type: 'blocked',
        message: 'API key missing',
        device: 'captain',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(true);
      expect(result.slack).toBe(true);
      expect(mock_telegram.send).toHaveBeenCalledWith(
        'API key missing',
        'alert',
      );
    });
  });

  describe('milestone event', () => {
    it('should route to slack only', async () => {
      const event: NotificationEvent = {
        type: 'milestone',
        message: 'Phase 0 complete',
        device: 'captain',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(false);
      expect(result.slack).toBe(true);
    });
  });

  describe('crawl_result event', () => {
    it('should route to slack (notion pending)', async () => {
      const event: NotificationEvent = {
        type: 'crawl_result',
        message: 'Found 5 new startup grants',
        device: 'captain',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(false);
      expect(result.slack).toBe(true);
      // notion is not yet implemented
      expect(result.notion).toBe(false);
    });
  });

  // === Null client handling ===

  describe('null clients', () => {
    it('should skip telegram when client is null', async () => {
      const router_no_telegram = create_notification_router({
        telegram: null,
        slack: mock_slack,
      });

      const event: NotificationEvent = {
        type: 'alert',
        message: 'Test',
        device: 'captain',
      };

      const result = await router_no_telegram.route(event);
      expect(result.telegram).toBe(false);
      expect(result.slack).toBe(true);
    });

    it('should skip slack when client is null', async () => {
      const router_no_slack = create_notification_router({
        telegram: mock_telegram,
        slack: null,
      });

      const event: NotificationEvent = {
        type: 'alert',
        message: 'Test',
        device: 'captain',
      };

      const result = await router_no_slack.route(event);
      expect(result.telegram).toBe(true);
      expect(result.slack).toBe(false);
    });
  });

  // === get_rules() ===

  describe('get_rules()', () => {
    it('should return rules for known event types', () => {
      const rules = router.get_rules('alert');
      expect(rules).toEqual({ telegram: true, slack: true, notion: false });
    });

    it('should return null for unknown event type', () => {
      const rules = router.get_rules('unknown_type' as never);
      expect(rules).toBeNull();
    });
  });
});
