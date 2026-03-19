// Browser manager for Hunter agent
// Manages Playwright browser lifecycle with lazy initialization and cleanup
// Uses Chromium via Playwright for all browser automation tasks
//
// Two modes:
// 1. get_page() — Ephemeral browser for web_crawl/browser_task (headless OK)
// 2. get_persistent_page() — Persistent Chrome profile for Google services
//    (Gemini Deep Research, NotebookLM) that require cookie-based login

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';

export type BrowserManagerConfig = {
  headless?: boolean;    // default: true
  timeout_ms?: number;   // default: 30_000
};

export type BrowserManager = {
  // Get a new page (lazy-initializes browser on first call)
  get_page: () => Promise<Page>;
  // Get a page from persistent Chrome profile (for Google login sessions)
  get_persistent_page: (profile_dir: string) => Promise<Page>;
  // Close the persistent context only
  close_persistent: () => Promise<void>;
  // Close browser and release resources
  close: () => Promise<void>;
};

const DEFAULT_CONFIG: Required<BrowserManagerConfig> = {
  headless: true,
  timeout_ms: 30_000,
};

// Factory function to create a browser manager instance
export const create_browser_manager = (config: BrowserManagerConfig = {}): BrowserManager => {
  const resolved = { ...DEFAULT_CONFIG, ...config };
  let browser: Browser | null = null;

  // Persistent context state — only one at a time
  let persistent_context: BrowserContext | null = null;
  let persistent_profile_dir: string | null = null;

  // Lazy initialization — browser is launched only on first get_page() call
  const ensure_browser = async (): Promise<Browser> => {
    if (!browser || !browser.isConnected()) {
      browser = await chromium.launch({
        headless: resolved.headless,
        // Use system-installed Chrome instead of Playwright's bundled Chromium.
        // Bundled Chromium (Chrome for Testing) crashes on macOS 26 Tahoe.
        channel: 'chrome',
      });
    }
    return browser;
  };

  const get_page = async (): Promise<Page> => {
    const b = await ensure_browser();
    const context = await b.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(resolved.timeout_ms);
    page.setDefaultNavigationTimeout(resolved.timeout_ms);
    return page;
  };

  // Get a page from a persistent Chrome profile directory.
  // Google services (Gemini, NotebookLM) require non-headless mode for cookie persistence.
  // Only one persistent context is active at a time — if the profile_dir changes,
  // the previous context is closed before opening the new one.
  const get_persistent_page = async (profile_dir: string): Promise<Page> => {
    // If profile_dir changed, close the old persistent context
    if (persistent_context && persistent_profile_dir !== profile_dir) {
      try { await persistent_context.close(); } catch { /* ignore cleanup errors */ }
      persistent_context = null;
      persistent_profile_dir = null;
    }

    // Create persistent context if needed
    if (!persistent_context) {
      persistent_context = await chromium.launchPersistentContext(profile_dir, {
        // Google services block headless browsers — must use headed mode
        headless: false,
        // Use system-installed Chrome instead of Playwright's bundled Chromium.
        // Bundled Chromium (Chrome for Testing) crashes on macOS 26 Tahoe.
        channel: 'chrome',
        // Standard viewport for consistent UI interaction
        viewport: { width: 1280, height: 900 },
      });
      persistent_profile_dir = profile_dir;
    }

    const page = await persistent_context.newPage();
    page.setDefaultTimeout(resolved.timeout_ms);
    page.setDefaultNavigationTimeout(resolved.timeout_ms);
    return page;
  };

  // Close only the persistent context (preserves the ephemeral browser)
  const close_persistent = async (): Promise<void> => {
    if (persistent_context) {
      try { await persistent_context.close(); } catch { /* ignore cleanup errors */ }
      persistent_context = null;
      persistent_profile_dir = null;
    }
  };

  const close = async (): Promise<void> => {
    // Close persistent context first
    await close_persistent();

    // Then close the ephemeral browser
    if (browser && browser.isConnected()) {
      await browser.close();
      browser = null;
    }
  };

  return { get_page, get_persistent_page, close_persistent, close };
};
