// Unified notification router for FAS
// Routes events to Telegram, Slack, and Notion based on the routing matrix

import type { TelegramClient } from './telegram.js';
import type { SlackClient } from './slack.js';
import type { NotificationEvent, NotificationEventType, NotificationResult } from '../shared/types.js';

// === Routing matrix: which channels receive which events ===

type RoutingRule = {
  telegram: boolean;
  slack: boolean;
  notion: boolean;
};

const ROUTING_MATRIX: Record<NotificationEventType, RoutingRule> = {
  briefing:      { telegram: true,  slack: true,  notion: true  },
  agent_log:     { telegram: false, slack: true,  notion: false },
  approval_mid:  { telegram: false, slack: true,  notion: false },
  approval_high: { telegram: true,  slack: true,  notion: false },
  crawl_result:  { telegram: false, slack: true,  notion: true  },
  alert:         { telegram: true,  slack: true,  notion: false },
  academy:       { telegram: false, slack: true,  notion: false },
  milestone:     { telegram: false, slack: true,  notion: false },
  done:          { telegram: false, slack: true,  notion: false },
  blocked:       { telegram: true,  slack: true,  notion: false },
  error:         { telegram: false, slack: true,  notion: false },
};

// === Router ===

export type NotificationRouterDeps = {
  telegram: TelegramClient | null;
  slack: SlackClient | null;
  // notion: NotionClient | null; // TODO: add in Phase 0-3 extension
};

export const create_notification_router = (deps: NotificationRouterDeps) => {
  // === Route a notification event to all configured channels ===
  const route = async (event: NotificationEvent): Promise<{
    telegram: boolean;
    slack: boolean;
    notion: boolean;
  }> => {
    const rules = ROUTING_MATRIX[event.type];
    if (!rules) {
      console.warn(`[Router] Unknown event type: ${event.type}`);
      return { telegram: false, slack: false, notion: false };
    }

    const results = {
      telegram: false,
      slack: false,
      notion: false,
    };

    const telegram_type = event.type === 'approval_high' ? 'approval' as const
      : event.type === 'alert' || event.type === 'blocked' ? 'alert' as const
      : event.type === 'briefing' ? 'briefing' as const
      : 'info' as const;

    // Telegram
    if (rules.telegram && deps.telegram) {
      const result = await deps.telegram.send(event.message, telegram_type);
      results.telegram = result.success;
    }

    // Slack
    if (rules.slack && deps.slack) {
      results.slack = await deps.slack.route(event);
    }

    // Fallback: Telegram failed → try Slack (for critical events)
    if (rules.telegram && !results.telegram && deps.slack && !results.slack) {
      console.warn(`[Router] Both Telegram and Slack failed for ${event.type} — critical notification lost`);
    } else if (rules.telegram && !results.telegram && deps.slack) {
      console.warn(`[Router] Telegram failed for ${event.type}, falling back to Slack`);
      results.slack = await deps.slack.send('#alerts', `[Telegram Fallback] ${event.message}`);
    } else if (rules.slack && !results.slack && deps.telegram) {
      // Fallback: Slack failed → try Telegram
      console.warn(`[Router] Slack failed for ${event.type}, falling back to Telegram`);
      const fallback = await deps.telegram.send(`[Slack Fallback] ${event.message}`, telegram_type);
      results.telegram = fallback.success;
    }

    // Notion — placeholder for future implementation
    // if (rules.notion && deps.notion) {
    //   results.notion = await deps.notion.create_page(event);
    // }

    return results;
  };

  // === Get routing rules for an event type ===
  const get_rules = (event_type: NotificationEventType): RoutingRule | null => {
    return ROUTING_MATRIX[event_type] ?? null;
  };

  return {
    route,
    get_rules,
  };
};

export type NotificationRouter = ReturnType<typeof create_notification_router>;
