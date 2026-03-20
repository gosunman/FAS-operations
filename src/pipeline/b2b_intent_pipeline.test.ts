import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_b2b_intent_pipeline } from './b2b_intent_pipeline.js';
import type { B2BIntentData } from '../shared/types.js';

// Mock global fetch
const mock_fetch = vi.fn();
vi.stubGlobal('fetch', mock_fetch);

const DEFAULT_CONFIG = {
  clay_webhook_url: 'https://api.clay.com/webhook/test-123',
};

const CRAWL4AI_SUCCESS = {
  ok: true,
  json: async () => ({ result: { markdown: '# Content\nSome B2B intent data here' } }),
};

const make_openclaw_response = (data: Partial<B2BIntentData> = {}) => ({
  ok: true,
  json: async () => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            domain: data.domain ?? 'example.com',
            extracted_intent: data.extracted_intent ?? 'Looking for automation tools',
            ai_cold_email_draft: data.ai_cold_email_draft ?? 'Hi, we noticed your interest in automation.',
          }),
        },
      },
    ],
  }),
});

const CLAY_SUCCESS = { ok: true, json: async () => ({}) };

describe('B2B Intent Pipeline', () => {
  beforeEach(() => {
    mock_fetch.mockReset();
  });

  // 1. Crawl4AI endpoint called with correct URL
  it('calls Crawl4AI endpoint with the correct target URL', async () => {
    mock_fetch
      .mockResolvedValueOnce(CRAWL4AI_SUCCESS)
      .mockResolvedValueOnce(make_openclaw_response());

    const pipeline = create_b2b_intent_pipeline(DEFAULT_CONFIG);
    await pipeline.process_intent_crawl('https://target.com');

    expect(mock_fetch).toHaveBeenCalledWith(
      'http://localhost:11235/crawl',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('https://target.com'),
      }),
    );
  });

  // 2. Valid B2BIntentData structure returned
  it('returns valid B2BIntentData structure from process_intent_crawl', async () => {
    mock_fetch
      .mockResolvedValueOnce(CRAWL4AI_SUCCESS)
      .mockResolvedValueOnce(make_openclaw_response({
        domain: 'test.com',
        extracted_intent: 'Needs CRM',
        ai_cold_email_draft: 'Hello, we can help with CRM.',
      }));

    const pipeline = create_b2b_intent_pipeline(DEFAULT_CONFIG);
    const result = await pipeline.process_intent_crawl('https://test.com');

    expect(result).toEqual(expect.objectContaining({
      domain: 'test.com',
      extracted_intent: 'Needs CRM',
      ai_cold_email_draft: 'Hello, we can help with CRM.',
    }));
    expect(result.crawled_timestamp).toBeDefined();
    expect(new Date(result.crawled_timestamp).toISOString()).toBe(result.crawled_timestamp);
  });

  // 3. Clay webhook POST called correctly
  it('POSTs data to Clay webhook URL correctly', async () => {
    mock_fetch.mockResolvedValueOnce(CLAY_SUCCESS);

    const pipeline = create_b2b_intent_pipeline(DEFAULT_CONFIG);
    const data: B2BIntentData = {
      domain: 'example.com',
      extracted_intent: 'Looking for tools',
      ai_cold_email_draft: 'Hi there!',
      crawled_timestamp: new Date().toISOString(),
    };
    const result = await pipeline.push_to_clay(data);

    expect(result).toBe(true);
    expect(mock_fetch).toHaveBeenCalledWith(
      'https://api.clay.com/webhook/test-123',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  // 4. Crawl4AI failure throws after retries
  it('throws after 3 retries when Crawl4AI fails', async () => {
    mock_fetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });

    const pipeline = create_b2b_intent_pipeline(DEFAULT_CONFIG);

    await expect(pipeline.process_intent_crawl('https://fail.com')).rejects.toThrow(/Crawl4AI/);
    // 3 retries = 3 fetch calls
    expect(mock_fetch).toHaveBeenCalledTimes(3);
  });

  // 5. OpenClaw non-JSON response throws
  it('throws when OpenClaw returns non-JSON content', async () => {
    mock_fetch
      .mockResolvedValueOnce(CRAWL4AI_SUCCESS)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'This is not valid JSON at all' } }],
        }),
      });

    const pipeline = create_b2b_intent_pipeline(DEFAULT_CONFIG);

    await expect(pipeline.process_intent_crawl('https://test.com')).rejects.toThrow(/JSON/i);
  });

  // 6. Clay 429 returns false
  it('returns false when Clay responds with 429 rate limit', async () => {
    mock_fetch.mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' });

    const pipeline = create_b2b_intent_pipeline(DEFAULT_CONFIG);
    const data: B2BIntentData = {
      domain: 'example.com',
      extracted_intent: 'intent',
      ai_cold_email_draft: 'draft',
      crawled_timestamp: new Date().toISOString(),
    };
    const result = await pipeline.push_to_clay(data);

    expect(result).toBe(false);
  });

  // 7. PII in email draft gets sanitized before Clay push
  it('sanitizes PII (phone number) in email draft before pushing to Clay', async () => {
    mock_fetch.mockResolvedValueOnce(CLAY_SUCCESS);

    const pipeline = create_b2b_intent_pipeline(DEFAULT_CONFIG);
    const data: B2BIntentData = {
      domain: 'example.com',
      extracted_intent: 'intent',
      ai_cold_email_draft: 'Call me at 010-1234-5678 for details.',
      crawled_timestamp: new Date().toISOString(),
    };
    await pipeline.push_to_clay(data);

    const call_body = JSON.parse(mock_fetch.mock.calls[0][1].body as string);
    expect(call_body.ai_cold_email_draft).toContain('[전화번호 제거됨]');
    expect(call_body.ai_cold_email_draft).not.toContain('010-1234-5678');
  });

  // 8. Empty markdown from Crawl4AI throws
  it('throws when Crawl4AI returns empty markdown', async () => {
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: { markdown: '' } }),
    });

    const pipeline = create_b2b_intent_pipeline(DEFAULT_CONFIG);

    await expect(pipeline.process_intent_crawl('https://empty.com')).rejects.toThrow(/empty/i);
  });

  // 9. Default config values work
  it('uses default config values for crawl4ai_url and openclaw_url', async () => {
    mock_fetch
      .mockResolvedValueOnce(CRAWL4AI_SUCCESS)
      .mockResolvedValueOnce(make_openclaw_response());

    const pipeline = create_b2b_intent_pipeline({ clay_webhook_url: 'https://clay.test' });
    await pipeline.process_intent_crawl('https://test.com');

    // First call = Crawl4AI (default URL)
    expect(mock_fetch.mock.calls[0][0]).toBe('http://localhost:11235/crawl');
    // Second call = OpenClaw (default URL)
    expect(mock_fetch.mock.calls[1][0]).toBe('http://localhost:3000/api/v1/chat/completions');
  });

  // 10. Full pipeline integration (crawl -> extract -> push, 3 fetch calls)
  it('runs full pipeline: crawl -> extract -> push with 3 fetch calls', async () => {
    mock_fetch
      .mockResolvedValueOnce(CRAWL4AI_SUCCESS)
      .mockResolvedValueOnce(make_openclaw_response({
        domain: 'full-test.com',
        extracted_intent: 'Full pipeline test',
        ai_cold_email_draft: 'Full pipeline email draft.',
      }))
      .mockResolvedValueOnce(CLAY_SUCCESS);

    const pipeline = create_b2b_intent_pipeline(DEFAULT_CONFIG);
    const intent_data = await pipeline.process_intent_crawl('https://full-test.com');
    const pushed = await pipeline.push_to_clay(intent_data);

    expect(intent_data.domain).toBe('full-test.com');
    expect(intent_data.extracted_intent).toBe('Full pipeline test');
    expect(pushed).toBe(true);
    expect(mock_fetch).toHaveBeenCalledTimes(3);
  });
});
