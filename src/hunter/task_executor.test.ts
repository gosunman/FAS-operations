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

// Mock locator object for Playwright page.locator() calls
const create_mock_locator = () => ({
  first: vi.fn().mockReturnThis(),
  last: vi.fn().mockReturnThis(),
  count: vi.fn().mockResolvedValue(0),
  isVisible: vi.fn().mockResolvedValue(false),
  waitFor: vi.fn().mockResolvedValue(undefined),
  click: vi.fn().mockResolvedValue(undefined),
  fill: vi.fn().mockResolvedValue(undefined),
  press: vi.fn().mockResolvedValue(undefined),
  textContent: vi.fn().mockResolvedValue(''),
});

// Mock page object returned by Playwright
const create_mock_page = (overrides: Record<string, unknown> = {}) => ({
  goto: vi.fn().mockResolvedValue(undefined),
  title: vi.fn().mockResolvedValue('Test Page Title'),
  textContent: vi.fn().mockResolvedValue('  Hello world content  '),
  screenshot: vi.fn().mockResolvedValue(undefined),
  setDefaultTimeout: vi.fn(),
  setDefaultNavigationTimeout: vi.fn(),
  url: vi.fn().mockReturnValue('https://example.com'),
  waitForTimeout: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  locator: vi.fn().mockReturnValue(create_mock_locator()),
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
    get_persistent_page: vi.fn().mockResolvedValue(mock_page),
    close_persistent: vi.fn().mockResolvedValue(undefined),
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

  it('should default to chatgpt_task for tasks without URL', () => {
    // Given — no URL, no keywords → OpenClaw handles abstract tasks
    const task = make_task({ title: 'Check Gmail for new emails' });

    // When / Then
    expect(resolve_action(task)).toBe('chatgpt_task');
  });

  it('should use explicit action field when present', () => {
    // Given — action field overrides keyword analysis
    const task = make_task({ title: 'Some task', action: 'deep_research' });

    // When / Then
    expect(resolve_action(task)).toBe('deep_research');
  });

  it('should fall back to keyword analysis when action field is missing', () => {
    // Given — no action field, but 'crawl' keyword present
    const task = make_task({ title: 'Crawl startup websites' });

    // When / Then
    expect(resolve_action(task)).toBe('web_crawl');
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

  it('should fall back to chatgpt_task when no URL found', async () => {
    // Given — web_crawl with no URL should delegate to OpenClaw
    const mock_browser = create_mock_browser();
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'Crawl some website',
      description: 'No URL provided here',
      action: 'web_crawl',
    });

    // When
    const result = await executor.execute(task);

    // Then — chatgpt_task fallback runs (OpenClaw spawn will fail in test, but fallback path is exercised)
    expect(mock_logger.info).toHaveBeenCalledWith(
      expect.stringContaining('falling back to chatgpt_task'),
    );
  });

  it('should use task.url when provided (explicit URL from schedule)', async () => {
    // Given — task.url takes priority over text extraction
    const mock_browser = create_mock_browser();
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'Crawl K-Startup',
      description: 'Some description without URL',
      action: 'web_crawl',
      url: 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('success');
    expect(result.output).toContain('https://www.k-startup.go.kr');
  });

  it('should prefer task.url over URL in description', async () => {
    // Given — both task.url and description URL exist
    const mock_browser = create_mock_browser();
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'Crawl site',
      description: 'Check https://fallback.example.com for data',
      action: 'web_crawl',
      url: 'https://primary.example.com',
    });

    // When
    const result = await executor.execute(task);

    // Then — task.url should win
    expect(result.output).toContain('https://primary.example.com');
    expect(result.output).not.toContain('https://fallback.example.com');
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
    // Given — explicit action forces browser_task routing
    const mock_browser = create_mock_browser();
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'Do something without URL',
      action: 'browser_task',
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
  it('should detect login wall and return LOGIN_REQUIRED', async () => {
    // Given — page URL is Google login
    const mock_browser = create_mock_browser({
      url: vi.fn().mockReturnValue('https://accounts.google.com/signin'),
    });
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'AI trends deep research',
      description: 'Run deep research on latest AI developments',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('failure');
    expect(result.output).toContain('[LOGIN_REQUIRED]');
    expect(result.files).toEqual([]);
  });

  it('should use persistent browser page for Google login session', async () => {
    // Given
    const mock_browser = create_mock_browser({
      url: vi.fn().mockReturnValue('https://accounts.google.com/v3'),
    });
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'deep research on AI',
      description: 'Run deep research on latest AI developments',
    });

    // When
    await executor.execute(task);

    // Then — persistent page should be called, not regular get_page
    expect(mock_browser.get_persistent_page).toHaveBeenCalled();
  });
});

// ===== notebooklm_verify handler tests =====
describe('notebooklm_verify handler', () => {
  it('should detect login wall and return LOGIN_REQUIRED', async () => {
    // Given — page URL is Google login
    const mock_browser = create_mock_browser({
      url: vi.fn().mockReturnValue('https://accounts.google.com/signin'),
    });
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'NotebookLM verify analysis results',
      description: 'Verify hallucination in research output',
    });

    // When
    const result = await executor.execute(task);

    // Then
    expect(result.status).toBe('failure');
    expect(result.output).toContain('[LOGIN_REQUIRED]');
    expect(result.files).toEqual([]);
  });

  it('should use persistent browser page for Google login session', async () => {
    // Given
    const mock_browser = create_mock_browser({
      url: vi.fn().mockReturnValue('https://accounts.google.com/v3'),
    });
    const executor = create_task_executor(mock_logger, mock_browser);
    const task = make_task({
      title: 'NotebookLM verify analysis results',
      description: 'Verify hallucination in research output',
    });

    // When
    await executor.execute(task);

    // Then — persistent page should be called, not regular get_page
    expect(mock_browser.get_persistent_page).toHaveBeenCalled();
  });
});
