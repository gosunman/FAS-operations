import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  create_hn_parser,
  create_reddit_parser,
  create_arxiv_parser,
  create_keyword_filter,
  generate_trend_report,
  run_ai_trend_research,
  DEFAULT_KEYWORDS,
  type AiTrendConfig,
  type TrendItem,
} from './ai_trend_parser.js';

// Mock global fetch
const mock_fetch = vi.fn();
vi.stubGlobal('fetch', mock_fetch);

// === Test fixtures ===

const make_hn_item = (overrides: Record<string, unknown> = {}) => ({
  id: 12345,
  title: 'Local LLM breakthrough on edge devices',
  url: 'https://example.com/llm-edge',
  score: 150,
  descendants: 42,
  by: 'testuser',
  time: Math.floor(Date.now() / 1000),
  type: 'story',
  ...overrides,
});

const make_reddit_post = (overrides: Record<string, unknown> = {}) => ({
  data: {
    title: 'New automation framework for local LLM deployment',
    url: 'https://reddit.com/r/LocalLLaMA/comments/abc123',
    permalink: '/r/LocalLLaMA/comments/abc123/new_automation',
    score: 200,
    num_comments: 55,
    subreddit: 'LocalLLaMA',
    created_utc: Math.floor(Date.now() / 1000),
    ...overrides,
  },
});

const make_arxiv_entry = (overrides: Record<string, unknown> = {}) => ({
  title: 'EduTech: Automated Science Simulation via LLM Agents',
  authors: ['Alice Smith', 'Bob Jones'],
  summary: 'We present an edutech platform leveraging local LLM for science education automation.',
  link: 'http://arxiv.org/abs/2403.12345',
  published: '2026-03-20T00:00:00Z',
  ...overrides,
});

// === Hacker News Parser ===

describe('HN Parser', () => {
  beforeEach(() => {
    mock_fetch.mockReset();
  });

  // Given: HN API returns top story IDs and item details
  // When: parse() is called
  // Then: it fetches story IDs and individual items
  it('fetches top stories and returns filtered items', async () => {
    // Story IDs response
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [12345, 12346, 12347],
    });
    // Individual item responses
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => make_hn_item({ title: 'Local LLM on edge devices' }),
    });
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => make_hn_item({ id: 12346, title: 'Unrelated cooking recipe', score: 50 }),
    });
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => make_hn_item({ id: 12347, title: 'Automation in edutech startups', score: 300 }),
    });

    const parser = create_hn_parser();
    const keywords = DEFAULT_KEYWORDS;
    const results = await parser.parse(keywords);

    // Should return only keyword-matching items
    expect(results.length).toBe(2);
    expect(results[0].source).toBe('hackernews');
    expect(results[0].title).toContain('LLM');
  });

  // Given: HN API is down
  // When: parse() is called
  // Then: it throws (orchestrator handles error)
  it('throws when HN API fails', async () => {
    mock_fetch.mockRejectedValueOnce(new Error('Network error'));

    const parser = create_hn_parser();

    await expect(parser.parse(DEFAULT_KEYWORDS)).rejects.toThrow('Network error');
  });

  // Given: HN API returns items but fetch_limit is set
  // When: parse() is called with a low fetch_limit
  // Then: only fetches up to fetch_limit items
  it('respects fetch_limit parameter', async () => {
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => make_hn_item({ id: 1, title: 'local LLM test' }),
    });
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => make_hn_item({ id: 2, title: 'automation test' }),
    });

    const parser = create_hn_parser({ fetch_limit: 2 });
    await parser.parse(DEFAULT_KEYWORDS);

    // 1 call for story IDs + 2 calls for items = 3 total
    expect(mock_fetch).toHaveBeenCalledTimes(3);
  });
});

// === Reddit Parser ===

describe('Reddit Parser', () => {
  beforeEach(() => {
    mock_fetch.mockReset();
  });

  // Given: Reddit returns hot posts from multiple subreddits
  // When: parse() is called
  // Then: it fetches from all subreddits and filters by keywords
  it('fetches from multiple subreddits and filters by keywords', async () => {
    // r/MachineLearning response
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          children: [
            make_reddit_post({ title: 'New local LLM beats GPT-4', subreddit: 'MachineLearning' }),
            make_reddit_post({ title: 'Random sports discussion', subreddit: 'MachineLearning', score: 10 }),
          ],
        },
      }),
    });
    // r/LocalLLaMA response
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          children: [
            make_reddit_post({ title: 'Automation tool for 1인창업', subreddit: 'LocalLLaMA' }),
          ],
        },
      }),
    });

    const parser = create_reddit_parser();
    const results = await parser.parse(DEFAULT_KEYWORDS);

    expect(results.length).toBe(2);
    expect(results.every(r => r.source === 'reddit')).toBe(true);
  });

  // Given: Reddit API is down for one subreddit
  // When: parse() is called
  // Then: it returns results from the working subreddit only
  it('handles partial subreddit failure gracefully', async () => {
    // r/MachineLearning fails
    mock_fetch.mockRejectedValueOnce(new Error('Reddit 429'));
    // r/LocalLLaMA succeeds
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          children: [
            make_reddit_post({ title: 'Local LLM comparison' }),
          ],
        },
      }),
    });

    const parser = create_reddit_parser();
    const results = await parser.parse(DEFAULT_KEYWORDS);

    expect(results.length).toBe(1);
  });

  // Given: Reddit parser is created
  // When: it makes a request
  // Then: it includes a proper User-Agent header
  it('includes User-Agent header in requests', async () => {
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { children: [] } }),
    });
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { children: [] } }),
    });

    const parser = create_reddit_parser();
    await parser.parse(DEFAULT_KEYWORDS);

    const first_call_headers = mock_fetch.mock.calls[0][1]?.headers;
    expect(first_call_headers?.['User-Agent']).toBeDefined();
    expect(first_call_headers?.['User-Agent']).toContain('FAS');
  });
});

// === arxiv Parser ===

describe('arxiv Parser', () => {
  beforeEach(() => {
    mock_fetch.mockReset();
  });

  const ARXIV_XML_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>EduTech: Automated Science Simulation via LLM Agents</title>
    <summary>We present an edutech platform leveraging local LLM for science education automation.</summary>
    <author><name>Alice Smith</name></author>
    <author><name>Bob Jones</name></author>
    <link href="http://arxiv.org/abs/2403.12345" rel="alternate" type="text/html"/>
    <published>2026-03-20T00:00:00Z</published>
  </entry>
  <entry>
    <title>Quantum Computing for Protein Folding</title>
    <summary>A quantum approach to protein structure prediction.</summary>
    <author><name>Charlie Brown</name></author>
    <link href="http://arxiv.org/abs/2403.99999" rel="alternate" type="text/html"/>
    <published>2026-03-19T00:00:00Z</published>
  </entry>
</feed>`;

  // Given: arxiv returns XML feed with entries
  // When: parse() is called
  // Then: it parses XML and filters by keywords
  it('parses arxiv XML feed and filters by keywords', async () => {
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      text: async () => ARXIV_XML_RESPONSE,
    });

    const parser = create_arxiv_parser();
    const results = await parser.parse(DEFAULT_KEYWORDS);

    // Only the first entry matches (edutech, LLM, automation)
    expect(results.length).toBe(1);
    expect(results[0].source).toBe('arxiv');
    expect(results[0].title).toContain('EduTech');
    expect(results[0].metadata?.authors).toBeDefined();
  });

  // Given: arxiv API fails
  // When: parse() is called
  // Then: it throws (orchestrator handles error)
  it('throws when arxiv API fails', async () => {
    mock_fetch.mockRejectedValueOnce(new Error('Connection timeout'));

    const parser = create_arxiv_parser();

    await expect(parser.parse(DEFAULT_KEYWORDS)).rejects.toThrow('Connection timeout');
  });
});

// === Keyword Filter ===

describe('Keyword Filter', () => {
  const filter = create_keyword_filter();

  // Given: text containing a keyword
  // When: matches() is called
  // Then: it returns true
  it('matches English keyword case-insensitively', () => {
    expect(filter.matches('New LOCAL LLM model released', DEFAULT_KEYWORDS)).toBe(true);
  });

  it('matches Korean keyword', () => {
    expect(filter.matches('새로운 에듀테크 서비스 출시', DEFAULT_KEYWORDS)).toBe(true);
  });

  it('matches partial keyword (automation)', () => {
    expect(filter.matches('Home automation tools for beginners', DEFAULT_KEYWORDS)).toBe(true);
  });

  // Given: text with no matching keyword
  // When: matches() is called
  // Then: it returns false
  it('returns false for non-matching text', () => {
    expect(filter.matches('How to cook pasta properly', DEFAULT_KEYWORDS)).toBe(false);
  });

  // Given: text and keywords
  // When: matched_keywords() is called
  // Then: it returns the list of matched keywords
  it('returns list of matched keywords', () => {
    const matched = filter.matched_keywords(
      'Local LLM automation for edutech startups',
      DEFAULT_KEYWORDS,
    );
    expect(matched).toContain('local llm');
    expect(matched).toContain('automation');
    expect(matched).toContain('edutech');
  });
});

// === Report Generator ===

describe('Report Generator', () => {
  it('generates a formatted report from trend items', () => {
    const items: TrendItem[] = [
      {
        source: 'hackernews',
        title: 'Local LLM breakthrough',
        url: 'https://example.com/llm',
        score: 150,
        comments: 42,
        matched_keywords: ['local llm'],
        fetched_at: '2026-03-21T00:00:00Z',
      },
      {
        source: 'reddit',
        title: 'Automation framework release',
        url: 'https://reddit.com/r/LocalLLaMA/abc',
        score: 200,
        comments: 55,
        matched_keywords: ['automation'],
        fetched_at: '2026-03-21T00:00:00Z',
      },
      {
        source: 'arxiv',
        title: 'EduTech via LLM Agents',
        url: 'http://arxiv.org/abs/2403.12345',
        matched_keywords: ['edutech', 'local llm'],
        fetched_at: '2026-03-21T00:00:00Z',
        metadata: { authors: ['Alice', 'Bob'], abstract: 'An edutech paper.' },
      },
    ];

    const report = generate_trend_report(items);

    expect(report).toContain('AI Trend Daily Report');
    expect(report).toContain('Hacker News');
    expect(report).toContain('Reddit');
    expect(report).toContain('arxiv');
    expect(report).toContain('Local LLM breakthrough');
    expect(report).toContain('Automation framework release');
    expect(report).toContain('EduTech via LLM Agents');
    expect(report).toContain('Total: 3 items');
  });

  it('generates empty report message when no items found', () => {
    const report = generate_trend_report([]);

    expect(report).toContain('AI Trend Daily Report');
    expect(report).toContain('No matching items found');
  });
});

// === Main Orchestrator ===

describe('run_ai_trend_research', () => {
  beforeEach(() => {
    mock_fetch.mockReset();
  });

  // Given: All sources return data
  // When: run_ai_trend_research() is called
  // Then: it returns a combined report and items from all sources
  it('orchestrates all parsers and returns combined report', async () => {
    // HN: story IDs
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [1],
    });
    // HN: item detail
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => make_hn_item({ id: 1, title: 'Local LLM on Mac Studio' }),
    });
    // Reddit: r/MachineLearning
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          children: [
            make_reddit_post({ title: 'Automation with local LLM' }),
          ],
        },
      }),
    });
    // Reddit: r/LocalLLaMA
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { children: [] },
      }),
    });
    // arxiv
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>NVC chatbot using automation</title>
    <summary>NVC and automation research paper.</summary>
    <author><name>Test Author</name></author>
    <link href="http://arxiv.org/abs/2403.11111" rel="alternate" type="text/html"/>
    <published>2026-03-20T00:00:00Z</published>
  </entry>
</feed>`,
    });

    const result = await run_ai_trend_research();

    expect(result.items.length).toBe(3);
    expect(result.report).toContain('AI Trend Daily Report');
    expect(result.report).toContain('Total: 3 items');
    expect(result.sources_status.hackernews).toBe('ok');
    expect(result.sources_status.reddit).toBe('ok');
    expect(result.sources_status.arxiv).toBe('ok');
  });

  // Given: One source fails entirely
  // When: run_ai_trend_research() is called
  // Then: it still returns results from other sources
  it('handles partial source failure gracefully', async () => {
    // HN fails entirely
    mock_fetch.mockRejectedValueOnce(new Error('HN down'));
    // Reddit: r/MachineLearning
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          children: [
            make_reddit_post({ title: 'Edutech automation tool' }),
          ],
        },
      }),
    });
    // Reddit: r/LocalLLaMA
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { children: [] },
      }),
    });
    // arxiv
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`,
    });

    const result = await run_ai_trend_research();

    expect(result.items.length).toBe(1);
    expect(result.sources_status.hackernews).toBe('error');
    expect(result.sources_status.reddit).toBe('ok');
    expect(result.sources_status.arxiv).toBe('ok');
  });

  // Given: Custom config with different keywords
  // When: run_ai_trend_research() is called with config
  // Then: it uses the custom keywords
  it('accepts custom config with overridden keywords', async () => {
    // HN
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [1],
    });
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => make_hn_item({ id: 1, title: 'Quantum computing paper' }),
    });
    // Reddit: r/MachineLearning
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          children: [
            make_reddit_post({ title: 'Quantum advantage demonstrated' }),
          ],
        },
      }),
    });
    // Reddit: r/LocalLLaMA
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { children: [] } }),
    });
    // arxiv
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`,
    });

    const custom_config: AiTrendConfig = {
      keywords: ['quantum', 'computing'],
    };

    const result = await run_ai_trend_research(custom_config);

    // Should match 'quantum' keyword
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.items.every(i =>
      i.matched_keywords.some(k => k === 'quantum' || k === 'computing')
    )).toBe(true);
  });

  // Given: All sources fail
  // When: run_ai_trend_research() is called
  // Then: it returns empty items with error statuses
  it('returns empty report when all sources fail', async () => {
    // HN fails
    mock_fetch.mockRejectedValueOnce(new Error('HN down'));
    // Reddit: r/MachineLearning fails
    mock_fetch.mockRejectedValueOnce(new Error('Reddit down'));
    // Reddit: r/LocalLLaMA fails
    mock_fetch.mockRejectedValueOnce(new Error('Reddit down'));
    // arxiv fails
    mock_fetch.mockRejectedValueOnce(new Error('arxiv down'));

    const result = await run_ai_trend_research();

    expect(result.items).toEqual([]);
    expect(result.report).toContain('No matching items found');
    expect(result.sources_status.hackernews).toBe('error');
    expect(result.sources_status.reddit).toBe('error');
    expect(result.sources_status.arxiv).toBe('error');
  });
});
