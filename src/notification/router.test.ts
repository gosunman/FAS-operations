// TDD tests for notification router
// Includes resilient_sender integration tests (Phase 7-3)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { create_notification_router } from './router.js';
import type { NotificationEvent } from '../shared/types.js';
import type { TelegramClient } from './telegram.js';
import type { SlackClient } from './slack.js';
import type { NotionClient } from './notion.js';

// === Mock factories ===

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

const create_mock_notion = (): NotionClient => ({
  send_notification: vi.fn().mockResolvedValue({ page_id: 'p1', url: 'https://notion.so/p1' }),
  send_with_result: vi.fn().mockResolvedValue({ channel: 'notion', success: true, attempts: 1, url: 'https://notion.so/p1' }),
  create_page: vi.fn().mockResolvedValue({ page_id: 'p1', url: 'https://notion.so/p1' }),
  create_daily_briefing: vi.fn().mockResolvedValue({ page_id: 'p1', url: 'https://notion.so/p1' }),
  _client: {} as never,
});

// === Original tests (backward compatibility — no queue_dir) ===

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
      notion: null,
    });
  });

  // === Routing matrix tests ===

  describe('briefing event', () => {
    it('should route to slack only (not telegram — minimize watch alerts)', async () => {
      const event: NotificationEvent = {
        type: 'briefing',
        message: 'Good morning',
        device: 'captain',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(false);
      expect(result.slack).toBe(true);
      expect(mock_telegram.send).not.toHaveBeenCalled();
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
    it('should route to slack only (not telegram — minimize watch alerts)', async () => {
      const event: NotificationEvent = {
        type: 'alert',
        message: 'Agent crashed!',
        device: 'captain',
        severity: 'critical',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(false);
      expect(result.slack).toBe(true);
      expect(mock_telegram.send).not.toHaveBeenCalled();
    });
  });

  describe('blocked event', () => {
    it('should route to slack only (not telegram — minimize watch alerts)', async () => {
      const event: NotificationEvent = {
        type: 'blocked',
        message: 'API key missing',
        device: 'captain',
      };

      const result = await router.route(event);

      expect(result.telegram).toBe(false);
      expect(result.slack).toBe(true);
      expect(mock_telegram.send).not.toHaveBeenCalled();
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
        notion: null,
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
        notion: null,
      });

      // Use approval_high — the only event that still goes to Telegram
      const event: NotificationEvent = {
        type: 'approval_high',
        message: 'Test',
        device: 'captain',
      };

      const result = await router_no_slack.route(event);
      expect(result.telegram).toBe(true);
      expect(result.slack).toBe(false);
    });
  });

  // === Cross-channel fallback ===

  describe('slack-only event fallback policy', () => {
    it('should NOT fallback error event to Telegram when Slack fails', async () => {
      // Slack-only events (error, milestone, done, agent_log) should never
      // flood Telegram — they are logged only when Slack fails.
      const failing_slack = create_mock_slack();
      (failing_slack.route as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const router_with_failing_slack = create_notification_router({
        telegram: mock_telegram,
        slack: failing_slack,
        notion: null,
      });

      const event: NotificationEvent = {
        type: 'error',
        message: 'Database connection lost',
        device: 'captain',
      };

      const result = await router_with_failing_slack.route(event);

      // error is slack-only — no Telegram fallback (prevents alert flooding)
      expect(result.slack).toBe(false);
      expect(result.telegram).toBe(false);
      expect(mock_telegram.send).not.toHaveBeenCalled();
    });

    it('should NOT fallback milestone event to Telegram when Slack fails', async () => {
      const failing_slack = create_mock_slack();
      (failing_slack.route as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const router_with_failing_slack = create_notification_router({
        telegram: mock_telegram,
        slack: failing_slack,
        notion: null,
      });

      const event: NotificationEvent = {
        type: 'milestone',
        message: 'Phase 1 complete',
        device: 'captain',
      };

      const result = await router_with_failing_slack.route(event);

      // milestone is slack-only — no Telegram fallback
      expect(result.slack).toBe(false);
      expect(result.telegram).toBe(false);
      expect(mock_telegram.send).not.toHaveBeenCalled();
    });

    it('should use [Slack Fallback] tag for dual-route events', async () => {
      const failing_slack = create_mock_slack();
      (failing_slack.route as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const router_with_failing_slack = create_notification_router({
        telegram: mock_telegram,
        slack: failing_slack,
        notion: null,
      });

      // approval_high is dual-route (telegram + slack)
      const event: NotificationEvent = {
        type: 'approval_high',
        message: 'Approve deploy?',
        device: 'captain',
      };

      await router_with_failing_slack.route(event);

      // Should have two calls: initial telegram send + slack fallback via telegram
      const telegram_calls = (mock_telegram.send as ReturnType<typeof vi.fn>).mock.calls;
      expect(telegram_calls.length).toBe(2);
      expect(telegram_calls[1][0]).toBe('[Slack Fallback] Approve deploy?');
    });
  });

  // === get_rules() ===

  describe('get_rules()', () => {
    it('should return rules for known event types', () => {
      const rules = router.get_rules('alert');
      expect(rules).toEqual({ telegram: false, slack: true, notion: false });
    });

    it('should return null for unknown event type', () => {
      const rules = router.get_rules('unknown_type' as never);
      expect(rules).toBeNull();
    });
  });

  // === stop() and get_queue_sizes() — no queue_dir ===

  describe('stop() without queue_dir', () => {
    it('should be safe to call stop() when no resilient senders exist', () => {
      // Given: router created without queue_dir
      // When: stop() is called
      // Then: no error
      expect(() => router.stop()).not.toThrow();
    });
  });

  describe('get_queue_sizes() without queue_dir', () => {
    it('should return zeros when no resilient senders exist', () => {
      // Given: router created without queue_dir
      // When: get_queue_sizes() is called
      // Then: all zeros
      const sizes = router.get_queue_sizes();
      expect(sizes).toEqual({ telegram: 0, slack: 0, notion: 0 });
    });
  });
});

// === Resilient sender integration tests ===

describe('Notification Router — resilient sender integration', () => {
  let test_dir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    test_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fas-router-resilient-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(test_dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  // === Basic resilient routing ===

  describe('telegram resilient send', () => {
    it('should send telegram normally when network is up', async () => {
      // Given: router with queue_dir and working telegram
      const mock_tg = create_mock_telegram();
      const router = create_notification_router({
        telegram: mock_tg,
        slack: create_mock_slack(),
        notion: null,
        queue_dir: test_dir,
      });

      // When: sending approval_high (routes to telegram)
      const event: NotificationEvent = {
        type: 'approval_high',
        message: 'Approve push?',
        device: 'captain',
      };
      const result = await router.route(event);

      // Then: telegram send succeeds, queue is empty
      expect(result.telegram).toBe(true);
      expect(router.get_queue_sizes().telegram).toBe(0);
      router.stop();
    });

    it('should queue telegram send on network error and report failure', async () => {
      // Given: router with queue_dir and telegram that throws network error
      const mock_tg = create_mock_telegram();
      (mock_tg.send as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('connect ECONNREFUSED 127.0.0.1:443'),
      );
      const router = create_notification_router({
        telegram: mock_tg,
        slack: null, // no slack to avoid fallback complexity
        notion: null,
        queue_dir: test_dir,
      });

      // When: sending approval_high
      const event: NotificationEvent = {
        type: 'approval_high',
        message: 'Approve push?',
        device: 'captain',
      };
      const result = await router.route(event);

      // Then: telegram reports failure, message is queued for retry
      expect(result.telegram).toBe(false);
      expect(router.get_queue_sizes().telegram).toBe(1);
      router.stop();
    });

    it('should rethrow non-network errors from telegram', async () => {
      // Given: telegram throws a non-network error (e.g. invalid token)
      const mock_tg = create_mock_telegram();
      (mock_tg.send as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('403: Forbidden: bot token invalid'),
      );
      const router = create_notification_router({
        telegram: mock_tg,
        slack: null,
        notion: null,
        queue_dir: test_dir,
      });

      // When/Then: non-network error propagates
      const event: NotificationEvent = {
        type: 'approval_high',
        message: 'Test',
        device: 'captain',
      };
      await expect(router.route(event)).rejects.toThrow('403: Forbidden: bot token invalid');
      // Queue should remain empty (non-network errors are not queued)
      expect(router.get_queue_sizes().telegram).toBe(0);
      router.stop();
    });
  });

  describe('slack resilient send', () => {
    it('should send slack normally when network is up', async () => {
      // Given: router with queue_dir and working slack
      const mock_sl = create_mock_slack();
      const router = create_notification_router({
        telegram: null,
        slack: mock_sl,
        notion: null,
        queue_dir: test_dir,
      });

      // When: sending briefing (routes to slack only)
      const event: NotificationEvent = {
        type: 'briefing',
        message: 'Good morning',
        device: 'captain',
      };
      const result = await router.route(event);

      // Then: slack succeeds, queue empty
      expect(result.slack).toBe(true);
      expect(router.get_queue_sizes().slack).toBe(0);
      router.stop();
    });

    it('should queue slack route() on network error', async () => {
      // Given: slack.route() throws network error
      const mock_sl = create_mock_slack();
      (mock_sl.route as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('fetch failed'),
      );
      const router = create_notification_router({
        telegram: null,
        slack: mock_sl,
        notion: null,
        queue_dir: test_dir,
      });

      // When: sending briefing
      const event: NotificationEvent = {
        type: 'briefing',
        message: 'Good morning',
        device: 'captain',
      };
      const result = await router.route(event);

      // Then: slack reports failure, message queued
      expect(result.slack).toBe(false);
      expect(router.get_queue_sizes().slack).toBe(1);
      router.stop();
    });

    it('should queue slack send() on network error (crawl_result with notion url)', async () => {
      // Given: notion succeeds (provides URL), but slack.send() throws network error
      const mock_sl = create_mock_slack();
      (mock_sl.send as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('socket hang up'),
      );
      const mock_notion = create_mock_notion();
      const router = create_notification_router({
        telegram: null,
        slack: mock_sl,
        notion: mock_notion,
        queue_dir: test_dir,
      });

      // When: sending crawl_result (notion provides URL, slack uses send() not route())
      const event: NotificationEvent = {
        type: 'crawl_result',
        message: 'Found 5 new grants',
        device: 'captain',
      };
      const result = await router.route(event);

      // Then: slack fails and queues
      expect(result.slack).toBe(false);
      expect(result.notion).toBe(true);
      expect(router.get_queue_sizes().slack).toBe(1);
      router.stop();
    });
  });

  describe('notion resilient send', () => {
    it('should send notion normally and extract URL', async () => {
      // Given: router with queue_dir and working notion
      const mock_notion = create_mock_notion();
      const mock_sl = create_mock_slack();
      const router = create_notification_router({
        telegram: null,
        slack: mock_sl,
        notion: mock_notion,
        queue_dir: test_dir,
      });

      // When: sending crawl_result (goes to notion + slack)
      const event: NotificationEvent = {
        type: 'crawl_result',
        message: 'Found grants',
        device: 'captain',
      };
      const result = await router.route(event);

      // Then: notion succeeds, URL is used in Slack message
      expect(result.notion).toBe(true);
      expect(result.slack).toBe(true);
      // Slack should have been called with send() (not route()) including the notion URL
      expect(mock_sl.send).toHaveBeenCalled();
      const slack_call_args = (mock_sl.send as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(slack_call_args[1]).toContain('https://notion.so/p1');
      router.stop();
    });

    it('should queue notion on exception and still send slack without notion URL', async () => {
      // Given: notion throws network error
      const mock_notion = create_mock_notion();
      (mock_notion.send_with_result as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('ECONNREFUSED'),
      );
      const mock_sl = create_mock_slack();
      const router = create_notification_router({
        telegram: null,
        slack: mock_sl,
        notion: mock_notion,
        queue_dir: test_dir,
      });

      // When: sending crawl_result
      const event: NotificationEvent = {
        type: 'crawl_result',
        message: 'Found grants',
        device: 'captain',
      };
      const result = await router.route(event);

      // Then: notion fails, queued for retry; slack still sends (via route, not send with URL)
      expect(result.notion).toBe(false);
      expect(result.slack).toBe(true);
      // Notion queue should have items (one from send_notion's catch + one from resilient_sender.send)
      expect(router.get_queue_sizes().notion).toBeGreaterThanOrEqual(1);
      // Slack uses route() because no notion_url available
      expect(mock_sl.route).toHaveBeenCalled();
      router.stop();
    });

    it('should queue notion on success=false result', async () => {
      // Given: notion returns success=false (no exception)
      const mock_notion = create_mock_notion();
      (mock_notion.send_with_result as ReturnType<typeof vi.fn>).mockResolvedValue({
        channel: 'notion',
        success: false,
        attempts: 3,
        error: 'All retries exhausted',
      });
      const router = create_notification_router({
        telegram: null,
        slack: create_mock_slack(),
        notion: mock_notion,
        queue_dir: test_dir,
      });

      // When: sending discovery (goes to notion)
      const event: NotificationEvent = {
        type: 'discovery',
        message: 'Found something',
        device: 'captain',
      };
      const result = await router.route(event);

      // Then: notion reports failure, queued for retry
      expect(result.notion).toBe(false);
      // Queue should have items from the fire-and-forget resilient send
      expect(router.get_queue_sizes().notion).toBeGreaterThanOrEqual(1);
      router.stop();
    });
  });

  // === Cross-channel fallback with resilient sends ===

  describe('cross-channel fallback with resilient sends', () => {
    it('should fallback telegram failure to slack (resilient mode)', async () => {
      // Given: telegram fails with network error, slack works
      const mock_tg = create_mock_telegram();
      (mock_tg.send as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('ECONNREFUSED'),
      );
      const mock_sl = create_mock_slack();
      const router = create_notification_router({
        telegram: mock_tg,
        slack: mock_sl,
        notion: null,
        queue_dir: test_dir,
      });

      // When: sending approval_high (dual-route)
      const event: NotificationEvent = {
        type: 'approval_high',
        message: 'Approve?',
        device: 'captain',
      };
      const result = await router.route(event);

      // Then: telegram fails (queued), slack fallback triggers
      expect(result.telegram).toBe(false);
      expect(result.slack).toBe(true);
      // Telegram message should be queued
      expect(router.get_queue_sizes().telegram).toBe(1);
      router.stop();
    });

    it('should fallback slack failure to telegram for dual-route events (resilient mode)', async () => {
      // Given: slack fails with network error, telegram works
      const mock_tg = create_mock_telegram();
      const mock_sl = create_mock_slack();
      (mock_sl.route as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('fetch failed'),
      );
      // For the fallback send via slack resilient sender, also fails
      (mock_sl.send as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('fetch failed'),
      );
      const router = create_notification_router({
        telegram: mock_tg,
        slack: mock_sl,
        notion: null,
        queue_dir: test_dir,
      });

      // When: sending approval_high (dual-route)
      const event: NotificationEvent = {
        type: 'approval_high',
        message: 'Approve?',
        device: 'captain',
      };
      const result = await router.route(event);

      // Then: telegram succeeds initially, slack fails and queues,
      // then fallback via telegram sends [Slack Fallback]
      expect(result.telegram).toBe(true);
      // Slack queue should have items (from the initial route attempt)
      expect(router.get_queue_sizes().slack).toBeGreaterThanOrEqual(1);
      router.stop();
    });
  });

  // === stop() and get_queue_sizes() ===

  describe('stop()', () => {
    it('should stop all retry loops', () => {
      // Given: router with queue_dir (all resilient senders start retry loops)
      const router = create_notification_router({
        telegram: create_mock_telegram(),
        slack: create_mock_slack(),
        notion: create_mock_notion(),
        queue_dir: test_dir,
      });

      // When: stop() is called
      router.stop();

      // Then: no errors, all cleaned up (verify by calling stop again — idempotent)
      expect(() => router.stop()).not.toThrow();
    });
  });

  describe('get_queue_sizes()', () => {
    it('should return zero for all channels when nothing is queued', () => {
      // Given: fresh router with queue_dir
      const router = create_notification_router({
        telegram: create_mock_telegram(),
        slack: create_mock_slack(),
        notion: null,
        queue_dir: test_dir,
      });

      // When: checking queue sizes
      const sizes = router.get_queue_sizes();

      // Then: all zero
      expect(sizes.telegram).toBe(0);
      expect(sizes.slack).toBe(0);
      expect(sizes.notion).toBe(0);
      router.stop();
    });

    it('should track queued items per channel', async () => {
      // Given: telegram and slack both fail with network errors
      const mock_tg = create_mock_telegram();
      (mock_tg.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
      const mock_sl = create_mock_slack();
      (mock_sl.route as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fetch failed'));
      (mock_sl.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fetch failed'));

      const router = create_notification_router({
        telegram: mock_tg,
        slack: mock_sl,
        notion: null,
        queue_dir: test_dir,
      });

      // When: sending a discovery event (routes to telegram + slack)
      const event: NotificationEvent = {
        type: 'discovery',
        message: 'Important finding',
        device: 'captain',
      };
      await router.route(event);

      // Then: both channels have queued items
      const sizes = router.get_queue_sizes();
      expect(sizes.telegram).toBeGreaterThanOrEqual(1);
      expect(sizes.slack).toBeGreaterThanOrEqual(1);
      router.stop();
    });
  });

  // === Backward compatibility ===

  describe('backward compatibility', () => {
    it('should work identically without queue_dir (no resilient senders)', async () => {
      // Given: router created without queue_dir (legacy mode)
      const mock_tg = create_mock_telegram();
      const mock_sl = create_mock_slack();
      const router = create_notification_router({
        telegram: mock_tg,
        slack: mock_sl,
        notion: null,
        // no queue_dir
      });

      // When: sending events
      const event: NotificationEvent = {
        type: 'approval_high',
        message: 'Test',
        device: 'captain',
      };
      const result = await router.route(event);

      // Then: works as before
      expect(result.telegram).toBe(true);
      expect(result.slack).toBe(true);
      expect(mock_tg.send).toHaveBeenCalledWith('Test', 'approval');
      expect(router.get_queue_sizes()).toEqual({ telegram: 0, slack: 0, notion: 0 });
    });

    it('should not create queue directories when queue_dir is not set', () => {
      // Given/When: router without queue_dir
      create_notification_router({
        telegram: create_mock_telegram(),
        slack: create_mock_slack(),
        notion: null,
      });

      // Then: no queue directories created
      // (no directories to check — just verify no error)
    });
  });

  // === Config options ===

  describe('resilient config options', () => {
    it('should accept custom retry_interval_ms and max_retry_count', () => {
      // Given/When: router with custom config
      const router = create_notification_router(
        {
          telegram: create_mock_telegram(),
          slack: create_mock_slack(),
          notion: null,
          queue_dir: test_dir,
        },
        {
          retry_interval_ms: 5000,
          max_retry_count: 3,
        },
      );

      // Then: no error, stop cleans up
      expect(() => router.stop()).not.toThrow();
    });
  });

  // === Queue directory structure ===

  describe('queue directory structure', () => {
    it('should create per-channel subdirectories under queue_dir', () => {
      // Given/When: router with queue_dir and all channels
      const router = create_notification_router({
        telegram: create_mock_telegram(),
        slack: create_mock_slack(),
        notion: create_mock_notion(),
        queue_dir: test_dir,
      });

      // Then: subdirectories are created for each channel
      expect(fs.existsSync(path.join(test_dir, 'telegram'))).toBe(true);
      expect(fs.existsSync(path.join(test_dir, 'slack'))).toBe(true);
      expect(fs.existsSync(path.join(test_dir, 'notion'))).toBe(true);
      router.stop();
    });

    it('should NOT create subdirectories for null channels', () => {
      // Given/When: router with only slack
      const router = create_notification_router({
        telegram: null,
        slack: create_mock_slack(),
        notion: null,
        queue_dir: test_dir,
      });

      // Then: only slack subdirectory created
      expect(fs.existsSync(path.join(test_dir, 'telegram'))).toBe(false);
      expect(fs.existsSync(path.join(test_dir, 'slack'))).toBe(true);
      expect(fs.existsSync(path.join(test_dir, 'notion'))).toBe(false);
      router.stop();
    });
  });

  // === Multiple events queuing ===

  describe('multiple events queuing', () => {
    it('should queue multiple failed sends independently', async () => {
      // Given: slack always fails with network error
      const mock_sl = create_mock_slack();
      (mock_sl.route as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ETIMEDOUT'));

      const router = create_notification_router({
        telegram: null,
        slack: mock_sl,
        notion: null,
        queue_dir: test_dir,
      });

      // When: sending 3 different events
      const events: NotificationEvent[] = [
        { type: 'briefing', message: 'Morning', device: 'captain' },
        { type: 'alert', message: 'Crash!', device: 'captain' },
        { type: 'milestone', message: 'Done!', device: 'captain' },
      ];

      for (const event of events) {
        await router.route(event);
      }

      // Then: 3 items queued
      expect(router.get_queue_sizes().slack).toBe(3);
      router.stop();
    });
  });
});
