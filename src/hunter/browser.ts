// Browser manager for Hunter agent
// Manages Playwright browser lifecycle with lazy initialization and cleanup
// Uses Chromium via Playwright for all browser automation tasks

import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';

export type BrowserManagerConfig = {
  headless?: boolean;    // default: true
  timeout_ms?: number;   // default: 30_000
};

export type BrowserManager = {
  // Get a new page (lazy-initializes browser on first call)
  get_page: () => Promise<Page>;
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

  // Lazy initialization — browser is launched only on first get_page() call
  const ensure_browser = async (): Promise<Browser> => {
    if (!browser || !browser.isConnected()) {
      browser = await chromium.launch({
        headless: resolved.headless,
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

  const close = async (): Promise<void> => {
    if (browser && browser.isConnected()) {
      await browser.close();
      browser = null;
    }
  };

  return { get_page, close };
};
