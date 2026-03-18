// Task executor with action routing
// Dispatches tasks to Playwright-based browser handlers or structured TODOs

import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright';
import type { Task, HunterActionType, HunterTaskResult } from '../shared/types.js';
import type { Logger } from './logger.js';
import type { BrowserManager } from './browser.js';

type ActionHandler = (task: Task) => Promise<HunterTaskResult>;

// Maximum characters to extract from page content
const MAX_CONTENT_LENGTH = 10_000;

// Output directory for screenshots and artifacts
const OUTPUT_DIR = './output';

// Polling interval for checking research completion (ms)
const RESEARCH_POLL_INTERVAL_MS = 10_000;

// ===== URL extraction helper =====
// Extracts the first http/https URL from a text string
export const extract_url = (text: string): string | null => {
  const match = text.match(/https?:\/\/[^\s<>"')\]]+/);
  return match ? match[0] : null;
};

// ===== Login wall detection helper =====
// Checks if the current page is showing a Google login/sign-in screen.
// Google services redirect to accounts.google.com when not authenticated.
export const detect_login_wall = async (page: Page): Promise<boolean> => {
  const url = page.url();

  // Primary check: URL-based detection — Google login always redirects here
  if (url.includes('accounts.google.com')) {
    return true;
  }

  // Secondary check: look for "Sign in" button or heading on the page
  // This catches cases where the login form is embedded or URL hasn't changed yet
  try {
    const sign_in_visible = await page.locator('text="Sign in"').first().isVisible({ timeout: 2_000 });
    if (sign_in_visible) {
      // Confirm it's actually a login page, not just a page mentioning "Sign in"
      const has_google_branding = await page.locator('[data-ogsr-up], #identifierId, [data-email], input[type="email"]')
        .first().isVisible({ timeout: 1_000 }).catch(() => false);
      return has_google_branding;
    }
  } catch {
    // Timeout or element not found — not a login wall
  }

  return false;
};

// Resolve action type from task title/description keywords
export const resolve_action = (task: Task): HunterActionType => {
  const text = `${task.title} ${task.description ?? ''}`.toLowerCase();

  if (text.includes('notebooklm') || text.includes('notebook_lm')) return 'notebooklm_verify';
  if (text.includes('deep research') || text.includes('deep_research')) return 'deep_research';
  if (text.includes('crawl') || text.includes('scrape') || text.includes('크롤링')) return 'web_crawl';
  return 'browser_task'; // default fallback
};

export type TaskExecutorConfig = {
  google_profile_dir: string;
  deep_research_timeout_ms: number;
  notebooklm_timeout_ms: number;
};

export const create_task_executor = (
  logger: Logger,
  browser: BrowserManager,
  config?: TaskExecutorConfig,
) => {
  // Default config for backwards compatibility
  const executor_config: TaskExecutorConfig = config ?? {
    google_profile_dir: './fas-google-profile-hunter',
    deep_research_timeout_ms: 300_000,
    notebooklm_timeout_ms: 180_000,
  };

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
  // Automates Gemini Deep Research via persistent Chrome profile.
  // Flow: navigate to Gemini → type research query → wait for completion → extract results
  const handle_deep_research: ActionHandler = async (task) => {
    logger.info(`deep_research: starting for task ${task.id}`);
    let page: Page | undefined;

    try {
      // Step 1: Get a page from the persistent Google profile
      page = await browser.get_persistent_page(executor_config.google_profile_dir);

      // Step 2: Navigate to Gemini web app
      await page.goto('https://gemini.google.com/app', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      // Wait for page to fully load (Gemini is a SPA, needs extra time)
      await page.waitForTimeout(3_000);

      // Step 3: Check for login wall — if not authenticated, report back
      if (await detect_login_wall(page)) {
        logger.warn(`deep_research: Google login required for task ${task.id}`);
        return {
          status: 'failure',
          output: '[LOGIN_REQUIRED] Google login session expired. Run setup_hunter.sh to re-authenticate.',
          files: [],
        };
      }

      // Step 4: Find the chat input textarea
      // Gemini uses a rich text editor — try multiple selector strategies
      const input_selector = [
        // Rich text editor contenteditable div (primary)
        '[contenteditable="true"][role="textbox"]',
        // Fallback: aria-label based selector
        '[aria-label*="prompt" i]',
        // Fallback: generic rich text input
        '.ql-editor',
        // Fallback: plain textarea
        'textarea',
      ].join(', ');

      const input = page.locator(input_selector).first();
      await input.waitFor({ state: 'visible', timeout: 15_000 });

      // Step 5: Type the research query with "Deep Research:" prefix
      const query = `Deep Research: ${task.description ?? task.title}`;
      await input.click();
      await input.fill(query);
      logger.info(`deep_research: typed query for task ${task.id}`);

      // Step 6: Click the send button
      // Gemini's send button uses various selectors depending on version
      const send_selector = [
        // Send button by aria-label
        '[aria-label*="Send" i]',
        '[aria-label*="submit" i]',
        // Material icon send button
        'button[mattooltip*="Send" i]',
        // Fallback: button with send icon near the input
        'button.send-button',
      ].join(', ');

      const send_button = page.locator(send_selector).first();
      await send_button.waitFor({ state: 'visible', timeout: 5_000 });
      await send_button.click();
      logger.info(`deep_research: query submitted for task ${task.id}`);

      // Step 7: Wait for research completion via polling
      // Deep Research can take 1-5 minutes. We poll every 10 seconds
      // looking for completion indicators in the response area.
      const deadline = Date.now() + executor_config.deep_research_timeout_ms;
      let research_complete = false;

      while (Date.now() < deadline) {
        await page.waitForTimeout(RESEARCH_POLL_INTERVAL_MS);

        // Check for completion indicators:
        // - "Deep Research is complete" text
        // - Research report/result container
        // - Stop/regenerate button appearing (indicates generation finished)
        const page_text = await page.textContent('body') ?? '';
        const completion_indicators = [
          'deep research is complete',
          'research complete',
          'research report',
          'here is the research',
          'based on my research',
        ];

        const found_indicator = completion_indicators.some(
          (indicator) => page_text.toLowerCase().includes(indicator),
        );

        if (found_indicator) {
          research_complete = true;
          logger.info(`deep_research: research completed for task ${task.id}`);
          break;
        }

        // Also check if response has stopped generating (no loading spinner)
        const is_loading = await page.locator('[class*="loading"], [class*="spinner"], [class*="progress"]')
          .first().isVisible({ timeout: 1_000 }).catch(() => false);

        // If we have substantial text and no loading indicator, consider it done
        if (!is_loading && page_text.length > 500) {
          // Check if the response area has content (model finished generating)
          const response_containers = page.locator('[class*="response"], [class*="message-content"], .model-response');
          const response_count = await response_containers.count();
          if (response_count > 0) {
            const last_response_text = await response_containers.last().textContent() ?? '';
            if (last_response_text.length > 200) {
              research_complete = true;
              logger.info(`deep_research: response detected (no loading indicator) for task ${task.id}`);
              break;
            }
          }
        }

        logger.info(`deep_research: still waiting... (${Math.round((deadline - Date.now()) / 1000)}s remaining)`);
      }

      if (!research_complete) {
        logger.warn(`deep_research: timeout waiting for research completion (task ${task.id})`);
        // Still try to extract whatever is on the page
      }

      // Step 8: Extract the research result text
      // Try to get the latest model response from the conversation
      const response_selectors = [
        // Model response containers (Gemini-specific)
        '[class*="model-response"]',
        '[class*="response-container"]',
        '[class*="message-content"]',
        // Markdown rendered content area
        '.markdown-content',
        '[class*="markdown"]',
        // Fallback: the main content area
        'main',
      ];

      let result_text = '';
      for (const selector of response_selectors) {
        const elements = page.locator(selector);
        const count = await elements.count();
        if (count > 0) {
          // Get the last response element (most recent answer)
          result_text = await elements.last().textContent() ?? '';
          if (result_text.trim().length > 100) {
            break;
          }
        }
      }

      // Fallback: extract full body text if no specific response found
      if (result_text.trim().length < 100) {
        result_text = await page.textContent('body') ?? '';
      }

      // Step 9: Return success with extracted text (truncated)
      const trimmed = result_text.trim().slice(0, MAX_CONTENT_LENGTH);
      logger.info(`deep_research: extracted ${trimmed.length} chars for task ${task.id}`);

      return {
        status: 'success',
        output: trimmed,
        files: [],
      };
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.error(`deep_research failed for task ${task.id}: ${error_msg}`);
      return {
        status: 'failure',
        output: `deep_research error: ${error_msg}`,
        files: [],
      };
    } finally {
      // Close the page but keep the persistent context alive for session reuse
      if (page) {
        try { await page.close(); } catch { /* ignore cleanup errors */ }
      }
    }
  };

  // ===== notebooklm_verify handler =====
  // Automates NotebookLM verification via persistent Chrome profile.
  // Flow: navigate to NotebookLM → open notebook → ask verification query → extract response
  const handle_notebooklm_verify: ActionHandler = async (task) => {
    logger.info(`notebooklm_verify: starting for task ${task.id}`);
    let page: Page | undefined;

    try {
      const task_text = `${task.title} ${task.description ?? ''}`;

      // Step 1: Get a page from the persistent Google profile
      page = await browser.get_persistent_page(executor_config.google_profile_dir);

      // Step 2: Check if the task contains a direct notebook URL
      const notebook_url = extract_url(task_text);
      const target_url = notebook_url && notebook_url.includes('notebooklm.google.com')
        ? notebook_url
        : 'https://notebooklm.google.com/';

      await page.goto(target_url, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      // Wait for SPA to fully render
      await page.waitForTimeout(3_000);

      // Step 3: Check for login wall
      if (await detect_login_wall(page)) {
        logger.warn(`notebooklm_verify: Google login required for task ${task.id}`);
        return {
          status: 'failure',
          output: '[LOGIN_REQUIRED] Google login session expired. Run setup_hunter.sh to re-authenticate.',
          files: [],
        };
      }

      // Step 4: If we navigated to the main page (not a direct notebook URL),
      // try to find the notebook by name in the list
      if (!notebook_url || !notebook_url.includes('notebooklm.google.com/notebook/')) {
        // Extract notebook name from task description
        // Expected format: "notebooklm: <notebook_name> — <query>" or similar
        const notebook_name_match = task_text.match(/notebook[_\s]*(?:lm)?[:\s]+([^—\-\n]+)/i);
        const notebook_name = notebook_name_match?.[1]?.trim();

        if (notebook_name) {
          // Look for notebook in the list by its title text
          const notebook_link = page.locator(`text="${notebook_name}"`).first();
          const is_visible = await notebook_link.isVisible({ timeout: 10_000 }).catch(() => false);

          if (is_visible) {
            await notebook_link.click();
            await page.waitForTimeout(3_000); // Wait for notebook to open
            logger.info(`notebooklm_verify: opened notebook "${notebook_name}"`);
          } else {
            logger.warn(`notebooklm_verify: notebook "${notebook_name}" not found in list`);
            return {
              status: 'failure',
              output: `Notebook "${notebook_name}" not found in NotebookLM. Available notebooks may have different names.`,
              files: [],
            };
          }
        }
        // If no notebook name specified and no URL, we proceed with whatever is open
      }

      // Step 5: Find the chat/ask input in NotebookLM
      // NotebookLM has a chat interface at the bottom of the notebook view
      const chat_input_selector = [
        // NotebookLM chat input area
        '[contenteditable="true"]',
        'textarea[placeholder*="Ask" i]',
        'textarea[placeholder*="question" i]',
        // Generic textarea fallback
        'textarea',
        // Input with role
        '[role="textbox"]',
      ].join(', ');

      const chat_input = page.locator(chat_input_selector).first();
      await chat_input.waitFor({ state: 'visible', timeout: 15_000 });

      // Step 6: Extract the verification query from task description
      // Try to get the query part after the notebook name
      let query = task.description ?? task.title;
      // Strip out notebook name/URL prefix if present
      const query_match = query.match(/[—\-:]\s*(.+)$/s);
      if (query_match) {
        query = query_match[1].trim();
      }

      await chat_input.click();
      await chat_input.fill(query);
      logger.info(`notebooklm_verify: typed verification query for task ${task.id}`);

      // Step 7: Submit the query — press Enter or click send
      // Try send button first, fall back to Enter key
      const send_button = page.locator(
        '[aria-label*="Send" i], [aria-label*="Ask" i], button[type="submit"]',
      ).first();
      const send_visible = await send_button.isVisible({ timeout: 3_000 }).catch(() => false);

      if (send_visible) {
        await send_button.click();
      } else {
        await chat_input.press('Enter');
      }
      logger.info(`notebooklm_verify: query submitted for task ${task.id}`);

      // Step 8: Wait for the response to appear
      // NotebookLM typically responds within 10-60 seconds
      const deadline = Date.now() + executor_config.notebooklm_timeout_ms;
      let response_text = '';

      while (Date.now() < deadline) {
        await page.waitForTimeout(5_000);

        // Look for response containers in the chat area
        const response_selectors = [
          // NotebookLM AI response bubbles
          '[class*="response"]',
          '[class*="answer"]',
          '[class*="message"][class*="model"]',
          '[class*="assistant"]',
          // Markdown content in response
          '.markdown-content',
        ];

        for (const selector of response_selectors) {
          const elements = page.locator(selector);
          const count = await elements.count();
          if (count > 0) {
            const last_text = await elements.last().textContent() ?? '';
            if (last_text.trim().length > response_text.trim().length) {
              response_text = last_text;
            }
          }
        }

        // Check if loading indicator has disappeared (response complete)
        const is_loading = await page.locator(
          '[class*="loading"], [class*="spinner"], [class*="typing"]',
        ).first().isVisible({ timeout: 1_000 }).catch(() => false);

        if (!is_loading && response_text.trim().length > 50) {
          logger.info(`notebooklm_verify: response received for task ${task.id}`);
          break;
        }
      }

      // Fallback: if no specific response element found, grab the page text
      if (response_text.trim().length < 50) {
        response_text = await page.textContent('body') ?? '';
      }

      // Step 9: Return success with extracted text (truncated)
      const trimmed = response_text.trim().slice(0, MAX_CONTENT_LENGTH);
      logger.info(`notebooklm_verify: extracted ${trimmed.length} chars for task ${task.id}`);

      return {
        status: 'success',
        output: trimmed,
        files: [],
      };
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.error(`notebooklm_verify failed for task ${task.id}: ${error_msg}`);
      return {
        status: 'failure',
        output: `notebooklm_verify error: ${error_msg}`,
        files: [],
      };
    } finally {
      // Close the page but keep the persistent context alive for session reuse
      if (page) {
        try { await page.close(); } catch { /* ignore cleanup errors */ }
      }
    }
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
