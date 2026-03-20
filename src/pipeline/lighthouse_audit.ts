// Lighthouse CI Audit Module — Performance/SEO/Accessibility auditing
// Wraps the lighthouse CLI to run periodic audits, track history, and detect degradation.
//
// SECURITY NOTE: child_process.exec is used intentionally for `npx lighthouse` CLI invocation.
// This requires shell features (npx resolution). The URL input comes exclusively from
// LighthouseConfig.urls (trusted config), never from untrusted user input.

import { exec } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// === Types ===

export type LighthouseConfig = {
  urls: string[];                     // URLs to audit
  thresholds?: LighthouseThresholds;  // Custom thresholds
  history_path?: string;              // Default: state/lighthouse_history.json
  timeout_ms?: number;                // Default: 120_000
};

export type LighthouseThresholds = {
  performance?: number;   // Default: 70
  seo?: number;           // Default: 80
  accessibility?: number; // Default: 80
  fcp_ms?: number;        // Default: 3000
  lcp_ms?: number;        // Default: 4000
};

export type AuditResult = {
  url: string;
  timestamp: string;
  scores: { performance: number; seo: number; accessibility: number };
  metrics: { fcp_ms: number; lcp_ms: number; tbt_ms: number; cls: number };
  violations: string[];
  raw_report_path?: string;
};

// === Internal types for lighthouse JSON output ===

type LighthouseRawOutput = {
  categories: {
    performance?: { score: number | null };
    seo?: { score: number | null };
    accessibility?: { score: number | null };
  };
  audits: {
    'first-contentful-paint'?: { numericValue: number };
    'largest-contentful-paint'?: { numericValue: number };
    'total-blocking-time'?: { numericValue: number };
    'cumulative-layout-shift'?: { numericValue: number };
  };
};

// History is keyed by URL, each URL has an array of audit results
type AuditHistory = Record<string, AuditResult[]>;

// === Constants ===

const DEFAULT_HISTORY_PATH = 'state/lighthouse_history.json';
const DEFAULT_TIMEOUT_MS = 120_000;

const DEFAULT_THRESHOLDS: Required<LighthouseThresholds> = {
  performance: 70,
  seo: 80,
  accessibility: 80,
  fcp_ms: 3000,
  lcp_ms: 4000,
};

// Degradation threshold: score dropped by this many points from previous run
const DEGRADATION_THRESHOLD = 10;

// === Helper: promisified exec wrapper for lighthouse CLI ===
// Uses exec (not execFile) because `npx lighthouse` requires shell resolution.
// URL is from trusted config only — no injection risk.

const run_lighthouse_cli = (url: string, timeout_ms: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const cmd = `npx lighthouse ${url} --output=json --chrome-flags="--headless --no-sandbox"`;

    exec(cmd, { timeout: timeout_ms, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, _stderr) => {
      if (error) {
        // Check for timeout (killed process)
        const exec_error = error as Error & { killed?: boolean; signal?: string };
        if (exec_error.killed || exec_error.signal === 'SIGTERM') {
          reject(new Error(`Lighthouse audit timed out after ${timeout_ms}ms for ${url}`));
          return;
        }
        reject(new Error(`Lighthouse CLI failed for ${url}: ${error.message}`));
        return;
      }

      resolve(stdout);
    });
  });
};

// === Helper: parse lighthouse JSON output ===

const parse_lighthouse_output = (raw_json: string, url: string): {
  scores: AuditResult['scores'];
  metrics: AuditResult['metrics'];
} => {
  let parsed: LighthouseRawOutput;
  try {
    parsed = JSON.parse(raw_json) as LighthouseRawOutput;
  } catch {
    throw new Error(`Failed to parse Lighthouse JSON output for ${url}`);
  }

  // Validate required fields
  const perf_score = parsed.categories?.performance?.score;
  const seo_score = parsed.categories?.seo?.score;
  const a11y_score = parsed.categories?.accessibility?.score;

  if (perf_score == null || seo_score == null || a11y_score == null) {
    throw new Error(`Missing or invalid category scores in Lighthouse output for ${url}`);
  }

  const fcp = parsed.audits?.['first-contentful-paint']?.numericValue;
  const lcp = parsed.audits?.['largest-contentful-paint']?.numericValue;
  const tbt = parsed.audits?.['total-blocking-time']?.numericValue;
  const cls = parsed.audits?.['cumulative-layout-shift']?.numericValue;

  if (fcp == null || lcp == null || tbt == null || cls == null) {
    throw new Error(`Missing or invalid audit metrics in Lighthouse output for ${url}`);
  }

  return {
    scores: {
      performance: Math.round(perf_score * 100),
      seo: Math.round(seo_score * 100),
      accessibility: Math.round(a11y_score * 100),
    },
    metrics: {
      fcp_ms: fcp,
      lcp_ms: lcp,
      tbt_ms: tbt,
      cls,
    },
  };
};

// === Helper: check threshold violations ===

const check_violations = (
  scores: AuditResult['scores'],
  metrics: AuditResult['metrics'],
  thresholds: Required<LighthouseThresholds>,
): string[] => {
  const violations: string[] = [];

  if (scores.performance < thresholds.performance) {
    violations.push(`Performance score ${scores.performance} below threshold ${thresholds.performance}`);
  }
  if (scores.seo < thresholds.seo) {
    violations.push(`SEO score ${scores.seo} below threshold ${thresholds.seo}`);
  }
  if (scores.accessibility < thresholds.accessibility) {
    violations.push(`Accessibility score ${scores.accessibility} below threshold ${thresholds.accessibility}`);
  }
  if (metrics.fcp_ms > thresholds.fcp_ms) {
    violations.push(`FCP ${metrics.fcp_ms}ms exceeds threshold ${thresholds.fcp_ms}ms`);
  }
  if (metrics.lcp_ms > thresholds.lcp_ms) {
    violations.push(`LCP ${metrics.lcp_ms}ms exceeds threshold ${thresholds.lcp_ms}ms`);
  }

  return violations;
};

// === Helper: load history from file ===

const load_history = (history_path: string): AuditHistory => {
  if (!existsSync(history_path)) {
    return {};
  }

  try {
    const raw = readFileSync(history_path, 'utf-8');
    return JSON.parse(raw) as AuditHistory;
  } catch {
    // Corrupted history file — reset gracefully
    console.warn(`[Lighthouse] Corrupted history file at ${history_path}, resetting`);
    return {};
  }
};

// === Helper: save history to file ===

const save_history = (history_path: string, history: AuditHistory): void => {
  // Ensure directory exists
  const dir = dirname(history_path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(history_path, JSON.stringify(history, null, 2), 'utf-8');
};

// === Helper: generate comparison arrow ===

const comparison_arrow = (current: number, previous: number): string => {
  if (current > previous) return '\u2191'; // up arrow
  if (current < previous) return '\u2193'; // down arrow
  return '=';
};

// === Factory function ===

export const create_lighthouse_auditor = (config: LighthouseConfig) => {
  const history_path = config.history_path ?? DEFAULT_HISTORY_PATH;
  const timeout_ms = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const thresholds: Required<LighthouseThresholds> = {
    ...DEFAULT_THRESHOLDS,
    ...config.thresholds,
  };

  // --- Run a single audit for a URL ---
  const audit = async (url: string): Promise<AuditResult> => {
    const raw_json = await run_lighthouse_cli(url, timeout_ms);
    const { scores, metrics } = parse_lighthouse_output(raw_json, url);
    const violations = check_violations(scores, metrics, thresholds);

    const result: AuditResult = {
      url,
      timestamp: new Date().toISOString(),
      scores,
      metrics,
      violations,
    };

    // Save to history
    const history = load_history(history_path);
    if (!history[url]) {
      history[url] = [];
    }
    history[url].push(result);
    save_history(history_path, history);

    return result;
  };

  // --- Run audits for all configured URLs ---
  const audit_all = async (): Promise<AuditResult[]> => {
    const results: AuditResult[] = [];

    // Run sequentially to avoid overwhelming Chrome/system resources
    for (const url of config.urls) {
      try {
        const result = await audit(url);
        results.push(result);
      } catch (err) {
        // Capture error as a failed result instead of aborting entire batch
        const error_msg = err instanceof Error ? err.message : String(err);
        results.push({
          url,
          timestamp: new Date().toISOString(),
          scores: { performance: 0, seo: 0, accessibility: 0 },
          metrics: { fcp_ms: 0, lcp_ms: 0, tbt_ms: 0, cls: 0 },
          violations: [`ERROR: ${error_msg}`],
        });
      }
    }

    return results;
  };

  // --- Check degradation by comparing last two entries in history ---
  const check_degradation = (): string[] => {
    const history = load_history(history_path);
    const degradations: string[] = [];

    for (const [url, entries] of Object.entries(history)) {
      if (entries.length < 2) continue;

      // Compare last two entries (second-to-last = previous, last = current)
      const previous = entries[entries.length - 2];
      const current = entries[entries.length - 1];

      const score_keys = ['performance', 'seo', 'accessibility'] as const;
      for (const key of score_keys) {
        const drop = previous.scores[key] - current.scores[key];
        if (drop >= DEGRADATION_THRESHOLD) {
          const label = key.charAt(0).toUpperCase() + key.slice(1);
          degradations.push(
            `${url}: ${label} degraded from ${previous.scores[key]} to ${current.scores[key]} (-${drop})`
          );
        }
      }
    }

    return degradations;
  };

  // --- Format a human-readable report ---
  const format_report = (result: AuditResult, previous?: AuditResult): string => {
    const status = result.violations.length === 0 ? 'PASS' : 'FAIL';
    const lines: string[] = [];

    lines.push(`=== Lighthouse Audit Report ===`);
    lines.push(`URL: ${result.url}`);
    lines.push(`Time: ${result.timestamp}`);
    lines.push(`Status: ${status}`);
    lines.push('');

    // Scores section
    lines.push('--- Scores ---');
    const score_entries: Array<{ label: string; key: keyof AuditResult['scores'] }> = [
      { label: 'Performance', key: 'performance' },
      { label: 'SEO', key: 'seo' },
      { label: 'Accessibility', key: 'accessibility' },
    ];

    for (const { label, key } of score_entries) {
      let line = `  ${label}: ${result.scores[key]}`;
      if (previous) {
        const arrow = comparison_arrow(result.scores[key], previous.scores[key]);
        line += ` ${arrow} (was ${previous.scores[key]})`;
      }
      lines.push(line);
    }

    lines.push('');

    // Metrics section
    lines.push('--- Metrics ---');
    lines.push(`  FCP: ${result.metrics.fcp_ms}ms`);
    lines.push(`  LCP: ${result.metrics.lcp_ms}ms`);
    lines.push(`  TBT: ${result.metrics.tbt_ms}ms`);
    lines.push(`  CLS: ${result.metrics.cls}`);

    if (previous) {
      // Replace the metric lines with comparison arrows
      const metric_lines_start = lines.length - 4;
      const metric_comparisons = [
        // For timing metrics, lower is better, so arrow is inverted
        { label: 'FCP', current: result.metrics.fcp_ms, prev: previous.metrics.fcp_ms, unit: 'ms' },
        { label: 'LCP', current: result.metrics.lcp_ms, prev: previous.metrics.lcp_ms, unit: 'ms' },
        { label: 'TBT', current: result.metrics.tbt_ms, prev: previous.metrics.tbt_ms, unit: 'ms' },
        { label: 'CLS', current: result.metrics.cls, prev: previous.metrics.cls, unit: '' },
      ];

      for (let i = 0; i < metric_comparisons.length; i++) {
        const m = metric_comparisons[i];
        // For metrics, lower is better, so we invert the arrow
        const arrow = comparison_arrow(m.prev, m.current);
        lines[metric_lines_start + i] = `  ${m.label}: ${m.current}${m.unit} ${arrow} (was ${m.prev}${m.unit})`;
      }
    }

    // Violations section
    if (result.violations.length > 0) {
      lines.push('');
      lines.push('--- Violations ---');
      for (const v of result.violations) {
        lines.push(`  - ${v}`);
      }
    }

    return lines.join('\n');
  };

  return {
    audit,
    audit_all,
    check_degradation,
    format_report,
  };
};

export type LighthouseAuditor = ReturnType<typeof create_lighthouse_auditor>;
