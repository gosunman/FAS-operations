// Google Messages web automation for parent SMS sending
// Uses Playwright to automate messages.google.com — requires Google account login
// Designed for captain-side execution with persistent Chrome profile (cookie-based login)
//
// Flow: generate_parent_message() → send via Google Messages web
// Requires: phone paired with Google Messages on web (messages.google.com)
//
// This module provides two layers:
// 1. Pure functions for message formatting + validation (testable without browser)
// 2. Browser automation functions (integration test only)

import type { ParentMessage } from './parent_message.js';

// === Types ===

export type SmsRecipient = {
  name: string;
  phone: string;   // Korean format: 010-XXXX-XXXX or 01XXXXXXXXX
};

export type SmsSendResult = {
  success: boolean;
  recipient: SmsRecipient;
  message_preview: string;  // first 50 chars
  sent_at?: string;         // ISO 8601
  error?: string;
};

export type SmsBatchResult = {
  total: number;
  sent: number;
  failed: number;
  results: SmsSendResult[];
};

export type GoogleMessagesConfig = {
  profile_dir?: string;         // Chrome profile dir for persistent login
  send_delay_ms?: number;       // Delay between messages (anti-spam). Default: 3000
  dry_run?: boolean;            // If true, don't actually send (for testing). Default: false
  headless?: boolean;           // Default: false (Google blocks headless)
  timeout_ms?: number;          // Navigation timeout. Default: 15000
};

// === Constants ===

const MESSAGES_URL = 'https://messages.google.com/web/conversations';
const DEFAULT_SEND_DELAY_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 15_000;

// Korean phone number patterns
const PHONE_PATTERN = /^01[016789]-?\d{3,4}-?\d{4}$/;

// === Pure functions (unit-testable) ===

// Normalize Korean phone number: remove dashes, validate format
export const normalize_phone = (phone: string): string | null => {
  const cleaned = phone.replace(/-/g, '').trim();
  if (!/^01[016789]\d{7,8}$/.test(cleaned)) return null;
  return cleaned;
};

// Validate a phone number
export const is_valid_phone = (phone: string): boolean => {
  return normalize_phone(phone) !== null;
};

// Format phone for display: 010-1234-5678
export const format_phone_display = (phone: string): string => {
  const cleaned = normalize_phone(phone);
  if (!cleaned) return phone;
  if (cleaned.length === 11) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  }
  // 10-digit (010-XXX-XXXX)
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
};

// Truncate message for SMS (max 2000 chars for long SMS, warn at 80 chars for standard)
export const truncate_for_sms = (text: string, max_length = 2000): { text: string; truncated: boolean } => {
  if (text.length <= max_length) return { text, truncated: false };
  return {
    text: text.slice(0, max_length - 3) + '...',
    truncated: true,
  };
};

// Build a send-ready SMS from ParentMessage + recipient
export const prepare_sms = (
  recipient: SmsRecipient,
  message: ParentMessage,
): { phone: string; text: string; preview: string } | { error: string } => {
  const phone = normalize_phone(recipient.phone);
  if (!phone) {
    return { error: `Invalid phone number: ${recipient.phone}` };
  }

  const { text, truncated } = truncate_for_sms(message.full_text);
  if (truncated) {
    console.warn(`[GoogleMessages] Message for ${recipient.name} truncated from ${message.full_text.length} to 2000 chars`);
  }

  return {
    phone,
    text,
    preview: text.slice(0, 50),
  };
};

// Validate batch recipients — returns valid + invalid lists
export const validate_recipients = (
  recipients: SmsRecipient[],
): { valid: SmsRecipient[]; invalid: Array<{ recipient: SmsRecipient; reason: string }> } => {
  const valid: SmsRecipient[] = [];
  const invalid: Array<{ recipient: SmsRecipient; reason: string }> = [];

  for (const r of recipients) {
    if (!r.name || r.name.trim().length === 0) {
      invalid.push({ recipient: r, reason: 'Empty name' });
    } else if (!is_valid_phone(r.phone)) {
      invalid.push({ recipient: r, reason: `Invalid phone: ${r.phone}` });
    } else {
      valid.push(r);
    }
  }

  return { valid, invalid };
};

// === Browser automation (integration-only) ===

// Create a Google Messages sender using Playwright persistent profile
// Requires: messages.google.com already paired with phone (QR code scan done manually)
export const create_google_messages_sender = (config: GoogleMessagesConfig = {}) => {
  const {
    profile_dir = `${process.env.HOME}/.fas/chrome-profiles/google-messages`,
    send_delay_ms = DEFAULT_SEND_DELAY_MS,
    dry_run = false,
    headless = false,
    timeout_ms = DEFAULT_TIMEOUT_MS,
  } = config;

  // Lazy-loaded Playwright — avoid import at module level for unit test compat
  let _playwright: typeof import('playwright') | null = null;
  let _context: import('playwright').BrowserContext | null = null;

  const get_playwright = async () => {
    if (!_playwright) {
      _playwright = await import('playwright');
    }
    return _playwright;
  };

  const get_context = async () => {
    if (_context) return _context;
    const pw = await get_playwright();
    _context = await pw.chromium.launchPersistentContext(profile_dir, {
      headless,
      channel: 'chrome',
      args: ['--disable-blink-features=AutomationControlled'],
    });
    return _context;
  };

  // Navigate to Google Messages and wait for conversation list
  const ensure_ready = async (page: import('playwright').Page): Promise<boolean> => {
    try {
      // Check if already on messages page
      if (!page.url().includes('messages.google.com')) {
        await page.goto(MESSAGES_URL, { waitUntil: 'domcontentloaded', timeout: timeout_ms });
      }

      // Wait for the "Start chat" or conversation list to appear
      // This indicates the page is paired and ready
      await page.waitForSelector('[data-e2e-start-button], mws-conversations-list', {
        timeout: timeout_ms,
      });

      return true;
    } catch {
      return false;
    }
  };

  // Send a single SMS via Google Messages web interface
  const send_sms = async (phone: string, text: string): Promise<SmsSendResult> => {
    const recipient: SmsRecipient = { name: phone, phone };

    if (dry_run) {
      return {
        success: true,
        recipient,
        message_preview: text.slice(0, 50),
        sent_at: new Date().toISOString(),
      };
    }

    try {
      const context = await get_context();
      const page = context.pages()[0] ?? await context.newPage();
      page.setDefaultTimeout(timeout_ms);

      const ready = await ensure_ready(page);
      if (!ready) {
        return {
          success: false,
          recipient,
          message_preview: text.slice(0, 50),
          error: 'Google Messages not ready — check if phone is paired',
        };
      }

      // Click "Start chat" button
      await page.click('[data-e2e-start-button], [aria-label="Start chat"]');

      // Type phone number in the "To" field
      const to_input = await page.waitForSelector('input[aria-label="Type a name, phone number, or email"], input[type="text"]');
      if (!to_input) throw new Error('Could not find recipient input');
      await to_input.fill(phone);

      // Wait for contact suggestion to appear and click first result, or press Enter
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);

      // Type message in the compose area
      const compose = await page.waitForSelector('[data-e2e-message-input-field], [contenteditable="true"][aria-label*="message"]');
      if (!compose) throw new Error('Could not find message compose field');
      await compose.fill(text);

      // Click send button
      await page.click('[data-e2e-send-button], [aria-label="Send SMS message"]');

      // Wait for message to appear in conversation
      await page.waitForTimeout(2000);

      return {
        success: true,
        recipient,
        message_preview: text.slice(0, 50),
        sent_at: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        recipient,
        message_preview: text.slice(0, 50),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  // Send SMS to multiple recipients with delay between sends
  const send_batch = async (
    messages: Array<{ recipient: SmsRecipient; message: ParentMessage }>,
  ): Promise<SmsBatchResult> => {
    const results: SmsSendResult[] = [];

    for (let i = 0; i < messages.length; i++) {
      const { recipient, message } = messages[i];
      const prepared = prepare_sms(recipient, message);

      if ('error' in prepared) {
        results.push({
          success: false,
          recipient,
          message_preview: message.full_text.slice(0, 50),
          error: prepared.error,
        });
        continue;
      }

      const result = await send_sms(prepared.phone, prepared.text);
      result.recipient = recipient; // restore original recipient with name
      results.push(result);

      // Delay between messages (skip for last message)
      if (i < messages.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, send_delay_ms));
      }
    }

    return {
      total: messages.length,
      sent: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  };

  // Close browser context
  const close = async () => {
    try {
      if (_context) {
        await _context.close();
        _context = null;
      }
    } catch { /* ignore cleanup errors */ }
  };

  return {
    send_sms,
    send_batch,
    ensure_ready,
    close,
  };
};

// Export sender type
export type GoogleMessagesSender = ReturnType<typeof create_google_messages_sender>;
