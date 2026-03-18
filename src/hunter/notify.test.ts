// Tests for hunter notification module
// Uses mocked fetch to verify Telegram/Slack integration

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_hunter_notify, type HunterNotifyConfig } from './notify.js';

// Full config for most tests
const full_config: HunterNotifyConfig = {
  telegram_bot_token: 'test-bot-token',
  telegram_chat_id: '12345',
  slack_webhook_url: 'https://hooks.slack.com/services/T00/B00/xxx',
};

describe('create_hunter_notify', () => {
  let mock_fetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mock_fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mock_fetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- send_telegram ---

  describe('send_telegram', () => {
    it('should POST to Telegram API with prefixed message', async () => {
      // Given
      const notify = create_hunter_notify(full_config);

      // When
      const result = await notify.send_telegram('Test message');

      // Then
      expect(result).toBe(true);
      expect(mock_fetch).toHaveBeenCalledOnce();

      const [url, options] = mock_fetch.mock.calls[0];
      expect(url).toBe('https://api.telegram.org/bottest-bot-token/sendMessage');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body);
      expect(body.chat_id).toBe('12345');
      expect(body.text).toContain('\u{1F441}\uFE0F');
      expect(body.text).toContain('Test message');
      expect(body.parse_mode).toBe('HTML');
    });

    it('should return false when telegram is not configured', async () => {
      // Given
      const notify = create_hunter_notify({ slack_webhook_url: 'https://example.com' });

      // When
      const result = await notify.send_telegram('Test');

      // Then
      expect(result).toBe(false);
      expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('should return false when fetch fails', async () => {
      // Given
      mock_fetch.mockRejectedValue(new Error('Network error'));
      const notify = create_hunter_notify(full_config);

      // When
      const result = await notify.send_telegram('Test');

      // Then
      expect(result).toBe(false);
    });

    it('should return false when API returns non-ok', async () => {
      // Given
      mock_fetch.mockResolvedValue({ ok: false, status: 401 });
      const notify = create_hunter_notify(full_config);

      // When
      const result = await notify.send_telegram('Test');

      // Then
      expect(result).toBe(false);
    });
  });

  // --- send_slack ---

  describe('send_slack', () => {
    it('should POST to Slack webhook with prefixed message', async () => {
      // Given
      const notify = create_hunter_notify(full_config);

      // When
      const result = await notify.send_slack('Slack test');

      // Then
      expect(result).toBe(true);
      expect(mock_fetch).toHaveBeenCalledOnce();

      const [url, options] = mock_fetch.mock.calls[0];
      expect(url).toBe('https://hooks.slack.com/services/T00/B00/xxx');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body);
      expect(body.text).toContain('\u{1F441}\uFE0F');
      expect(body.text).toContain('Slack test');
    });

    it('should return false when slack is not configured', async () => {
      // Given
      const notify = create_hunter_notify({ telegram_bot_token: 'tok', telegram_chat_id: '123' });

      // When
      const result = await notify.send_slack('Test');

      // Then
      expect(result).toBe(false);
      expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('should return false when fetch rejects', async () => {
      // Given
      mock_fetch.mockRejectedValue(new Error('Connection refused'));
      const notify = create_hunter_notify(full_config);

      // When
      const result = await notify.send_slack('Test');

      // Then
      expect(result).toBe(false);
    });
  });

  // --- alert ---

  describe('alert', () => {
    it('should send to BOTH Telegram and Slack', async () => {
      // Given
      const notify = create_hunter_notify(full_config);

      // When
      await notify.alert('Critical error');

      // Then
      expect(mock_fetch).toHaveBeenCalledTimes(2);

      const urls = mock_fetch.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(urls).toContain('https://api.telegram.org/bottest-bot-token/sendMessage');
      expect(urls).toContain('https://hooks.slack.com/services/T00/B00/xxx');
    });

    it('should not throw even if both channels fail', async () => {
      // Given
      mock_fetch.mockRejectedValue(new Error('Everything broken'));
      const notify = create_hunter_notify(full_config);

      // When / Then — should not throw
      await expect(notify.alert('Test')).resolves.toBeUndefined();
    });
  });

  // --- report ---

  describe('report', () => {
    it('should send to Slack only', async () => {
      // Given
      const notify = create_hunter_notify(full_config);

      // When
      await notify.report('Task completed');

      // Then
      expect(mock_fetch).toHaveBeenCalledOnce();
      const [url] = mock_fetch.mock.calls[0];
      expect(url).toBe('https://hooks.slack.com/services/T00/B00/xxx');
    });

    it('should not throw when slack fails', async () => {
      // Given
      mock_fetch.mockRejectedValue(new Error('Slack down'));
      const notify = create_hunter_notify(full_config);

      // When / Then
      await expect(notify.report('Test')).resolves.toBeUndefined();
    });
  });

  // --- is_configured ---

  describe('is_configured', () => {
    it('should return true when telegram is configured', () => {
      const notify = create_hunter_notify({
        telegram_bot_token: 'tok',
        telegram_chat_id: '123',
      });
      expect(notify.is_configured()).toBe(true);
    });

    it('should return true when slack is configured', () => {
      const notify = create_hunter_notify({
        slack_webhook_url: 'https://hooks.slack.com/x',
      });
      expect(notify.is_configured()).toBe(true);
    });

    it('should return true when both are configured', () => {
      const notify = create_hunter_notify(full_config);
      expect(notify.is_configured()).toBe(true);
    });

    it('should return false when no tokens are set', () => {
      const notify = create_hunter_notify({});
      expect(notify.is_configured()).toBe(false);
    });

    it('should return false when only partial telegram config', () => {
      // Only token, no chat_id — telegram not usable
      const notify = create_hunter_notify({ telegram_bot_token: 'tok' });
      expect(notify.is_configured()).toBe(false);
    });
  });
});
