// Safe fire-and-forget utility — logs failures to Slack instead of silently swallowing
// Prevents the "silent failure accumulation" anti-pattern where errors go unnoticed.
// Usage: safe_fire_forget(promise, 'context label', router)
// If no router is provided, falls back to console.warn (still better than empty catch)

import type { NotificationRouter } from '../notification/router.js';
import { sanitize_text } from '../gateway/sanitizer.js';

export type SafeFireForgetConfig = {
  router?: NotificationRouter | null;
  // Maximum number of alerts per context per hour (prevent alert storms)
  max_alerts_per_hour?: number;
};

// Track alert counts to prevent flooding
const alert_counts = new Map<string, { count: number; reset_at: number }>();
const DEFAULT_MAX_ALERTS_PER_HOUR = 5;

const is_rate_limited = (context: string, max: number): boolean => {
  const now = Date.now();
  const entry = alert_counts.get(context);

  if (!entry || now > entry.reset_at) {
    alert_counts.set(context, { count: 1, reset_at: now + 3_600_000 });
    return false;
  }

  if (entry.count >= max) return true;
  entry.count++;
  return false;
};

// Fire-and-forget with Slack alerting on failure
export const safe_fire_forget = (
  promise: Promise<unknown>,
  context: string,
  config: SafeFireForgetConfig = {},
): void => {
  const { router, max_alerts_per_hour = DEFAULT_MAX_ALERTS_PER_HOUR } = config;

  promise.catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    const log_msg = `[FireForget] ${context} failed: ${msg}`;

    // Always log to console
    console.warn(log_msg);

    // Send Slack alert if router available and not rate-limited
    // Sanitize error message to prevent PII leaking into Slack (e.g., API responses, user data in stack traces)
    if (router && !is_rate_limited(context, max_alerts_per_hour)) {
      const safe_msg = sanitize_text(msg);
      router.route({
        type: 'alert',
        message: `⚠️ *[Silent Failure]* ${context}\n\`${safe_msg}\``,
        device: 'captain',
        severity: 'medium',
      }).catch(() => {
        // Last resort: if even Slack fails, just console.error
        console.error(`[FireForget] Failed to send alert for: ${context}`);
      });
    }
  });
};

// Reset rate limit counters (for testing)
export const reset_rate_limits = (): void => {
  alert_counts.clear();
};
