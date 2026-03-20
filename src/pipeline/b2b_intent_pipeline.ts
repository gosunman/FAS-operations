// B2B Intent Pipeline — Crawl4AI + OpenClaw + Clay.com webhook
// Crawls target domains, extracts B2B intent via OpenClaw LLM, pushes to Clay.com for outreach.
// PII is sanitized via sanitize_text before any external push.

import type { B2BIntentData } from '../shared/types.js';
import { sanitize_text } from '../gateway/sanitizer.js';

// === Config type ===

export type B2BPipelineConfig = {
  crawl4ai_url?: string;   // default http://localhost:11235/crawl
  clay_webhook_url: string;
  openclaw_url?: string;   // default http://localhost:3000/api/v1/chat/completions
};

// === Default values ===

const DEFAULT_CRAWL4AI_URL = 'http://localhost:11235/crawl';
const DEFAULT_OPENCLAW_URL = 'http://localhost:3000/api/v1/chat/completions';

// === Retry helper with exponential backoff ===

const retry_fetch = async (
  url: string,
  options: RequestInit,
  max_retries: number = 3,
): Promise<Response> => {
  for (let attempt = 1; attempt <= max_retries; attempt++) {
    const response = await fetch(url, options);
    if (response.ok) return response;

    if (attempt < max_retries) {
      // Exponential backoff: 100ms, 200ms, 400ms...
      const delay = 100 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } else {
      throw new Error(`Crawl4AI request failed after ${max_retries} retries: ${response.status} ${response.statusText}`);
    }
  }
  // Unreachable, but TypeScript needs this
  throw new Error('Crawl4AI request failed');
};

// === Factory function ===

export const create_b2b_intent_pipeline = (config: B2BPipelineConfig) => {
  const crawl4ai_url = config.crawl4ai_url ?? DEFAULT_CRAWL4AI_URL;
  const openclaw_url = config.openclaw_url ?? DEFAULT_OPENCLAW_URL;
  const clay_webhook_url = config.clay_webhook_url;

  // --- Crawl a URL via Crawl4AI ---
  const crawl_url = async (url: string): Promise<string> => {
    const response = await retry_fetch(crawl4ai_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [url] }),
    });

    const data = await response.json() as { result: { markdown: string } };
    const markdown = data.result?.markdown ?? '';

    if (!markdown.trim()) {
      throw new Error('Crawl4AI returned empty markdown content');
    }

    return markdown;
  };

  // --- Extract intent via OpenClaw LLM ---
  const extract_intent = async (markdown: string, source_url: string): Promise<B2BIntentData> => {
    const response = await fetch(openclaw_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are a B2B intent extraction assistant. Analyze the crawled content and return a JSON object with: domain, extracted_intent, ai_cold_email_draft. Return ONLY valid JSON.',
          },
          {
            role: 'user',
            content: `Source URL: ${source_url}\n\nCrawled content:\n${markdown}`,
          },
        ],
      }),
    });

    const result = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenClaw returned empty content');
    }

    let parsed: { domain: string; extracted_intent: string; ai_cold_email_draft: string };
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`OpenClaw returned non-JSON content: ${content.slice(0, 100)}`);
    }

    return {
      domain: parsed.domain,
      extracted_intent: parsed.extracted_intent,
      ai_cold_email_draft: parsed.ai_cold_email_draft,
      crawled_timestamp: new Date().toISOString(),
    };
  };

  // --- Process: crawl + extract ---
  const process_intent_crawl = async (url: string): Promise<B2BIntentData> => {
    const markdown = await crawl_url(url);
    return extract_intent(markdown, url);
  };

  // --- Push to Clay.com webhook (with PII sanitization) ---
  const push_to_clay = async (data: B2BIntentData): Promise<boolean> => {
    // Sanitize all text fields before sending externally
    const sanitized: B2BIntentData = {
      domain: sanitize_text(data.domain),
      extracted_intent: sanitize_text(data.extracted_intent),
      ai_cold_email_draft: sanitize_text(data.ai_cold_email_draft),
      crawled_timestamp: data.crawled_timestamp,
    };

    const response = await fetch(clay_webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sanitized),
    });

    return response.ok;
  };

  return { process_intent_crawl, push_to_clay };
};
