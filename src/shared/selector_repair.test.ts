// Tests for AI-powered CSS selector repair service
// Pattern: Given-When-Then
//
// Uses dependency injection (ai_provider) to mock the AI backend
// instead of spying on child_process.spawn (which is not mockable in ESM).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { create_selector_repair_service, is_plausible_selector, build_repair_prompt } from './selector_repair.js';
import type { AiSelectorProvider } from './selector_repair.js';

// === Mock Playwright Page ===

const create_mock_page = (overrides: Record<string, unknown> = {}) => ({
  url: vi.fn().mockReturnValue('https://example.com/dashboard'),
  title: vi.fn().mockResolvedValue('Dashboard - Example'),
  screenshot: vi.fn().mockResolvedValue(undefined),
  waitForSelector: vi.fn().mockResolvedValue({ tagName: 'button' }),
  ...overrides,
});

// === Test setup ===

let test_dir: string;
let log_path: string;
let screenshot_dir: string;

beforeEach(() => {
  test_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fas-selector-repair-test-'));
  screenshot_dir = path.join(test_dir, 'screenshots');
  log_path = path.join(test_dir, 'repairs.jsonl');
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    fs.rmSync(test_dir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

// === Tests ===

describe('is_plausible_selector', () => {
  it('should accept simple CSS selectors', () => {
    expect(is_plausible_selector('button.submit')).toBe(true);
    expect(is_plausible_selector('#main-form')).toBe(true);
    expect(is_plausible_selector('.container > div')).toBe(true);
    expect(is_plausible_selector('[data-testid="submit"]')).toBe(true);
    expect(is_plausible_selector('*')).toBe(true);
    expect(is_plausible_selector(':first-child')).toBe(true);
  });

  it('should reject strings that are too long', () => {
    expect(is_plausible_selector('a'.repeat(201))).toBe(false);
  });

  it('should reject multi-line strings', () => {
    expect(is_plausible_selector('line1\nline2')).toBe(false);
  });

  it('should reject strings that do not look like selectors', () => {
    expect(is_plausible_selector('This is a sentence about selectors.')).toBe(false);
    expect(is_plausible_selector('123invalid')).toBe(false);
  });
});

describe('build_repair_prompt', () => {
  it('should include broken selector and page context', () => {
    const prompt = build_repair_prompt(
      'https://example.com',
      '.broken-btn',
      'click submit button',
      'Test Page',
      '/tmp/screenshot.png',
    );

    expect(prompt).toContain('.broken-btn');
    expect(prompt).toContain('https://example.com');
    expect(prompt).toContain('click submit button');
    expect(prompt).toContain('Test Page');
    expect(prompt).toContain('/tmp/screenshot.png');
  });

  it('should omit screenshot line when path is null', () => {
    const prompt = build_repair_prompt(
      'https://example.com',
      '.broken-btn',
      'click',
      'Page',
      null,
    );

    expect(prompt).not.toContain('Screenshot saved at');
  });
});

describe('create_selector_repair_service', () => {
  describe('successful repair', () => {
    it('should repair a broken selector when AI suggests a valid alternative', async () => {
      // Given: an AI provider that returns a valid selector, and a page where it matches
      const ai_provider: AiSelectorProvider = vi.fn().mockResolvedValue('[data-testid="submit-btn"]');
      const mock_page = create_mock_page();

      const service = create_selector_repair_service({
        screenshot_dir,
        repair_log_path: log_path,
        ai_provider,
      });

      // When: repair is called with a broken selector
      const result = await service.repair(
        mock_page as unknown as import('playwright').Page,
        'button.old-submit-class',
        'click the submit button',
      );

      // Then: repair succeeds with the AI-suggested selector
      expect(result.success).toBe(true);
      expect(result.original_selector).toBe('button.old-submit-class');
      expect(result.repaired_selector).toBe('[data-testid="submit-btn"]');
      expect(result.attempts).toBe(1);
    });

    it('should log successful repairs to JSONL file', async () => {
      // Given: a setup that will produce a successful repair
      const ai_provider: AiSelectorProvider = vi.fn().mockResolvedValue('#new-selector');
      const mock_page = create_mock_page();

      const service = create_selector_repair_service({
        screenshot_dir,
        repair_log_path: log_path,
        ai_provider,
      });

      // When: repair succeeds
      await service.repair(
        mock_page as unknown as import('playwright').Page,
        '.broken',
        'find element',
      );

      // Then: repair is logged to the JSONL file
      const log_content = fs.readFileSync(log_path, 'utf-8');
      const entry = JSON.parse(log_content.trim());

      expect(entry.success).toBe(true);
      expect(entry.original_selector).toBe('.broken');
      expect(entry.repaired_selector).toBe('#new-selector');
      expect(entry.url).toBe('https://example.com/dashboard');
      expect(entry.intended_action).toBe('find element');
      expect(entry.timestamp).toBeDefined();
    });
  });

  describe('failed repair', () => {
    it('should return failure when AI returns no valid selector', async () => {
      // Given: AI returns null (no valid selector)
      const ai_provider: AiSelectorProvider = vi.fn().mockResolvedValue(null);
      const mock_page = create_mock_page();

      const service = create_selector_repair_service({
        screenshot_dir,
        repair_log_path: log_path,
        max_repair_attempts: 2,
        ai_provider,
      });

      // When: repair is attempted
      const result = await service.repair(
        mock_page as unknown as import('playwright').Page,
        '.missing-element',
        'click a button',
      );

      // Then: repair fails after exhausting attempts
      expect(result.success).toBe(false);
      expect(result.repaired_selector).toBeNull();
      expect(result.attempts).toBe(2);
      expect(result.error).toContain('AI returned no valid selector candidate');
    });

    it('should return failure when AI selector does not match any element', async () => {
      // Given: AI returns a selector that doesn't match anything on the page
      const ai_provider: AiSelectorProvider = vi.fn().mockResolvedValue('[data-testid="nonexistent"]');
      const mock_page = create_mock_page({
        waitForSelector: vi.fn().mockRejectedValue(new Error('Timeout 5000ms exceeded')),
      });

      const service = create_selector_repair_service({
        screenshot_dir,
        repair_log_path: log_path,
        max_repair_attempts: 1,
        ai_provider,
      });

      // When: repair is attempted
      const result = await service.repair(
        mock_page as unknown as import('playwright').Page,
        '.broken',
        'click button',
      );

      // Then: repair fails because the suggested selector didn't match
      expect(result.success).toBe(false);
      expect(result.error).toContain('did not match any element');
    });

    it('should log failed repairs to JSONL file', async () => {
      // Given: AI returns nothing useful
      const ai_provider: AiSelectorProvider = vi.fn().mockResolvedValue(null);
      const mock_page = create_mock_page();

      const service = create_selector_repair_service({
        screenshot_dir,
        repair_log_path: log_path,
        max_repair_attempts: 1,
        ai_provider,
      });

      // When: repair fails
      await service.repair(
        mock_page as unknown as import('playwright').Page,
        '.broken',
        'find element',
      );

      // Then: failure is logged
      const log_content = fs.readFileSync(log_path, 'utf-8');
      const entry = JSON.parse(log_content.trim());

      expect(entry.success).toBe(false);
      expect(entry.repaired_selector).toBeNull();
    });
  });

  describe('retry behavior', () => {
    it('should retry up to max_repair_attempts times', async () => {
      // Given: first AI attempt returns null, second returns valid selector
      let call_count = 0;
      const ai_provider: AiSelectorProvider = vi.fn().mockImplementation(async () => {
        call_count++;
        return call_count === 1 ? null : '#valid-selector';
      });

      const mock_page = create_mock_page();

      const service = create_selector_repair_service({
        screenshot_dir,
        repair_log_path: log_path,
        max_repair_attempts: 2,
        ai_provider,
      });

      // When: repair is attempted
      const result = await service.repair(
        mock_page as unknown as import('playwright').Page,
        '.broken',
        'find element',
      );

      // Then: succeeds on second attempt
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
      expect(result.repaired_selector).toBe('#valid-selector');
    });

    it('should stop retrying after max_repair_attempts even if all fail', async () => {
      // Given: AI always returns null
      const ai_provider: AiSelectorProvider = vi.fn().mockResolvedValue(null);
      const mock_page = create_mock_page();

      const service = create_selector_repair_service({
        screenshot_dir,
        repair_log_path: log_path,
        max_repair_attempts: 3,
        ai_provider,
      });

      // When: repair is attempted
      const result = await service.repair(
        mock_page as unknown as import('playwright').Page,
        '.broken',
        'find element',
      );

      // Then: AI was called exactly max_repair_attempts times
      expect(ai_provider).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
    });
  });

  describe('screenshot capture', () => {
    it('should take a screenshot of the page for context', async () => {
      // Given: a mock page and a working AI provider
      const ai_provider: AiSelectorProvider = vi.fn().mockResolvedValue('[aria-label="Submit"]');
      const mock_page = create_mock_page();

      const service = create_selector_repair_service({
        screenshot_dir,
        repair_log_path: log_path,
        ai_provider,
      });

      // When: repair is called
      await service.repair(
        mock_page as unknown as import('playwright').Page,
        '.broken',
        'click submit',
      );

      // Then: screenshot was taken
      expect(mock_page.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringContaining('repair_'),
          fullPage: false,
        }),
      );
    });

    it('should continue repair even if screenshot fails', async () => {
      // Given: screenshot fails but AI still works
      const ai_provider: AiSelectorProvider = vi.fn().mockResolvedValue('[data-testid="btn"]');
      const mock_page = create_mock_page({
        screenshot: vi.fn().mockRejectedValue(new Error('screenshot failed')),
      });

      const service = create_selector_repair_service({
        screenshot_dir,
        repair_log_path: log_path,
        ai_provider,
      });

      // When: repair is called
      const result = await service.repair(
        mock_page as unknown as import('playwright').Page,
        '.broken',
        'click button',
      );

      // Then: repair still succeeds (screenshot is optional context)
      expect(result.success).toBe(true);
    });
  });

  describe('page title handling', () => {
    it('should handle page.title() throwing', async () => {
      // Given: page.title() throws (e.g., page crashed)
      const ai_provider: AiSelectorProvider = vi.fn().mockResolvedValue('#fallback');
      const mock_page = create_mock_page({
        title: vi.fn().mockRejectedValue(new Error('page closed')),
      });

      const service = create_selector_repair_service({
        screenshot_dir,
        repair_log_path: log_path,
        ai_provider,
      });

      // When: repair is called
      const result = await service.repair(
        mock_page as unknown as import('playwright').Page,
        '.broken',
        'find element',
      );

      // Then: repair still works with fallback title
      expect(result.success).toBe(true);
      // AI provider received a prompt that contains the fallback title
      const prompt = (ai_provider as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(prompt).toContain('unable to read title');
    });
  });

  describe('AI prompt construction', () => {
    it('should pass page context to AI provider via prompt', async () => {
      // Given: specific page context
      const ai_provider: AiSelectorProvider = vi.fn().mockResolvedValue('#result');
      const mock_page = create_mock_page({
        url: vi.fn().mockReturnValue('https://app.example.com/settings'),
        title: vi.fn().mockResolvedValue('Settings Page'),
      });

      const service = create_selector_repair_service({
        screenshot_dir,
        repair_log_path: log_path,
        ai_provider,
      });

      // When: repair is called
      await service.repair(
        mock_page as unknown as import('playwright').Page,
        'button.save-settings',
        'click the save button',
      );

      // Then: prompt contains all relevant context
      const prompt = (ai_provider as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(prompt).toContain('button.save-settings');
      expect(prompt).toContain('https://app.example.com/settings');
      expect(prompt).toContain('Settings Page');
      expect(prompt).toContain('click the save button');
    });
  });
});
