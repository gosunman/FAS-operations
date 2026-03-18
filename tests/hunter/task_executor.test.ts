// Tests for hunter task executor — deep_research, notebooklm_verify, detect_login_wall
// Uses mocked browser to avoid real Playwright dependencies

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'playwright';
import type { Task } from '../../src/shared/types.js';
import type { Logger } from '../../src/hunter/logger.js';
import type { BrowserManager } from '../../src/hunter/browser.js';

// ===== Helper: create a mock logger =====
const create_mock_logger = (): Logger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// ===== Helper: create a mock task =====
const create_mock_task = (overrides: Partial<Task> = {}): Task => ({
  id: 'test-task-001',
  title: 'Test task',
  description: 'A test task description',
  priority: 'medium',
  assigned_to: 'hunter',
  mode: 'awake',
  risk_level: 'low',
  requires_personal_info: false,
  status: 'pending',
  created_at: '2026-03-18T00:00:00Z',
  deadline: null,
  depends_on: [],
  ...overrides,
});

// ===== Helper: create a mock page =====
const create_mock_page = (overrides: Record<string, unknown> = {}): Page => {
  const mock_locator = {
    first: vi.fn().mockReturnThis(),
    last: vi.fn().mockReturnThis(),
    count: vi.fn().mockResolvedValue(0),
    isVisible: vi.fn().mockResolvedValue(false),
    waitFor: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    textContent: vi.fn().mockResolvedValue(''),
  };

  const page = {
    url: vi.fn().mockReturnValue('https://gemini.google.com/app'),
    goto: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue('Test Page'),
    textContent: vi.fn().mockResolvedValue('Page body text'),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue(mock_locator),
    context: vi.fn().mockReturnValue({
      close: vi.fn().mockResolvedValue(undefined),
    }),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    screenshot: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Page;

  return page;
};

// ===== Helper: create a mock browser manager =====
const create_mock_browser = (page: Page): BrowserManager => ({
  get_page: vi.fn().mockResolvedValue(page),
  get_persistent_page: vi.fn().mockResolvedValue(page),
  close_persistent: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
});

describe('detect_login_wall', () => {
  it('should detect login wall when URL contains accounts.google.com', async () => {
    // Dynamic import to get the function
    const { detect_login_wall } = await import('../../src/hunter/task_executor.js');

    const page = create_mock_page({
      url: vi.fn().mockReturnValue('https://accounts.google.com/signin/v2/identifier'),
    });

    const result = await detect_login_wall(page);
    expect(result).toBe(true);
  });

  it('should return false for a normal Gemini page', async () => {
    const { detect_login_wall } = await import('../../src/hunter/task_executor.js');

    const mock_locator = {
      first: vi.fn().mockReturnThis(),
      isVisible: vi.fn().mockResolvedValue(false),
    };

    const page = create_mock_page({
      url: vi.fn().mockReturnValue('https://gemini.google.com/app'),
      locator: vi.fn().mockReturnValue(mock_locator),
    });

    const result = await detect_login_wall(page);
    expect(result).toBe(false);
  });

  it('should detect login wall when "Sign in" is visible with Google branding', async () => {
    const { detect_login_wall } = await import('../../src/hunter/task_executor.js');

    // Mock locator that returns different results based on selector
    const page = create_mock_page({
      url: vi.fn().mockReturnValue('https://gemini.google.com/app'),
    });

    // Override locator to simulate Sign in text visible + Google branding
    const sign_in_locator = {
      first: vi.fn().mockReturnThis(),
      isVisible: vi.fn().mockResolvedValue(true),
    };
    const branding_locator = {
      first: vi.fn().mockReturnThis(),
      isVisible: vi.fn().mockResolvedValue(true),
    };

    (page.locator as ReturnType<typeof vi.fn>).mockImplementation((selector: string) => {
      if (selector.includes('Sign in')) return sign_in_locator;
      return branding_locator;
    });

    const result = await detect_login_wall(page);
    expect(result).toBe(true);
  });
});

describe('handle_deep_research', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = create_mock_logger();
  });

  it('should return LOGIN_REQUIRED when login wall is detected', async () => {
    const { create_task_executor } = await import('../../src/hunter/task_executor.js');

    // Page that looks like a Google login screen
    const page = create_mock_page({
      url: vi.fn().mockReturnValue('https://accounts.google.com/signin'),
    });

    const browser = create_mock_browser(page);
    const executor = create_task_executor(logger, browser, {
      google_profile_dir: '/tmp/test-profile',
      deep_research_timeout_ms: 5_000,
      notebooklm_timeout_ms: 5_000,
    });

    const task = create_mock_task({
      title: 'Deep Research: AI trends 2026',
      description: 'Deep research on latest AI trends',
    });

    const result = await executor.execute(task);
    expect(result.status).toBe('failure');
    expect(result.output).toContain('[LOGIN_REQUIRED]');
  });

  it('should complete successfully with research results (happy path)', async () => {
    const { create_task_executor } = await import('../../src/hunter/task_executor.js');

    // Build mock locator that simulates successful interaction
    const input_locator = {
      first: vi.fn().mockReturnThis(),
      waitFor: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
    };

    const send_locator = {
      first: vi.fn().mockReturnThis(),
      waitFor: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
    };

    const response_locator = {
      first: vi.fn().mockReturnThis(),
      last: vi.fn().mockReturnThis(),
      count: vi.fn().mockResolvedValue(1),
      textContent: vi.fn().mockResolvedValue('This is the research result. Based on my research, AI trends include...'),
      isVisible: vi.fn().mockResolvedValue(false),
    };

    // Sign-in check locator — not visible (no login wall)
    const sign_in_locator = {
      first: vi.fn().mockReturnThis(),
      isVisible: vi.fn().mockResolvedValue(false),
    };

    let call_count = 0;
    const page = create_mock_page({
      url: vi.fn().mockReturnValue('https://gemini.google.com/app'),
      // textContent returns research-complete text after first poll
      textContent: vi.fn().mockImplementation(() => {
        call_count++;
        if (call_count >= 2) {
          return Promise.resolve('Some page text. based on my research, here are the findings...');
        }
        return Promise.resolve('Loading...');
      }),
      locator: vi.fn().mockImplementation((selector: string) => {
        if (selector.includes('Sign in')) return sign_in_locator;
        if (selector.includes('contenteditable') || selector.includes('prompt') || selector.includes('textarea')) {
          return input_locator;
        }
        if (selector.includes('Send') || selector.includes('submit') || selector.includes('send')) {
          return send_locator;
        }
        if (selector.includes('loading') || selector.includes('spinner') || selector.includes('progress')) {
          return { first: vi.fn().mockReturnThis(), isVisible: vi.fn().mockResolvedValue(false) };
        }
        return response_locator;
      }),
    });

    const browser = create_mock_browser(page);
    const executor = create_task_executor(logger, browser, {
      google_profile_dir: '/tmp/test-profile',
      deep_research_timeout_ms: 30_000,
      notebooklm_timeout_ms: 5_000,
    });

    const task = create_mock_task({
      title: 'Deep Research: AI trends 2026',
      description: 'Analyze latest AI trends',
    });

    const result = await executor.execute(task);
    expect(result.status).toBe('success');
    expect(result.output.length).toBeGreaterThan(0);
    // Verify persistent page was used (not regular get_page)
    expect(browser.get_persistent_page).toHaveBeenCalledWith('/tmp/test-profile');
  });
});

describe('handle_notebooklm_verify', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = create_mock_logger();
  });

  it('should return LOGIN_REQUIRED when login wall is detected', async () => {
    const { create_task_executor } = await import('../../src/hunter/task_executor.js');

    const page = create_mock_page({
      url: vi.fn().mockReturnValue('https://accounts.google.com/signin'),
    });

    const browser = create_mock_browser(page);
    const executor = create_task_executor(logger, browser, {
      google_profile_dir: '/tmp/test-profile',
      deep_research_timeout_ms: 5_000,
      notebooklm_timeout_ms: 5_000,
    });

    const task = create_mock_task({
      title: 'NotebookLM verification',
      description: 'notebooklm: My Notebook — Verify claim X is correct',
    });

    const result = await executor.execute(task);
    expect(result.status).toBe('failure');
    expect(result.output).toContain('[LOGIN_REQUIRED]');
  });

  it('should complete successfully with notebook response (happy path)', async () => {
    const { create_task_executor } = await import('../../src/hunter/task_executor.js');

    const chat_input_locator = {
      first: vi.fn().mockReturnThis(),
      waitFor: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
    };

    const send_locator = {
      first: vi.fn().mockReturnThis(),
      isVisible: vi.fn().mockResolvedValue(true),
      click: vi.fn().mockResolvedValue(undefined),
    };

    const notebook_link_locator = {
      first: vi.fn().mockReturnThis(),
      isVisible: vi.fn().mockResolvedValue(true),
      click: vi.fn().mockResolvedValue(undefined),
    };

    const response_locator = {
      first: vi.fn().mockReturnThis(),
      last: vi.fn().mockReturnThis(),
      count: vi.fn().mockResolvedValue(1),
      textContent: vi.fn().mockResolvedValue('The claim is supported by the following evidence in the sources...'),
      isVisible: vi.fn().mockResolvedValue(false),
    };

    const sign_in_locator = {
      first: vi.fn().mockReturnThis(),
      isVisible: vi.fn().mockResolvedValue(false),
    };

    const page = create_mock_page({
      url: vi.fn().mockReturnValue('https://notebooklm.google.com/'),
      textContent: vi.fn().mockResolvedValue('NotebookLM content area'),
      locator: vi.fn().mockImplementation((selector: string) => {
        if (selector.includes('Sign in')) return sign_in_locator;
        if (selector.includes('My Notebook')) return notebook_link_locator;
        // Send button selector contains "Send" and "Ask" — match it before chat input
        if (selector.includes('aria-label') && selector.includes('Send')) return send_locator;
        if (selector.includes('contenteditable') || selector.includes('textarea') || selector.includes('textbox')) {
          return chat_input_locator;
        }
        if (selector.includes('loading') || selector.includes('spinner') || selector.includes('typing')) {
          return { first: vi.fn().mockReturnThis(), isVisible: vi.fn().mockResolvedValue(false) };
        }
        return response_locator;
      }),
    });

    const browser = create_mock_browser(page);
    const executor = create_task_executor(logger, browser, {
      google_profile_dir: '/tmp/test-profile',
      deep_research_timeout_ms: 5_000,
      notebooklm_timeout_ms: 30_000,
    });

    const task = create_mock_task({
      title: 'NotebookLM verification',
      description: 'notebooklm: My Notebook — Is the claim about AI safety correct?',
    });

    const result = await executor.execute(task);
    expect(result.status).toBe('success');
    expect(result.output.length).toBeGreaterThan(0);
    expect(browser.get_persistent_page).toHaveBeenCalledWith('/tmp/test-profile');
  });

  it('should navigate directly when a NotebookLM URL is provided', async () => {
    const { create_task_executor } = await import('../../src/hunter/task_executor.js');

    const chat_input_locator = {
      first: vi.fn().mockReturnThis(),
      waitFor: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
    };

    const send_locator = {
      first: vi.fn().mockReturnThis(),
      isVisible: vi.fn().mockResolvedValue(false), // No send button, use Enter
    };

    const response_locator = {
      first: vi.fn().mockReturnThis(),
      last: vi.fn().mockReturnThis(),
      count: vi.fn().mockResolvedValue(1),
      textContent: vi.fn().mockResolvedValue('Verification result: the claim appears to be well-supported by the sources provided.'),
      isVisible: vi.fn().mockResolvedValue(false),
    };

    const sign_in_locator = {
      first: vi.fn().mockReturnThis(),
      isVisible: vi.fn().mockResolvedValue(false),
    };

    const page = create_mock_page({
      url: vi.fn().mockReturnValue('https://notebooklm.google.com/notebook/abc123'),
      locator: vi.fn().mockImplementation((selector: string) => {
        if (selector.includes('Sign in')) return sign_in_locator;
        // Send button selector contains "Send" and "Ask" — match before chat input
        if (selector.includes('aria-label') && selector.includes('Send')) return send_locator;
        if (selector.includes('contenteditable') || selector.includes('textarea') || selector.includes('textbox')) {
          return chat_input_locator;
        }
        if (selector.includes('loading') || selector.includes('spinner') || selector.includes('typing')) {
          return { first: vi.fn().mockReturnThis(), isVisible: vi.fn().mockResolvedValue(false) };
        }
        return response_locator;
      }),
    });

    const browser = create_mock_browser(page);
    const executor = create_task_executor(logger, browser, {
      google_profile_dir: '/tmp/test-profile',
      deep_research_timeout_ms: 5_000,
      notebooklm_timeout_ms: 30_000,
    });

    const task = create_mock_task({
      title: 'NotebookLM verification',
      description: 'Verify at https://notebooklm.google.com/notebook/abc123 — Is the architecture correct?',
    });

    const result = await executor.execute(task);
    expect(result.status).toBe('success');
    // Verify it navigated to the specific notebook URL
    expect(page.goto).toHaveBeenCalledWith(
      'https://notebooklm.google.com/notebook/abc123',
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    );
  });
});

describe('resolve_action', () => {
  it('should resolve notebooklm_verify for notebook tasks', async () => {
    const { resolve_action } = await import('../../src/hunter/task_executor.js');

    const task = create_mock_task({ title: 'NotebookLM verification task' });
    expect(resolve_action(task)).toBe('notebooklm_verify');
  });

  it('should resolve deep_research for research tasks', async () => {
    const { resolve_action } = await import('../../src/hunter/task_executor.js');

    const task = create_mock_task({ title: 'Deep Research on AI' });
    expect(resolve_action(task)).toBe('deep_research');
  });

  it('should resolve web_crawl for crawling tasks', async () => {
    const { resolve_action } = await import('../../src/hunter/task_executor.js');

    const task = create_mock_task({ title: 'Crawl this website' });
    expect(resolve_action(task)).toBe('web_crawl');
  });

  it('should default to chatgpt_task when no URL present', async () => {
    const { resolve_action } = await import('../../src/hunter/task_executor.js');

    const task = create_mock_task({ title: 'Navigate to page' });
    expect(resolve_action(task)).toBe('chatgpt_task');
  });

  it('should default to browser_task when URL is present', async () => {
    const { resolve_action } = await import('../../src/hunter/task_executor.js');

    const task = create_mock_task({ title: 'Check https://example.com status' });
    expect(resolve_action(task)).toBe('browser_task');
  });

  it('should resolve chatgpt_task for analysis keywords', async () => {
    const { resolve_action } = await import('../../src/hunter/task_executor.js');

    expect(resolve_action(create_mock_task({ title: '트렌드 분석 해줘' }))).toBe('chatgpt_task');
    expect(resolve_action(create_mock_task({ title: 'AI 리서치 진행' }))).toBe('chatgpt_task');
    expect(resolve_action(create_mock_task({ title: 'Explore startup trends' }))).toBe('chatgpt_task');
  });
});
