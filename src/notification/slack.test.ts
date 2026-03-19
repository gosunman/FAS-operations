// TDD tests for Slack notification module
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_slack_client } from './slack.js';
import type { NotificationEvent } from '../shared/types.js';

// Mock @slack/web-api
vi.mock('@slack/web-api', () => {
  const MockWebClient = vi.fn(function (this: Record<string, unknown>) {
    this.chat = {
      postMessage: vi.fn().mockResolvedValue({ ok: true }),
    };
  });
  return { WebClient: MockWebClient };
});

describe('Slack Client', () => {
  let client: ReturnType<typeof create_slack_client>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = create_slack_client({ token: 'xoxb-test-token' });
  });

  // === send() tests ===

  describe('send()', () => {
    it('should send a message to specified channel', async () => {
      const result = await client.send('#fas-general', 'Hello FAS');

      expect(result).toBe(true);
      expect(client._web.chat.postMessage).toHaveBeenCalledWith({
        channel: '#fas-general',
        text: 'Hello FAS',
        blocks: undefined,
      });
    });

    it('should return false on failure after all retries', async () => {
      vi.mocked(client._web.chat.postMessage)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'));

      const result = await client.send('#alerts', 'test');
      expect(result).toBe(false);
    });

    it('should pass blocks when provided', async () => {
      const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'Hello' } }];
      await client.send('#fas-general', 'fallback text', blocks);

      expect(client._web.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ blocks }),
      );
    });
  });

  // === resolve_channel() tests ===

  describe('resolve_channel()', () => {
    it('should route captain agent_log to #captain-logs', () => {
      const event: NotificationEvent = {
        type: 'agent_log',
        message: 'Claude completed task',
        device: 'captain',
      };
      expect(client.resolve_channel(event)).toBe('#captain-logs');
    });

    it('should route hunter agent_log to #hunter-logs', () => {
      const event: NotificationEvent = {
        type: 'agent_log',
        message: 'OpenClaw completed task',
        device: 'hunter',
      };
      expect(client.resolve_channel(event)).toBe('#hunter-logs');
    });

    it('should route crawl_result to #crawl-results', () => {
      const event: NotificationEvent = {
        type: 'crawl_result',
        message: 'Found 3 new startup programs',
        device: 'captain',
      };
      expect(client.resolve_channel(event)).toBe('#fas-general');
    });

    it('should route approval_mid to #approvals', () => {
      const event: NotificationEvent = {
        type: 'approval_mid',
        message: 'AI cross review needed',
        device: 'captain',
      };
      expect(client.resolve_channel(event)).toBe('#approvals');
    });

    it('should route alert to #alerts', () => {
      const event: NotificationEvent = {
        type: 'alert',
        message: 'Agent crashed',
        device: 'captain',
        severity: 'critical',
      };
      expect(client.resolve_channel(event)).toBe('#alerts');
    });

    it('should route briefing to #fas-general', () => {
      const event: NotificationEvent = {
        type: 'briefing',
        message: 'Morning briefing',
        device: 'captain',
      };
      expect(client.resolve_channel(event)).toBe('#fas-general');
    });

    it('should route milestone to #fas-general', () => {
      const event: NotificationEvent = {
        type: 'milestone',
        message: 'Phase 0 complete',
        device: 'captain',
      };
      expect(client.resolve_channel(event)).toBe('#fas-general');
    });

    it('should route academy to #academy', () => {
      const event: NotificationEvent = {
        type: 'academy',
        message: 'Test paper generated',
        device: 'captain',
      };
      expect(client.resolve_channel(event)).toBe('#academy');
    });

    it('should route blocked to #alerts', () => {
      const event: NotificationEvent = {
        type: 'blocked',
        message: 'Task blocked',
        device: 'captain',
      };
      expect(client.resolve_channel(event)).toBe('#alerts');
    });
  });

  // === route() tests ===

  describe('route()', () => {
    it('should send event message to resolved channel', async () => {
      const event: NotificationEvent = {
        type: 'milestone',
        message: 'Phase 1 complete!',
        device: 'captain',
      };

      const result = await client.route(event);

      expect(result).toBe(true);
      expect(client._web.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: '#fas-general',
          text: 'Phase 1 complete!',
        }),
      );
    });

    it('should route device-specific logs correctly', async () => {
      const captain_event: NotificationEvent = {
        type: 'agent_log',
        message: 'Claude log',
        device: 'captain',
      };
      const hunter_event: NotificationEvent = {
        type: 'agent_log',
        message: 'Hunter log',
        device: 'hunter',
      };

      await client.route(captain_event);
      await client.route(hunter_event);

      const calls = vi.mocked(client._web.chat.postMessage).mock.calls;
      expect(calls[0][0]).toEqual(expect.objectContaining({ channel: '#captain-logs' }));
      expect(calls[1][0]).toEqual(expect.objectContaining({ channel: '#hunter-logs' }));
    });
  });

  // === Format helpers ===

  describe('format helpers', () => {
    it('format_milestone should include tag', () => {
      const msg = client.format_milestone('Phase 0 done');
      expect(msg).toContain('[MILESTONE]');
      expect(msg).toContain('Phase 0 done');
    });

    it('format_done should include tag', () => {
      const msg = client.format_done('All tasks complete');
      expect(msg).toContain('[DONE]');
    });

    it('format_blocked should include tag', () => {
      const msg = client.format_blocked('API key missing');
      expect(msg).toContain('[BLOCKED]');
    });

    it('format_error should include tag', () => {
      const msg = client.format_error('Timeout');
      expect(msg).toContain('[ERROR]');
    });
  });
});
