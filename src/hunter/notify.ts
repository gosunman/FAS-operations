// Hunter notification module — sends alerts to owner via Telegram and Slack
// Uses separate bot tokens from captain (security isolation)
// Fire-and-forget pattern — notification failures never block task execution

// Hunter identity prefix for all messages
const HUNTER_PREFIX = '\u{1F441}\uFE0F';

export type HunterNotifyConfig = {
  telegram_bot_token?: string;   // Hunter's own Telegram bot
  telegram_chat_id?: string;     // Owner's chat ID (same as captain's)
  slack_webhook_url?: string;    // Hunter's own Slack webhook
};

export type HunterNotify = {
  send_telegram: (message: string) => Promise<boolean>;
  send_slack: (message: string) => Promise<boolean>;
  alert: (message: string) => Promise<void>;
  report: (message: string) => Promise<void>;
  is_configured: () => boolean;
};

export const create_hunter_notify = (config: HunterNotifyConfig): HunterNotify => {
  const has_telegram = Boolean(config.telegram_bot_token && config.telegram_chat_id);
  const has_slack = Boolean(config.slack_webhook_url);

  // Send a message via Telegram Bot API
  // Returns true on success, false on failure (never throws)
  const send_telegram = async (message: string): Promise<boolean> => {
    if (!has_telegram) return false;

    try {
      const url = `https://api.telegram.org/bot${config.telegram_bot_token}/sendMessage`;
      const prefixed = `${HUNTER_PREFIX} ${message}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegram_chat_id,
          text: prefixed,
          parse_mode: 'HTML',
        }),
      });

      return res.ok;
    } catch {
      // Fire-and-forget: silently swallow errors
      return false;
    }
  };

  // Send a message via Slack Incoming Webhook
  // Returns true on success, false on failure (never throws)
  const send_slack = async (message: string): Promise<boolean> => {
    if (!has_slack) return false;

    try {
      const prefixed = `${HUNTER_PREFIX} ${message}`;

      const res = await fetch(config.slack_webhook_url!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: prefixed }),
      });

      return res.ok;
    } catch {
      // Fire-and-forget: silently swallow errors
      return false;
    }
  };

  // Send to BOTH Telegram and Slack — used for critical alerts
  // [LOGIN_REQUIRED], [BLOCKED], critical errors
  const alert = async (message: string): Promise<void> => {
    await Promise.allSettled([
      send_telegram(message),
      send_slack(message),
    ]);
  };

  // Send to Slack only — used for routine reports
  // Task completion, status updates
  const report = async (message: string): Promise<void> => {
    await send_slack(message).catch(() => {});
  };

  // Returns true if at least one notification channel is configured
  const is_configured = (): boolean => has_telegram || has_slack;

  return { send_telegram, send_slack, alert, report, is_configured };
};
