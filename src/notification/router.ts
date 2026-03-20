// Unified notification router for FAS
// Routes events to Telegram, Slack, and Notion based on the routing matrix
// Phase 7-3: integrated with resilient_sender for network failure recovery

import type { TelegramClient } from './telegram.js';
import type { SlackClient } from './slack.js';
import type { NotionClient } from './notion.js';
import type { NotificationEvent, NotificationEventType, NotificationResult, TelegramMessageType, SlackChannel } from '../shared/types.js';
import type { ActivityHooks } from '../watchdog/activity_integration.js';
import { create_resilient_sender } from '../shared/resilient_sender.js';
import type { ResilientSender } from '../shared/resilient_sender.js';

// === Routing matrix: which channels receive which events ===

type RoutingRule = {
  telegram: boolean;
  slack: boolean;
  notion: boolean;
};

// Telegram: approval_high + discovery ONLY (워치 알림 최소화)
// Slack #fas-general: briefing, crawl summary — 알림 끄고 열어보기용
// Slack #alerts: alert, blocked, error — 알림 켜기 (진짜 문제만)
const ROUTING_MATRIX: Record<NotificationEventType, RoutingRule> = {
  briefing:      { telegram: false, slack: true,  notion: true  },
  agent_log:     { telegram: false, slack: true,  notion: false },
  approval_mid:  { telegram: false, slack: true,  notion: false },
  approval_high: { telegram: true,  slack: true,  notion: false },
  crawl_result:  { telegram: false, slack: true,  notion: true  },
  alert:         { telegram: false, slack: true,  notion: false },
  academy:       { telegram: false, slack: true,  notion: false },
  milestone:     { telegram: false, slack: true,  notion: false },
  done:          { telegram: false, slack: true,  notion: false },
  blocked:       { telegram: false, slack: true,  notion: false },
  error:         { telegram: false, slack: true,  notion: false },
  discovery:     { telegram: true,  slack: true,  notion: true  },
};

// === Resilient send payload types ===

type TelegramPayload = {
  message: string;
  type: TelegramMessageType;
};

type SlackRoutePayload = {
  kind: 'route';
  event: NotificationEvent;
};

type SlackSendPayload = {
  kind: 'send';
  channel: SlackChannel;
  text: string;
};

type SlackPayload = SlackRoutePayload | SlackSendPayload;

type NotionPayload = {
  event: NotificationEvent;
};

// === Router ===

export type NotificationRouterDeps = {
  telegram: TelegramClient | null;
  slack: SlackClient | null;
  notion: NotionClient | null;
  activity_hooks?: ActivityHooks | null;
  queue_dir?: string;  // optional: enable resilient sending with disk-backed queue
};

export type ResilientRouterConfig = {
  retry_interval_ms?: number;
  max_retry_count?: number;
};

export const create_notification_router = (
  deps: NotificationRouterDeps,
  config?: ResilientRouterConfig,
) => {
  // === Create resilient senders if queue_dir is provided ===

  let telegram_resilient: ResilientSender<TelegramPayload> | null = null;
  let slack_resilient: ResilientSender<SlackPayload> | null = null;
  let notion_resilient: ResilientSender<NotionPayload> | null = null;

  if (deps.queue_dir) {
    const base_config = {
      retry_interval_ms: config?.retry_interval_ms ?? 60_000,
      max_retry_count: config?.max_retry_count ?? 10,
    };

    if (deps.telegram) {
      const tg = deps.telegram;
      telegram_resilient = create_resilient_sender<TelegramPayload>(
        async (payload) => {
          const result = await tg.send(payload.message, payload.type);
          return result.success;
        },
        {
          queue_dir: `${deps.queue_dir}/telegram`,
          channel_name: 'telegram',
          ...base_config,
        },
      );
      telegram_resilient.start_retry_loop();
    }

    if (deps.slack) {
      const sl = deps.slack;
      slack_resilient = create_resilient_sender<SlackPayload>(
        async (payload) => {
          if (payload.kind === 'route') {
            return sl.route(payload.event);
          }
          return sl.send(payload.channel, payload.text);
        },
        {
          queue_dir: `${deps.queue_dir}/slack`,
          channel_name: 'slack',
          ...base_config,
        },
      );
      slack_resilient.start_retry_loop();
    }

    if (deps.notion) {
      const nt = deps.notion;
      notion_resilient = create_resilient_sender<NotionPayload>(
        async (payload) => {
          const result = await nt.send_with_result(payload.event);
          return result.success;
        },
        {
          queue_dir: `${deps.queue_dir}/notion`,
          channel_name: 'notion',
          ...base_config,
        },
      );
      notion_resilient.start_retry_loop();
    }
  }

  // === Channel send helpers (resilient when queue_dir is set, direct otherwise) ===

  // Telegram: returns success boolean
  const send_telegram = async (message: string, type: TelegramMessageType): Promise<boolean> => {
    if (!deps.telegram) return false;
    if (telegram_resilient) {
      return telegram_resilient.send({ message, type });
    }
    const result = await deps.telegram.send(message, type);
    return result.success;
  };

  // Slack route: routes event via slack.route()
  const send_slack_route = async (event: NotificationEvent): Promise<boolean> => {
    if (!deps.slack) return false;
    if (slack_resilient) {
      return slack_resilient.send({ kind: 'route', event });
    }
    return deps.slack.route(event);
  };

  // Slack send: sends to a specific channel
  const send_slack = async (channel: SlackChannel, text: string): Promise<boolean> => {
    if (!deps.slack) return false;
    if (slack_resilient) {
      return slack_resilient.send({ kind: 'send', channel, text });
    }
    return deps.slack.send(channel, text);
  };

  // Notion: try direct send for URL extraction, queue on failure
  // Unlike Telegram/Slack, Notion needs special handling because we extract
  // the page URL from the result to embed in the Slack message (crawl_result flow).
  // On failure, the resilient sender queues for background retry.
  const send_notion = async (event: NotificationEvent): Promise<NotificationResult | null> => {
    if (!deps.notion) return null;
    try {
      const result = await deps.notion.send_with_result(event);
      if (result.success) return result;
      // Direct send returned success=false — queue for retry if resilient
      if (notion_resilient) {
        // fire-and-forget: resilient sender will retry in background
        void notion_resilient.send({ event });
      }
      return result;
    } catch (err) {
      // Exception path: queue for retry if resilient sender is available
      if (notion_resilient) {
        void notion_resilient.send({ event });
      }
      const err_msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Router] Notion send failed for ${event.type} — ${notion_resilient ? 'queued for retry' : 'logged only'}`);
      return { channel: 'notion', success: false, attempts: 1, error: err_msg };
    }
  };

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
      results.telegram = await send_telegram(event.message, telegram_type);
      deps.activity_hooks?.log_notification_sent('telegram', event.type, results.telegram);
    }

    // Notion — send FIRST for crawl_result so we can include the URL in Slack
    let notion_url: string | undefined;
    if (rules.notion && deps.notion) {
      const notion_result = await send_notion(event);
      if (notion_result) {
        results.notion = notion_result.success;
        deps.activity_hooks?.log_notification_sent('notion', event.type, notion_result.success, notion_result.error);
        if (notion_result.success && notion_result.url) {
          notion_url = notion_result.url;
        }
      }
    }

    // Slack — for crawl_result, send short summary + Notion link instead of raw content
    if (rules.slack && deps.slack) {
      if (event.type === 'crawl_result' && notion_url) {
        const summary = event.message.slice(0, 200).replace(/\n/g, ' ');
        const slack_text = `🔍 *[크롤링 완료]* ${summary}${event.message.length > 200 ? '…' : ''}\n📄 <${notion_url}|Notion에서 원문 보기>`;
        const channel = deps.slack.resolve_channel(event);
        results.slack = channel ? await send_slack(channel, slack_text) : false;
      } else {
        results.slack = await send_slack_route(event);
      }
      deps.activity_hooks?.log_notification_sent('slack', event.type, results.slack);
    }

    // === Cross-channel fallback logic ===

    // Case 1: Both Telegram and Slack were supposed to send but both failed
    if (rules.telegram && !results.telegram && rules.slack && !results.slack) {
      console.warn(`[Router] Both Telegram and Slack failed for ${event.type} — critical notification lost`);
    }
    // Case 2: Telegram failed → fallback to Slack
    else if (rules.telegram && !results.telegram && deps.slack) {
      console.warn(`[Router] Telegram failed for ${event.type}, falling back to Slack`);
      results.slack = await send_slack('#alerts', `[Telegram Fallback] ${event.message}`);
    }
    // Case 3: Slack failed → fallback to Telegram (includes slack-only events as emergency fallback)
    else if (rules.slack && !results.slack && deps.telegram) {
      if (rules.telegram) {
        // Dual-route event: normal Slack fallback via Telegram
        console.warn(`[Router] Slack failed for ${event.type}, falling back to Telegram`);
        results.telegram = await send_telegram(`[Slack Fallback] ${event.message}`, telegram_type);
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

  // === Stop all retry loops (cleanup) ===
  const stop = (): void => {
    telegram_resilient?.stop_retry_loop();
    slack_resilient?.stop_retry_loop();
    notion_resilient?.stop_retry_loop();
  };

  // === Get queue sizes for monitoring ===
  const get_queue_sizes = (): { telegram: number; slack: number; notion: number } => ({
    telegram: telegram_resilient?.queue_size() ?? 0,
    slack: slack_resilient?.queue_size() ?? 0,
    notion: notion_resilient?.queue_size() ?? 0,
  });

  return {
    route,
    get_rules,
    stop,
    get_queue_sizes,
  };
};

export type NotificationRouter = ReturnType<typeof create_notification_router>;
