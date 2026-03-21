// AI Vision-based CSS selector repair service for Playwright
// Adapted from B.A.P.'s SelectorRepairService for the FAS functional architecture
//
// When a CSS selector fails to find an element on a page, this service:
// 1. Takes a screenshot of the current page state
// 2. Sends the screenshot + broken selector context to an AI model (Gemini CLI)
// 3. Returns a repaired CSS selector
// 4. Logs all repairs for future code updates
//
// Used by: Hunter agent's browser automation (task_executor)

import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { Page } from 'playwright';

// === Types ===

// AI provider function type: takes a prompt, returns a suggested selector or null
export type AiSelectorProvider = (prompt: string) => Promise<string | null>;

export type SelectorRepairConfig = {
  // Directory to save screenshots for AI analysis (default: './output/selector-repair')
  screenshot_dir: string;
  // File to log all repairs for future code updates (default: './logs/selector-repairs.jsonl')
  repair_log_path: string;
  // Maximum repair attempts per broken selector (default: 2)
  max_repair_attempts: number;
  // Custom AI provider function (default: Gemini CLI spawner)
  // Inject a custom provider for testing or to use a different AI backend
  ai_provider?: AiSelectorProvider;
  // Gemini CLI command — only used when ai_provider is not set (default: 'gemini')
  gemini_command: string;
  // Timeout for AI response — only used when ai_provider is not set (default: 60_000 ms)
  ai_timeout_ms: number;
};

export type SelectorRepairResult = {
  success: boolean;
  original_selector: string;
  repaired_selector: string | null;
  attempts: number;
  error?: string;
};

export type SelectorRepairLogEntry = {
  timestamp: string;
  url: string;
  original_selector: string;
  repaired_selector: string | null;
  intended_action: string;
  success: boolean;
  attempts: number;
  error?: string;
};

export type SelectorRepairService = {
  // Attempt to repair a broken CSS selector using AI vision
  repair: (
    page: Page,
    broken_selector: string,
    intended_action: string,
  ) => Promise<SelectorRepairResult>;
};

// === Constants ===

const DEFAULT_CONFIG: Omit<SelectorRepairConfig, 'ai_provider'> = {
  screenshot_dir: './output/selector-repair',
  repair_log_path: './logs/selector-repairs.jsonl',
  max_repair_attempts: 2,
  gemini_command: 'gemini',
  ai_timeout_ms: 60_000,
} as const;

// === Selector Validation ===

// Basic heuristic to check if a string could be a CSS selector
export const is_plausible_selector = (text: string): boolean => {
  // Must not be too long (selectors rarely exceed 200 chars)
  if (text.length > 200) return false;
  // Must not contain newlines (selector is a single expression)
  if (text.includes('\n')) return false;
  // Reject if it looks like a natural language sentence (contains spaces followed by lowercase words)
  if (/^[A-Z][a-z]+\s+\w/.test(text) && text.includes(' ')) return false;
  // Should start with a typical selector character or tag name
  if (/^[a-zA-Z][\w-]*(\s*[>+~.,#\[:@]|$)/.test(text)) return true;
  // Allow id, class, attribute, universal, pseudo selectors
  if (/^[#.\[\*:]/.test(text)) return true;
  return false;
};

// === Default AI Provider (Gemini CLI) ===

// Spawns Gemini CLI with a repair prompt and returns the suggested selector.
// Used as the default ai_provider when none is injected.
const create_gemini_provider = (
  gemini_command: string,
  ai_timeout_ms: number,
): AiSelectorProvider => {
  return (prompt: string): Promise<string | null> => {
    return new Promise((resolve) => {
      const proc = spawn(gemini_command, [prompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: ai_timeout_ms,
        shell: true,
        env: { ...process.env, NO_COLOR: '1' },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          console.warn(`[SelectorRepair] Gemini CLI exited with code ${code}: ${stderr.trim()}`);
          resolve(null);
          return;
        }

        // Clean the response: remove ANSI codes, markdown code blocks, and whitespace
        const cleaned = stdout
          .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')  // ANSI escape codes
          .replace(/```[\s\S]*?```/g, (match) =>    // Extract from code blocks
            match.replace(/```\w*\n?/g, '').replace(/```/g, ''),
          )
          .trim();

        // Validate the result looks like a CSS selector (basic sanity check)
        if (cleaned && is_plausible_selector(cleaned)) {
          resolve(cleaned);
        } else {
          console.warn(`[SelectorRepair] AI response doesn't look like a valid selector: "${cleaned}"`);
          resolve(null);
        }
      });

      proc.on('error', (err) => {
        console.warn(`[SelectorRepair] Failed to spawn Gemini CLI: ${err.message}`);
        resolve(null);
      });
    });
  };
};

// === Repair Log ===

// Append a repair log entry to a JSONL file for audit and future code updates
const log_repair = (log_path: string, entry: SelectorRepairLogEntry): void => {
  try {
    const dir = join(log_path, '..');
    mkdirSync(dir, { recursive: true });
    appendFileSync(log_path, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    // Non-critical — log to console if file write fails
    console.warn(
      `[SelectorRepair] Failed to write repair log: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};

// === Screenshot Helper ===

// Take a screenshot of the current page state for AI analysis context
const capture_screenshot = async (page: Page, screenshot_dir: string): Promise<string | null> => {
  try {
    mkdirSync(screenshot_dir, { recursive: true });
    const filename = `repair_${Date.now()}.png`;
    const screenshot_path = join(screenshot_dir, filename);
    await page.screenshot({ path: screenshot_path, fullPage: false });
    return screenshot_path;
  } catch (err) {
    console.warn(
      `[SelectorRepair] Screenshot failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
};

// === Build AI Prompt ===

export const build_repair_prompt = (
  url: string,
  broken_selector: string,
  intended_action: string,
  page_title: string,
  screenshot_path: string | null,
): string => {
  const lines = [
    'You are an expert web automation engineer specializing in CSS selectors.',
    '',
    `The CSS selector "${broken_selector}" no longer works on the page.`,
    `Page URL: ${url}`,
    `Page title: ${page_title}`,
    `Intended action: ${intended_action}`,
  ];

  if (screenshot_path) {
    lines.push(`Screenshot saved at: ${screenshot_path}`);
  }

  lines.push(
    '',
    'Please deduce a more robust CSS selector that would target the intended element.',
    'Use strategies like:',
    '- Semantic attributes (aria-label, role, data-testid)',
    '- Stable structural selectors (closest unique parent + child)',
    '- Text-based selectors with attribute contains',
    '',
    'Return ONLY the new CSS selector string. No markdown, no backticks, no explanation.',
  );

  return lines.join('\n');
};

// === Factory ===

/**
 * Creates a selector repair service that uses AI to fix broken CSS selectors.
 *
 * Usage:
 *   const repair_service = create_selector_repair_service();
 *   const result = await repair_service.repair(page, 'button.old-class', 'click submit button');
 *   if (result.success && result.repaired_selector) {
 *     await page.click(result.repaired_selector);
 *   }
 *
 * For testing, inject a custom ai_provider:
 *   const service = create_selector_repair_service({
 *     ai_provider: async (prompt) => '#mock-selector',
 *   });
 */
export const create_selector_repair_service = (
  config: Partial<SelectorRepairConfig> = {},
): SelectorRepairService => {
  const resolved: SelectorRepairConfig = { ...DEFAULT_CONFIG, ...config };

  // Use injected AI provider, or fall back to Gemini CLI spawner
  const ai_provider: AiSelectorProvider = resolved.ai_provider
    ?? create_gemini_provider(resolved.gemini_command, resolved.ai_timeout_ms);

  const repair = async (
    page: Page,
    broken_selector: string,
    intended_action: string,
  ): Promise<SelectorRepairResult> => {
    const url = page.url();
    let page_title = '';
    try {
      page_title = await page.title();
    } catch {
      page_title = '(unable to read title)';
    }

    console.log(`[SelectorRepair] Repairing selector "${broken_selector}" on ${url}`);
    console.log(`[SelectorRepair] Intended action: ${intended_action}`);

    let last_error: string | undefined;

    for (let attempt = 1; attempt <= resolved.max_repair_attempts; attempt++) {
      console.log(`[SelectorRepair] Attempt ${attempt}/${resolved.max_repair_attempts}...`);

      // Step 1: Capture screenshot for context
      const screenshot_path = await capture_screenshot(page, resolved.screenshot_dir);

      // Step 2: Build prompt and ask AI
      const prompt = build_repair_prompt(
        url,
        broken_selector,
        intended_action,
        page_title,
        screenshot_path,
      );

      const candidate = await ai_provider(prompt);

      if (!candidate) {
        last_error = 'AI returned no valid selector candidate';
        continue;
      }

      // Step 3: Validate the candidate selector actually finds an element
      try {
        const element = await page.waitForSelector(candidate, { timeout: 5_000 });
        if (element) {
          console.log(`[SelectorRepair] Successfully repaired: "${broken_selector}" → "${candidate}"`);

          // Log the successful repair
          log_repair(resolved.repair_log_path, {
            timestamp: new Date().toISOString(),
            url,
            original_selector: broken_selector,
            repaired_selector: candidate,
            intended_action,
            success: true,
            attempts: attempt,
          });

          return {
            success: true,
            original_selector: broken_selector,
            repaired_selector: candidate,
            attempts: attempt,
          };
        }
      } catch {
        last_error = `Candidate selector "${candidate}" did not match any element`;
        console.warn(`[SelectorRepair] ${last_error}`);
      }
    }

    // All attempts exhausted — log failure
    console.error(
      `[SelectorRepair] Failed to repair "${broken_selector}" after ${resolved.max_repair_attempts} attempts`,
    );

    log_repair(resolved.repair_log_path, {
      timestamp: new Date().toISOString(),
      url,
      original_selector: broken_selector,
      repaired_selector: null,
      intended_action,
      success: false,
      attempts: resolved.max_repair_attempts,
      error: last_error,
    });

    return {
      success: false,
      original_selector: broken_selector,
      repaired_selector: null,
      attempts: resolved.max_repair_attempts,
      error: last_error,
    };
  };

  return { repair };
};
