import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_task_executor, resolve_action, extract_url } from './task_executor.js';
import type { Task } from '../shared/types.js';
import type { Logger } from './logger.js';
import type { BrowserManager } from './browser.js';

const mock_logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Mock page object returned by Playwright
const create_mock_page = (overrides: Record<string, unknown> = {}) => ({
  goto: vi.fn().mockResolvedValue(undefined),
  title: vi.fn().mockResolvedValue('Test Page Title'),
  textContent: vi.fn().mockResolvedValue('  Hello world content  '),
  screenshot: vi.fn().mockResolvedValue(undefined),
  setDefaultTimeout: vi.fn(),
  setDefaultNavigationTimeout: vi.fn(),
  context: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
  }),
  ...overrides,
});

// Mock browser manager
const create_mock_browser = (page_overrides: Record<string, unknown> = {}): BrowserManager => {
  const mock_page = create_mock_page(page_overrides);
  return {
    get_page: vi.fn().mockResolvedValue(mock_page),
    close: vi.fn().mockResolvedValue(undefined),
  };
};

const make_task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task_001',
  title: 'Test task',
  priority: 'medium',
  assigned_to: 'openclaw',
  mode: 'awake',
  risk_level: 'low',
  requires_personal_info: false,
  status: 'pending',
  created_at: '2026-03-17T00:00:00Z',
  deadline: null,
  depends_on: [],
  ...overrides,
});

// ===== extract_url tests =====
describe('extract_url', () => {
  it('should extract https URL from text', () => {
    // Given
    const text = 'Please crawl https://example.com/page for data';

    // When
    const result = extract_url(text);

    // Then
    expect(result).toBe('https://example.com/page');
  });

  it('should extract http URL from text', () => {
    // Given
    const text = 'Visit http://localhost:3000/api';

    // When
    const result = extract_url(text);

    // Then
    expect(result).toBe('http://localhost:3000/api');
  });

  it('should return first URL when multiple exist', () => {
    // Given
    const text = 'Check https://first.com and https://second.com';

    // When
    const result = extract_url(text);

    // Then
    expect(result).toBe('https://first.com');
  });

  it('should return null when no URL found', () => {
    // Given
    const text = 'No URLs in this text at all';

    // When
    const result = extract_url(text);

    // Then
    expect(result).toBeNull();
  });

  it('should handle URLs with query params and paths', () => {
    // Given
    const text = 'Crawl https://api.example.com/v2/data?page=1&limit=50';

    // When
    const result = extract_url(text);

    // Then
    expect(result).toBe('https://api.example.com/v2/data?page=1&limit=50');
  });
});

// ===== resolve_action tests =====
describe('resolve_action', () => {
  it('should resolve notebooklm_verify from title', () => {
    // Given
    const task = make_task({ title: 'NotebookLM verify research output' });

    // When / Then
    expect(resolve_action(task)).toBe('notebooklm_verify');
  });

  it('should resolve deep_research from description', () => {
    // Given
    const task = make_task({
      title: 'AI trends analysis',
      description: 'Run deep research on latest AI trends',
    });

    // When / Then
    expect(resolve_action(task)).toBe('deep_research');
  });

  it('should resolve web_crawl from Korean keyword', () => {
    // Given
    const task = make_task({ title: 'K-Startup 크롤링' });

    // When / Then
    expect(resolve_action(task)).toBe('web_crawl');
  });

  it('should resolve web_crawl from scrape keyword', () => {
    // Given
    const task = make_task({ title: 'Scrape job listings from LinkedIn' });

    // When / Then
    expect(resolve_action(task)).toBe('web_crawl');
  });

  it('should default to browser_task for unknown tasks', () => {
    // Given
    const task = make_task({ title: 'Check Gmail for new emails' });

    // When / Then
    expect(resolve_action(task)).toBe('browser_task');
  });
});

// ===== web_crawl handler tests =====
describe('web_crawl handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should crawl URL and return page content', async () => {
    // Given
    const mock_browser = create_mock_browser();
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'Crawl K-Startup website',
      description: 'Scrape https://example.com/startups for listings',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('success');
    expect(result.output).toContain('Test Page Title');
    expect(result.output).toContain('https://example.com/startups');
    expect(result.output).toContain('Hello world content');
    expect(result.files).toEqual([]);
  });

  it('should return failure when no URL found in crawl task', async () => {
    // Given
    const mock_browser = create_mock_browser();
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'Crawl some website',
      description: 'No URL provided here',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('failure');
    expect(result.output).toContain('No URL found');
  });

  it('should handle navigation errors gracefully', async () => {
    // Given
    const mock_browser = create_mock_browser({
      goto: vi.fn().mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED')),
    });
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'Crawl broken site',
      description: 'Scrape https://nonexistent.invalid/page',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('failure');
    expect(result.output).toContain('net::ERR_NAME_NOT_RESOLVED');
  });
});

// ===== browser_task handler tests =====
describe('browser_task handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should navigate, screenshot, and return content', async () => {
    // Given
    const mock_browser = create_mock_browser();
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'Check Gmail for new emails',
      description: 'Open https://mail.google.com and check inbox',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('success');
    expect(result.output).toContain('Test Page Title');
    expect(result.output).toContain('https://mail.google.com');
    expect(result.files).toEqual([`./output/${task.id}.png`]);
  });

  it('should return failure when no URL found in browser task', async () => {
    // Given
    const mock_browser = create_mock_browser();
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'Do something without URL',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('failure');
    expect(result.output).toContain('No URL found');
  });

  it('should handle screenshot errors gracefully', async () => {
    // Given
    const mock_browser = create_mock_browser({
      screenshot: vi.fn().mockRejectedValue(new Error('Screenshot failed')),
    });
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'Take screenshot',
      description: 'Visit https://example.com and screenshot',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('failure');
    expect(result.output).toContain('Screenshot failed');
  });
});

// ===== deep_research handler tests =====
describe('deep_research handler', () => {
  it('should return failure with NOT_IMPLEMENTED message', async () => {
    // Given
    const mock_browser = create_mock_browser();
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'AI trends deep research',
      description: 'Run deep research on latest AI developments',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('failure');
    expect(result.output).toContain('NOT_IMPLEMENTED');
    expect(result.output).toContain('Gemini web UI');
    expect(result.output).toContain('pending OpenClaw integration');
    expect(result.files).toEqual([]);
  });
});

// ===== notebooklm_verify handler tests =====
describe('notebooklm_verify handler', () => {
  it('should return failure with NOT_IMPLEMENTED message', async () => {
    // Given
    const mock_browser = create_mock_browser();
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'NotebookLM verify analysis results',
      description: 'Verify hallucination in research output',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('failure');
    expect(result.output).toContain('NOT_IMPLEMENTED');
    expect(result.output).toContain('NotebookLM');
    expect(result.output).toContain('pending OpenClaw integration');
    expect(result.files).toEqual([]);
  });
});
