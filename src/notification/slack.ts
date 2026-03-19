// Slack notification module for FAS
// Handles: agent logs, approvals, reports, crawl results, alerts

import { WebClient } from '@slack/web-api';
import type {
  SlackChannel,
  NotificationEvent,
  NotificationEventType,
  NotificationResult,
} from '../shared/types.js';

// === Configuration ===

export type SlackConfig = {
  token: string;
};

// === Channel routing map ===
// Maps event types to their target Slack channels

const CHANNEL_ROUTING: Record<NotificationEventType, SlackChannel | ((event: NotificationEvent) => SlackChannel)> = {
  agent_log: (event) =>
    event.device === 'captain' ? '#captain-logs' : '#hunter-logs',
  crawl_result: '#fas-general',
  approval_mid: '#approvals',
  approval_high: '#approvals',
  academy: '#academy',
  alert: '#alerts',
  briefing: '#fas-general',
  milestone: '#fas-general',
  done: '#captain-logs',
  blocked: '#alerts',
  error: '#alerts',
  discovery: '#fas-general',
};

// === Slack Client ===

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const create_slack_client = (config: SlackConfig) => {
  const web = new WebClient(config.token);

  // === Send message with retry (exponential backoff, max 3 attempts) ===
  const send = async (
    channel: SlackChannel,
    text: string,
    blocks?: unknown[],
  ): Promise<boolean> => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await web.chat.postMessage({
          channel,
          text,
          blocks: blocks as never[],
        });
        return true;
      } catch (error) {
        console.error(`[Slack] Attempt ${attempt}/${MAX_RETRIES} failed for ${channel}:`, error);
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }
    console.error(`[Slack] All ${MAX_RETRIES} attempts exhausted for ${channel}`);
    return false;
  };

  // === Send with retry returning detailed result ===
  const send_with_result = async (
    channel: SlackChannel,
    text: string,
    blocks?: unknown[],
  ): Promise<NotificationResult> => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await web.chat.postMessage({
          channel,
          text,
          blocks: blocks as never[],
        });
        return { channel: 'slack', success: true, attempts: attempt };
      } catch (error) {
        console.error(`[Slack] Attempt ${attempt}/${MAX_RETRIES} failed for ${channel}:`, error);
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }
    return { channel: 'slack', success: false, attempts: MAX_RETRIES, error: 'All retry attempts exhausted' };
  };

  // === Route notification to the correct channel ===
  const route = async (event: NotificationEvent): Promise<boolean> => {
    const routing = CHANNEL_ROUTING[event.type];
    if (!routing) {
      console.warn(`[Slack] No routing for event type: ${event.type}`);
      return false;
    }

    const channel = typeof routing === 'function' ? routing(event) : routing;
    return send(channel, event.message);
  };

  // === Resolve the channel for a given event ===
  const resolve_channel = (event: NotificationEvent): SlackChannel | null => {
    const routing = CHANNEL_ROUTING[event.type];
    if (!routing) return null;
    return typeof routing === 'function' ? routing(event) : routing;
  };

  // === Format helpers ===

  const format_milestone = (description: string): string => {
    return `✅ *[MILESTONE]* ${description}`;
  };

  const format_done = (description: string): string => {
    return `🎉 *[DONE]* ${description}`;
  };

  const format_blocked = (description: string): string => {
    return `🚫 *[BLOCKED]* ${description}`;
  };

  const format_error = (description: string): string => {
    return `⚠️ *[ERROR]* ${description}`;
  };

  return {
    send,
    send_with_result,
    route,
    resolve_channel,
    format_milestone,
    format_done,
    format_blocked,
    format_error,
    // Expose for testing
    _web: web,
  };
};

export type SlackClient = ReturnType<typeof create_slack_client>;
