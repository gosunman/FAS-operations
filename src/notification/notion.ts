// Notion notification module for FAS
// Handles: daily briefings, detailed reports, notification logging
// Notion is used for long-form content that doesn't fit Telegram/Slack

import { Client } from '@notionhq/client';
import { FASError } from '../shared/types.js';
import type { NotificationEvent, NotificationResult } from '../shared/types.js';

// === Configuration ===

export type NotionConfig = {
  api_key: string;
  database_id: string;         // Main notification log database
  reports_db_id?: string;      // Reports database (optional)
};

// === Local types (not in shared/types.ts to avoid cross-session conflict) ===

export type NotionPage = {
  page_id: string;
  url: string;
};

export type DailyBriefingSection = {
  title: string;
  content: string;
};

// === Constants ===

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// === Severity to emoji mapping ===

const SEVERITY_EMOJI: Record<string, string> = {
  low: '🟢',
  mid: '🟡',
  high: '🟠',
  critical: '🔴',
};

// === Notion Client Factory ===

export const create_notion_client = (config: NotionConfig) => {
  const client = new Client({ auth: config.api_key });

  // === Send notification event to Notion database ===
  const send_notification = async (event: NotificationEvent): Promise<NotionPage> => {
    const emoji = SEVERITY_EMOJI[event.severity ?? 'low'] ?? '⚪';

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Only use Name (title) property — other properties (Type, Device, etc.)
        // may not exist in all Notion databases. Keep it simple and resilient.
        const response = await client.pages.create({
          parent: { database_id: config.database_id },
          properties: {
            Name: {
              title: [{ text: { content: `${emoji} [${event.type.toUpperCase()}] ${event.message.slice(0, 100)}` } }],
            },
          },
          children: [
            {
              object: 'block' as const,
              type: 'paragraph' as const,
              paragraph: {
                rich_text: [{ type: 'text' as const, text: { content: event.message } }],
              },
            },
            ...(event.metadata ? [{
              object: 'block' as const,
              type: 'code' as const,
              code: {
                rich_text: [{ type: 'text' as const, text: { content: JSON.stringify(event.metadata, null, 2) } }],
                language: 'json' as const,
              },
            }] : []),
          ],
        });

        return {
          page_id: response.id,
          url: (response as Record<string, unknown>).url as string ?? '',
        };
      } catch (error) {
        console.error(`[Notion] Attempt ${attempt}/${MAX_RETRIES} failed:`, error);
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }

    throw new FASError(
      'NOTIFICATION_ERROR',
      `Notion notification failed after ${MAX_RETRIES} attempts`,
      502,
    );
  };

  // === Send with detailed result (compatible with NotificationResult) ===
  const send_with_result = async (event: NotificationEvent): Promise<NotificationResult> => {
    try {
      await send_notification(event);
      return { channel: 'notion', success: true, attempts: 1 };
    } catch {
      return {
        channel: 'notion',
        success: false,
        attempts: MAX_RETRIES,
        error: 'All retry attempts exhausted',
      };
    }
  };

  // === Create a full page (for reports) ===
  const create_page = async (params: {
    title: string;
    content: string;
    database_id?: string;
  }): Promise<NotionPage> => {
    const db_id = params.database_id ?? config.reports_db_id ?? config.database_id;

    // Split content into chunks of 2000 chars (Notion block limit)
    const chunks = split_content(params.content, 2000);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.pages.create({
          parent: { database_id: db_id },
          properties: {
            Name: {
              title: [{ text: { content: params.title } }],
            },
            Timestamp: {
              date: { start: new Date().toISOString() },
            },
          },
          children: chunks.map((chunk) => ({
            object: 'block' as const,
            type: 'paragraph' as const,
            paragraph: {
              rich_text: [{ type: 'text' as const, text: { content: chunk } }],
            },
          })),
        });

        return {
          page_id: response.id,
          url: (response as Record<string, unknown>).url as string ?? '',
        };
      } catch (error) {
        console.error(`[Notion] create_page attempt ${attempt}/${MAX_RETRIES} failed:`, error);
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }

    throw new FASError(
      'NOTIFICATION_ERROR',
      `Notion page creation failed after ${MAX_RETRIES} attempts`,
      502,
    );
  };

  // === Create daily briefing page ===
  const create_daily_briefing = async (params: {
    date: string;             // ISO date string (YYYY-MM-DD)
    sections: DailyBriefingSection[];
  }): Promise<NotionPage> => {
    const db_id = config.reports_db_id ?? config.database_id;

    const children = params.sections.flatMap((section) => [
      {
        object: 'block' as const,
        type: 'heading_2' as const,
        heading_2: {
          rich_text: [{ type: 'text' as const, text: { content: section.title } }],
        },
      },
      ...split_content(section.content, 2000).map((chunk) => ({
        object: 'block' as const,
        type: 'paragraph' as const,
        paragraph: {
          rich_text: [{ type: 'text' as const, text: { content: chunk } }],
        },
      })),
    ]);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.pages.create({
          parent: { database_id: db_id },
          properties: {
            Name: {
              title: [{ text: { content: `🌅 Daily Briefing — ${params.date}` } }],
            },
            Type: {
              select: { name: 'briefing' },
            },
            Timestamp: {
              date: { start: params.date },
            },
          },
          children,
        });

        return {
          page_id: response.id,
          url: (response as Record<string, unknown>).url as string ?? '',
        };
      } catch (error) {
        console.error(`[Notion] create_daily_briefing attempt ${attempt}/${MAX_RETRIES} failed:`, error);
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }

    throw new FASError(
      'NOTIFICATION_ERROR',
      `Notion daily briefing creation failed after ${MAX_RETRIES} attempts`,
      502,
    );
  };

  return {
    send_notification,
    send_with_result,
    create_page,
    create_daily_briefing,
    // Expose for testing
    _client: client,
  };
};

export type NotionClient = ReturnType<typeof create_notion_client>;

// === Helper: split long content into chunks ===

const split_content = (content: string, max_length: number): string[] => {
  if (content.length <= max_length) return [content];

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= max_length) {
      chunks.push(remaining);
      break;
    }

    // Try to split at newline boundary
    const cut_point = remaining.lastIndexOf('\n', max_length);
    const actual_cut = cut_point > 0 ? cut_point + 1 : max_length;

    chunks.push(remaining.slice(0, actual_cut));
    remaining = remaining.slice(actual_cut);
  }

  return chunks;
};
