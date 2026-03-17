// Telegram Bot notification module for FAS
// Handles: urgent alerts, approval requests, morning briefings

import TelegramBot from 'node-telegram-bot-api';
import type { TelegramMessageType, TelegramSendResult, ApprovalResponse } from '../shared/types.js';

// === Configuration ===

export type TelegramConfig = {
  token: string;
  chat_id: string;
  polling?: boolean;
};

// === Telegram Client ===

export const create_telegram_client = (config: TelegramConfig) => {
  const bot = new TelegramBot(config.token, {
    polling: config.polling ?? false,
  });

  // Pending approval callbacks: request_id -> resolve function
  const pending_approvals = new Map<string, (approved: boolean) => void>();

  // Listen for inline keyboard callbacks (approval responses)
  if (config.polling) {
    bot.on('callback_query', (query) => {
      if (!query.data) return;

      // callback_data format: "approve:{request_id}" or "reject:{request_id}"
      const [action, request_id] = query.data.split(':');
      const resolver = pending_approvals.get(request_id);

      if (resolver) {
        resolver(action === 'approve');
        pending_approvals.delete(request_id);
        bot.answerCallbackQuery(query.id, {
          text: action === 'approve' ? '✅ 승인되었습니다' : '❌ 거부되었습니다',
        });
      } else {
        bot.answerCallbackQuery(query.id, {
          text: '⚠️ 이미 처리된 요청입니다',
        });
      }
    });
  }

  // === Send message ===
  const send = async (
    text: string,
    type: TelegramMessageType,
    request_id?: string,
  ): Promise<TelegramSendResult> => {
    try {
      // Build inline keyboard for approval messages
      const reply_markup = type === 'approval' && request_id
        ? {
            inline_keyboard: [[
              { text: '✅ 승인', callback_data: `approve:${request_id}` },
              { text: '❌ 거부', callback_data: `reject:${request_id}` },
            ]],
          }
        : undefined;

      const message = await bot.sendMessage(config.chat_id, text, {
        parse_mode: 'Markdown',
        reply_markup,
      });

      return { message_id: message.message_id, success: true };
    } catch (error) {
      console.error('[Telegram] Failed to send message:', error);
      return { message_id: 0, success: false };
    }
  };

  // === Wait for approval response ===
  const wait_for_approval = (
    request_id: string,
    timeout_ms: number | null,
  ): Promise<ApprovalResponse> => {
    return new Promise((resolve) => {
      // Register resolver for this request
      pending_approvals.set(request_id, (approved) => {
        resolve({
          approved,
          responded_by: 'human',
          responded_at: new Date().toISOString(),
        });
      });

      // Set timeout if specified
      if (timeout_ms !== null) {
        setTimeout(() => {
          if (pending_approvals.has(request_id)) {
            pending_approvals.delete(request_id);
            resolve(null); // timeout
          }
        }, timeout_ms);
      }
    });
  };

  // === Format helpers ===
  const format_approval_message = (
    request_id: string,
    action: string,
    detail: string,
    risk_level: string,
  ): string => {
    const emoji = risk_level === 'critical' ? '🔴' : '🟠';
    return [
      `${emoji} *승인 요청* [${risk_level.toUpperCase()}]`,
      '',
      `*행동:* ${action}`,
      `*상세:* ${detail}`,
      '',
      `ID: \`${request_id}\``,
    ].join('\n');
  };

  const format_alert = (message: string): string => {
    return `🚨 *FAS Alert*\n\n${message}`;
  };

  const format_briefing = (content: string): string => {
    return `🌅 *FAS 모닝 브리핑*\n\n${content}`;
  };

  // === Cleanup ===
  const stop = () => {
    if (config.polling) {
      bot.stopPolling();
    }
    pending_approvals.clear();
  };

  return {
    send,
    wait_for_approval,
    format_approval_message,
    format_alert,
    format_briefing,
    stop,
    // Expose for testing
    _bot: bot,
    _pending_approvals: pending_approvals,
  };
};

export type TelegramClient = ReturnType<typeof create_telegram_client>;
