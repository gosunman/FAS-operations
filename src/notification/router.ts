// Unified notification router for FAS
// Routes events to Telegram, Slack, and Notion based on the routing matrix

import type { TelegramClient } from './telegram.js';
import type { SlackClient } from './slack.js';
import type { NotionClient } from './notion.js';
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
  notion: NotionClient | null;
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

    // Notion — send FIRST for crawl_result so we can include the URL in Slack
    let notion_url: string | undefined;
    if (rules.notion && deps.notion) {
      try {
        const notion_result = await deps.notion.send_with_result(event);
        results.notion = notion_result.success;
        if (notion_result.success && notion_result.url) {
          notion_url = notion_result.url;
        }
      } catch {
        // Fire-and-forget: Notion failure should never block notifications
        console.warn(`[Router] Notion send failed for ${event.type} — logged only`);
      }
    }

    // Slack — for crawl_result, send short summary + Notion link instead of raw content
    if (rules.slack && deps.slack) {
      if (event.type === 'crawl_result' && notion_url) {
        const summary = event.message.slice(0, 200).replace(/\n/g, ' ');
        const slack_text = `🔍 *[크롤링 완료]* ${summary}${event.message.length > 200 ? '…' : ''}\n📄 <${notion_url}|Notion에서 원문 보기>`;
        const channel = deps.slack.resolve_channel(event);
        results.slack = channel ? await deps.slack.send(channel, slack_text) : false;
      } else {
        results.slack = await deps.slack.route(event);
      }
    }

    // === Cross-channel fallback logic ===

    // Case 1: Both Telegram and Slack were supposed to send but both failed
    if (rules.telegram && !results.telegram && rules.slack && !results.slack) {
      console.warn(`[Router] Both Telegram and Slack failed for ${event.type} — critical notification lost`);
    }
    // Case 2: Telegram failed → fallback to Slack
    else if (rules.telegram && !results.telegram && deps.slack) {
      console.warn(`[Router] Telegram failed for ${event.type}, falling back to Slack`);
      results.slack = await deps.slack.send('#alerts', `[Telegram Fallback] ${event.message}`);
    }
    // Case 3: Slack failed → fallback to Telegram (includes slack-only events as emergency fallback)
    else if (rules.slack && !results.slack && deps.telegram) {
      if (rules.telegram) {
        // Dual-route event: normal Slack fallback via Telegram
        console.warn(`[Router] Slack failed for ${event.type}, falling back to Telegram`);
        const fallback = await deps.telegram.send(`[Slack Fallback] ${event.message}`, telegram_type);
        results.telegram = fallback.success;
      } else {
        // Slack-only event: log only, do NOT flood Telegram with non-critical events.
        // Only approval_high, alert, blocked, briefing should ever reach Telegram.
        console.warn(`[Router] Slack failed for slack-only event ${event.type} — logged only (no Telegram fallback)`);
      }
    }

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
