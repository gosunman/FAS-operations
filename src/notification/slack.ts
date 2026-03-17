// Slack notification module for FAS
// Handles: agent logs, approvals, reports, crawl results, alerts

import { WebClient } from '@slack/web-api';
import type {
  SlackChannel,
  NotificationEvent,
  NotificationEventType,
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
  crawl_result: '#crawl-results',
  approval_mid: '#approvals',
  approval_high: '#approvals',
  academy: '#academy',
  alert: '#alerts',
  briefing: '#fas-general',
  milestone: '#fas-general',
  done: '#captain-logs',
  blocked: '#alerts',
  error: '#alerts',
};

// === Slack Client ===

export const create_slack_client = (config: SlackConfig) => {
  const web = new WebClient(config.token);

  // === Send message to a specific channel ===
  const send = async (
    channel: SlackChannel,
    text: string,
    blocks?: unknown[],
  ): Promise<boolean> => {
    try {
      await web.chat.postMessage({
        channel,
        text,
        blocks: blocks as never[],
      });
      return true;
    } catch (error) {
      console.error(`[Slack] Failed to send to ${channel}:`, error);
      return false;
    }
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
