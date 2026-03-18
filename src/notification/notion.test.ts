// TDD tests for Notion notification module
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_notion_client } from './notion.js';
import type { NotionConfig } from './notion.js';
import type { NotificationEvent } from '../shared/types.js';

// Mock @notionhq/client
vi.mock('@notionhq/client', () => {
  const MockClient = vi.fn(function (this: Record<string, unknown>) {
    this.pages = {
      create: vi.fn().mockResolvedValue({
        id: 'page-id-123',
        url: 'https://notion.so/page-id-123',
      }),
    };
  });
  return { Client: MockClient };
});

const TEST_CONFIG: NotionConfig = {
  api_key: 'test-notion-key',
  database_id: 'db-main-123',
  reports_db_id: 'db-reports-456',
};

const TEST_EVENT: NotificationEvent = {
  type: 'milestone',
  message: 'Gateway server deployed successfully',
  device: 'captain',
  severity: 'low',
};

describe('Notion Client', () => {
  let client: ReturnType<typeof create_notion_client>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = create_notion_client(TEST_CONFIG);
  });

  // === send_notification() tests ===

  describe('send_notification()', () => {
    it('should create a page in the notification database', async () => {
      // Given: a notification event
      const event: NotificationEvent = { ...TEST_EVENT };

      // When: send_notification is called
      const result = await client.send_notification(event);

      // Then: page is created with correct properties
      expect(result.page_id).toBe('page-id-123');
      expect(result.url).toBe('https://notion.so/page-id-123');
      expect(client._client.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { database_id: 'db-main-123' },
        }),
      );
    });

    it('should include metadata as code block when provided', async () => {
      // Given: event with metadata
      const event: NotificationEvent = {
        ...TEST_EVENT,
        metadata: { task_id: 'task_001', files: ['a.ts'] },
      };

      // When: send_notification is called
      await client.send_notification(event);

      // Then: create was called with children including code block
      const call_args = vi.mocked(client._client.pages.create).mock.calls[0][0];
      const children = (call_args as Record<string, unknown>).children as unknown[];
      expect(children.length).toBe(2); // paragraph + code block
    });

    it('should map severity to correct emoji', async () => {
      // Given: critical event
      const event: NotificationEvent = { ...TEST_EVENT, severity: 'critical' };

      // When: send_notification is called
      await client.send_notification(event);

      // Then: title contains red emoji
      const call_args = vi.mocked(client._client.pages.create).mock.calls[0][0];
      const properties = (call_args as Record<string, unknown>).properties as Record<string, unknown>;
      const name = properties.Name as { title: Array<{ text: { content: string } }> };
      expect(name.title[0].text.content).toContain('🔴');
    });

    it('should retry on failure with exponential backoff', async () => {
      // Given: first two attempts fail, third succeeds
      vi.mocked(client._client.pages.create)
        .mockRejectedValueOnce(new Error('API error'))
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce({ id: 'retry-page', url: 'https://notion.so/retry' } as never);

      // When: send_notification is called
      const result = await client.send_notification(TEST_EVENT);

      // Then: succeeds on third attempt
      expect(result.page_id).toBe('retry-page');
      expect(client._client.pages.create).toHaveBeenCalledTimes(3);
    });

    it('should throw FASError after all retries exhausted', async () => {
      // Given: all attempts fail
      vi.mocked(client._client.pages.create)
        .mockRejectedValue(new Error('Persistent API error'));

      // When/Then: throws FASError
      await expect(client.send_notification(TEST_EVENT)).rejects.toThrow('Notion notification failed');
    });
  });

  // === send_with_result() tests ===

  describe('send_with_result()', () => {
    it('should return success result on successful send', async () => {
      // Given: normal event
      // When: send_with_result is called
      const result = await client.send_with_result(TEST_EVENT);

      // Then: returns success
      expect(result.channel).toBe('notion');
      expect(result.success).toBe(true);
    });

    it('should return failure result when all retries exhausted', async () => {
      // Given: all attempts fail
      vi.mocked(client._client.pages.create)
        .mockRejectedValue(new Error('API error'));

      // When: send_with_result is called
      const result = await client.send_with_result(TEST_EVENT);

      // Then: returns failure without throwing
      expect(result.channel).toBe('notion');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // === create_page() tests ===

  describe('create_page()', () => {
    it('should create a report page in reports database', async () => {
      // Given: report parameters
      const params = {
        title: 'Daily Report 2026-03-18',
        content: 'Today we completed 5 tasks...',
      };

      // When: create_page is called
      const result = await client.create_page(params);

      // Then: page is created in reports database
      expect(result.page_id).toBe('page-id-123');
      expect(client._client.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { database_id: 'db-reports-456' },
        }),
      );
    });

    it('should use custom database_id when provided', async () => {
      // Given: custom database_id
      const params = {
        title: 'Custom Report',
        content: 'Content',
        database_id: 'db-custom-789',
      };

      // When: create_page is called
      await client.create_page(params);

      // Then: uses custom database
      expect(client._client.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { database_id: 'db-custom-789' },
        }),
      );
    });

    it('should split long content into multiple blocks', async () => {
      // Given: content longer than 2000 chars
      const long_content = 'A'.repeat(4500);
      const params = { title: 'Long Report', content: long_content };

      // When: create_page is called
      await client.create_page(params);

      // Then: content is split into multiple paragraph blocks
      const call_args = vi.mocked(client._client.pages.create).mock.calls[0][0];
      const children = (call_args as Record<string, unknown>).children as unknown[];
      expect(children.length).toBeGreaterThan(1);
    });
  });

  // === create_daily_briefing() tests ===

  describe('create_daily_briefing()', () => {
    it('should create a briefing page with sections', async () => {
      // Given: briefing sections
      const params = {
        date: '2026-03-18',
        sections: [
          { title: 'Overnight Work', content: '3 crawl tasks completed' },
          { title: 'Pending Approvals', content: 'None' },
        ],
      };

      // When: create_daily_briefing is called
      const result = await client.create_daily_briefing(params);

      // Then: page is created with heading + paragraph per section
      expect(result.page_id).toBe('page-id-123');
      const call_args = vi.mocked(client._client.pages.create).mock.calls[0][0];
      const children = (call_args as Record<string, unknown>).children as unknown[];
      // 2 sections × (1 heading + 1 paragraph) = 4 blocks
      expect(children.length).toBe(4);
    });

    it('should use reports database for briefings', async () => {
      // Given: briefing params
      const params = {
        date: '2026-03-18',
        sections: [{ title: 'Summary', content: 'All good' }],
      };

      // When: create_daily_briefing is called
      await client.create_daily_briefing(params);

      // Then: uses reports database
      expect(client._client.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { database_id: 'db-reports-456' },
        }),
      );
    });

    it('should include date in title', async () => {
      // Given: specific date
      const params = {
        date: '2026-03-18',
        sections: [{ title: 'Test', content: 'Test' }],
      };

      // When: create_daily_briefing is called
      await client.create_daily_briefing(params);

      // Then: title includes the date
      const call_args = vi.mocked(client._client.pages.create).mock.calls[0][0];
      const properties = (call_args as Record<string, unknown>).properties as Record<string, unknown>;
      const name = properties.Name as { title: Array<{ text: { content: string } }> };
      expect(name.title[0].text.content).toContain('2026-03-18');
    });
  });
});
