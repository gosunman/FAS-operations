// Task executor with action routing
// Dispatches tasks to Playwright-based browser handlers or structured TODOs

import { mkdirSync } from 'node:fs';
import type { Task, HunterActionType, HunterTaskResult } from '../shared/types.js';
import type { Logger } from './logger.js';
import type { BrowserManager } from './browser.js';

type ActionHandler = (task: Task) => Promise<HunterTaskResult>;

// Maximum characters to extract from page content
const MAX_CONTENT_LENGTH = 10_000;

// Output directory for screenshots and artifacts
const OUTPUT_DIR = './output';

// ===== URL extraction helper =====
// Extracts the first http/https URL from a text string
export const extract_url = (text: string): string | null => {
  const match = text.match(/https?:\/\/[^\s<>"')\]]+/);
  return match ? match[0] : null;
};

// Resolve action type from task title/description keywords
export const resolve_action = (task: Task): HunterActionType => {
  const text = `${task.title} ${task.description ?? ''}`.toLowerCase();

  if (text.includes('notebooklm') || text.includes('notebook_lm')) return 'notebooklm_verify';
  if (text.includes('deep research') || text.includes('deep_research')) return 'deep_research';
  if (text.includes('crawl') || text.includes('scrape') || text.includes('크롤링')) return 'web_crawl';
  return 'browser_task'; // default fallback
};

export const create_task_executor = (logger: Logger, browser: BrowserManager) => {
  // ===== web_crawl handler =====
  // Navigates to URL, extracts page title and text content
  const handle_web_crawl: ActionHandler = async (task) => {
    const text = `${task.title} ${task.description ?? ''}`;
    const url = extract_url(text);

    if (!url) {
      logger.warn(`web_crawl: no URL found in task ${task.id}`);
      return {
        status: 'failure',
        output: `No URL found in task description: "${text}"`,
        files: [],
      };
    }

    logger.info(`web_crawl: navigating to ${url}`);
    let page;
    try {
      page = await browser.get_page();
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const title = await page.title();
      const body_text = await page.textContent('body') ?? '';
      const trimmed = body_text.trim().slice(0, MAX_CONTENT_LENGTH);

      logger.info(`web_crawl: extracted ${trimmed.length} chars from ${url}`);

      return {
        status: 'success',
        output: `Title: ${title}\nURL: ${url}\n\n${trimmed}`,
        files: [],
      };
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.error(`web_crawl failed for ${url}: ${error_msg}`);
      return {
        status: 'failure',
        output: `web_crawl error for ${url}: ${error_msg}`,
        files: [],
      };
    } finally {
      // Close the page context to free resources
      if (page) {
        try { await page.context().close(); } catch { /* ignore cleanup errors */ }
      }
    }
  };

  // ===== browser_task handler =====
  // Generic browser interaction: navigate, screenshot, extract text
  const handle_browser_task: ActionHandler = async (task) => {
    const text = `${task.title} ${task.description ?? ''}`;
    const url = extract_url(text);

    if (!url) {
      logger.warn(`browser_task: no URL found in task ${task.id}`);
      return {
        status: 'failure',
        output: `No URL found in task description: "${text}"`,
        files: [],
      };
    }

    logger.info(`browser_task: navigating to ${url}`);
    let page;
    try {
      page = await browser.get_page();
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const title = await page.title();
      const body_text = await page.textContent('body') ?? '';
      const trimmed = body_text.trim().slice(0, MAX_CONTENT_LENGTH);

      // Save screenshot to output directory
      mkdirSync(OUTPUT_DIR, { recursive: true });
      const screenshot_path = `${OUTPUT_DIR}/${task.id}.png`;
      await page.screenshot({ path: screenshot_path, fullPage: true });

      logger.info(`browser_task: screenshot saved to ${screenshot_path}`);

      return {
        status: 'success',
        output: `Title: ${title}\nURL: ${url}\nScreenshot: ${screenshot_path}\n\n${trimmed}`,
        files: [screenshot_path],
      };
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.error(`browser_task failed for ${url}: ${error_msg}`);
      return {
        status: 'failure',
        output: `browser_task error for ${url}: ${error_msg}`,
        files: [],
      };
    } finally {
      if (page) {
        try { await page.context().close(); } catch { /* ignore cleanup errors */ }
      }
    }
  };

  // ===== deep_research handler =====
  // TODO: Requires Gemini web UI automation via OpenClaw
  // TODO: Steps needed:
  //   1. Open Gemini Deep Research UI in browser
  //   2. Input research query from task description
  //   3. Wait for research completion (can take minutes)
  //   4. Extract research results
  //   5. Return structured output
  // TODO: Pending OpenClaw browser automation integration
  const handle_deep_research: ActionHandler = async (task) => {
    logger.warn(`deep_research: NOT IMPLEMENTED — requires Gemini web UI automation (task: ${task.id})`);
    logger.info('Deep Research requires Gemini web UI automation — pending OpenClaw integration');

    return {
      status: 'failure',
      output: '[NOT_IMPLEMENTED] Deep Research requires Gemini web UI automation — pending OpenClaw integration',
      files: [],
    };
  };

  // ===== notebooklm_verify handler =====
  // TODO: Requires NotebookLM web interaction via OpenClaw
  // TODO: Steps needed:
  //   1. Open NotebookLM web UI in browser
  //   2. Upload/reference source documents
  //   3. Input verification query from task description
  //   4. Extract verification results
  //   5. Return structured pass/fail output
  // TODO: Pending OpenClaw browser automation integration
  const handle_notebooklm_verify: ActionHandler = async (task) => {
    logger.warn(`notebooklm_verify: NOT IMPLEMENTED — requires NotebookLM web automation (task: ${task.id})`);
    logger.info('NotebookLM verification requires NotebookLM web UI automation — pending OpenClaw integration');

    return {
      status: 'failure',
      output: '[NOT_IMPLEMENTED] NotebookLM verification requires NotebookLM web UI automation — pending OpenClaw integration',
      files: [],
    };
  };

  // Action router
  const action_map: Record<HunterActionType, ActionHandler> = {
    notebooklm_verify: handle_notebooklm_verify,
    deep_research: handle_deep_research,
    web_crawl: handle_web_crawl,
    browser_task: handle_browser_task,
  };

  // Execute a task — resolves action type and dispatches to handler
  const execute = async (task: Task): Promise<HunterTaskResult> => {
    const action = resolve_action(task);
    logger.info(`Executing task ${task.id}: action=${action}, title="${task.title}"`);

    try {
      const handler = action_map[action];
      return await handler(task);
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.error(`Task ${task.id} execution failed: ${error_msg}`);
      return {
        status: 'failure',
        output: `Execution error: ${error_msg}`,
        files: [],
      };
    }
  };

  return { execute, resolve_action };
};
