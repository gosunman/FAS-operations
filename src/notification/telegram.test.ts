// TDD tests for Telegram notification module
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_telegram_client } from './telegram.js';
import type { TelegramConfig } from './telegram.js';

// Mock node-telegram-bot-api
vi.mock('node-telegram-bot-api', () => {
  const MockBot = vi.fn(function (this: Record<string, unknown>) {
    this.sendMessage = vi.fn().mockResolvedValue({ message_id: 42 });
    this.on = vi.fn();
    this.answerCallbackQuery = vi.fn();
    this.stopPolling = vi.fn();
  });
  return { default: MockBot };
});

const TEST_CONFIG: TelegramConfig = {
  token: 'test-token-123',
  chat_id: '12345',
  polling: false,
};

describe('Telegram Client', () => {
  let client: ReturnType<typeof create_telegram_client>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = create_telegram_client(TEST_CONFIG);
  });

  // === send() tests ===

  describe('send()', () => {
    it('should send an info message and return message_id', async () => {
      const result = await client.send('Hello FAS', 'info');

      expect(result.success).toBe(true);
      expect(result.message_id).toBe(42);
      expect(client._bot.sendMessage).toHaveBeenCalledWith(
        '12345',
        'Hello FAS',
        expect.objectContaining({
          parse_mode: 'Markdown',
          reply_markup: undefined,
        }),
      );
    });

    it('should send an approval message with inline keyboard', async () => {
      const result = await client.send(
        'Approve this?',
        'approval',
        'req_001',
      );

      expect(result.success).toBe(true);
      expect(client._bot.sendMessage).toHaveBeenCalledWith(
        '12345',
        'Approve this?',
        expect.objectContaining({
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ 승인', callback_data: 'approve:req_001' },
              { text: '❌ 거부', callback_data: 'reject:req_001' },
            ]],
          },
        }),
      );
    });

    it('should return success: false on send failure', async () => {
      vi.mocked(client._bot.sendMessage).mockRejectedValueOnce(
        new Error('Network error'),
      );

      const result = await client.send('test', 'info');

      expect(result.success).toBe(false);
      expect(result.message_id).toBe(0);
    });

    it('should not add inline keyboard for non-approval types', async () => {
      await client.send('Alert!', 'alert');

      expect(client._bot.sendMessage).toHaveBeenCalledWith(
        '12345',
        'Alert!',
        expect.objectContaining({
          reply_markup: undefined,
        }),
      );
    });
  });

  // === wait_for_approval() tests ===

  describe('wait_for_approval()', () => {
    it('should resolve with null on timeout', async () => {
      const promise = client.wait_for_approval('req_timeout', 50);
      const result = await promise;

      expect(result).toBeNull();
    });

    it('should resolve when approval callback fires', async () => {
      const promise = client.wait_for_approval('req_approve', null);

      // Simulate callback
      const resolver = client._pending_approvals.get('req_approve');
      expect(resolver).toBeDefined();
      resolver!(true);

      const result = await promise;
      expect(result).not.toBeNull();
      expect(result!.approved).toBe(true);
      expect(result!.responded_by).toBe('human');
    });

    it('should resolve with rejected when reject callback fires', async () => {
      const promise = client.wait_for_approval('req_reject', null);

      const resolver = client._pending_approvals.get('req_reject');
      resolver!(false);

      const result = await promise;
      expect(result).not.toBeNull();
      expect(result!.approved).toBe(false);
    });

    it('should clean up pending approval on timeout', async () => {
      client.wait_for_approval('req_cleanup', 50);

      expect(client._pending_approvals.has('req_cleanup')).toBe(true);

      // Wait for timeout
      await new Promise((r) => setTimeout(r, 100));

      expect(client._pending_approvals.has('req_cleanup')).toBe(false);
    });
  });

  // === Format helpers ===

  describe('format_approval_message()', () => {
    it('should format HIGH approval with orange emoji', () => {
      const msg = client.format_approval_message(
        'req_001',
        'git_push',
        'Push to main branch',
        'high',
      );

      expect(msg).toContain('🟠');
      expect(msg).toContain('*승인 요청*');
      expect(msg).toContain('HIGH');
      expect(msg).toContain('git_push');
      expect(msg).toContain('req_001');
    });

    it('should format CRITICAL approval with red emoji', () => {
      const msg = client.format_approval_message(
        'req_002',
        'deploy',
        'Production deployment',
        'critical',
      );

      expect(msg).toContain('🔴');
      expect(msg).toContain('CRITICAL');
    });
  });

  describe('format_alert()', () => {
    it('should format alert with emoji prefix', () => {
      const msg = client.format_alert('Agent crashed');
      expect(msg).toContain('🚨');
      expect(msg).toContain('Agent crashed');
    });
  });

  describe('format_briefing()', () => {
    it('should format briefing with morning emoji', () => {
      const msg = client.format_briefing('5 tasks completed');
      expect(msg).toContain('🌅');
      expect(msg).toContain('5 tasks completed');
    });
  });

  // === Cleanup ===

  describe('stop()', () => {
    it('should clear pending approvals', () => {
      client._pending_approvals.set('test', () => {});
      client.stop();
      expect(client._pending_approvals.size).toBe(0);
    });
  });
});
