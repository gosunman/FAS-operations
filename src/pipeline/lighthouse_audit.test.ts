// Lighthouse CI Audit Module — Tests
// Tests for performance/SEO/accessibility auditing via lighthouse CLI
// NOTE: child_process.exec is used intentionally for npx lighthouse CLI invocation.
// The URL input comes from config (trusted), not from user input.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_lighthouse_auditor } from './lighthouse_audit.js';
import type {
  LighthouseConfig,
  AuditResult,
} from './lighthouse_audit.js';
import * as fs from 'node:fs';
import * as child_process from 'node:child_process';

// === Mock child_process.exec ===

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

// === Helper: build mock lighthouse JSON output ===

const make_lighthouse_output = (overrides: {
  performance?: number;
  seo?: number;
  accessibility?: number;
  fcp_ms?: number;
  lcp_ms?: number;
  tbt_ms?: number;
  cls?: number;
} = {}) => {
  return JSON.stringify({
    categories: {
      performance: { score: (overrides.performance ?? 85) / 100 },
      seo: { score: (overrides.seo ?? 90) / 100 },
      accessibility: { score: (overrides.accessibility ?? 92) / 100 },
    },
    audits: {
      'first-contentful-paint': { numericValue: overrides.fcp_ms ?? 1200 },
      'largest-contentful-paint': { numericValue: overrides.lcp_ms ?? 2500 },
      'total-blocking-time': { numericValue: overrides.tbt_ms ?? 150 },
      'cumulative-layout-shift': { numericValue: overrides.cls ?? 0.05 },
    },
  });
};

// === Helper: make exec resolve with stdout ===

const mock_exec_success = (stdout: string) => {
  const mock_exec = child_process.exec as unknown as ReturnType<typeof vi.fn>;
  mock_exec.mockImplementation((_cmd: string, _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
    callback(null, stdout, '');
  });
};

// === Helper: make exec reject with error ===

const mock_exec_error = (error_msg: string) => {
  const mock_exec = child_process.exec as unknown as ReturnType<typeof vi.fn>;
  mock_exec.mockImplementation((_cmd: string, _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
    callback(new Error(error_msg), '', '');
  });
};

// === Helper: make exec timeout ===

const mock_exec_timeout = () => {
  const mock_exec = child_process.exec as unknown as ReturnType<typeof vi.fn>;
  mock_exec.mockImplementation((_cmd: string, _opts: unknown, callback: (err: Error & { killed?: boolean; signal?: string } | null, stdout: string, stderr: string) => void) => {
    const err = new Error('Process timed out') as Error & { killed?: boolean; signal?: string };
    err.killed = true;
    err.signal = 'SIGTERM';
    callback(err, '', '');
  });
};

const DEFAULT_CONFIG: LighthouseConfig = {
  urls: ['https://example.com'],
  history_path: '/tmp/test_lighthouse_history.json',
  timeout_ms: 60_000,
};

describe('Lighthouse Audit Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (fs.mkdirSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (fs.writeFileSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
  });

  // === 1. Factory function returns correct API ===

  describe('create_lighthouse_auditor', () => {
    it('Given a config, When factory is called, Then it returns audit, audit_all, check_degradation methods', () => {
      // Given
      const config = DEFAULT_CONFIG;

      // When
      const auditor = create_lighthouse_auditor(config);

      // Then
      expect(auditor).toHaveProperty('audit');
      expect(auditor).toHaveProperty('audit_all');
      expect(auditor).toHaveProperty('check_degradation');
      expect(typeof auditor.audit).toBe('function');
      expect(typeof auditor.audit_all).toBe('function');
      expect(typeof auditor.check_degradation).toBe('function');
    });
  });

  // === 2. Single URL audit ===

  describe('audit(url)', () => {
    it('Given a healthy URL, When audit runs, Then it returns AuditResult with all metrics', async () => {
      // Given
      mock_exec_success(make_lighthouse_output());
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);

      // When
      const result = await auditor.audit('https://example.com');

      // Then
      expect(result.url).toBe('https://example.com');
      expect(result.timestamp).toBeDefined();
      expect(result.scores.performance).toBe(85);
      expect(result.scores.seo).toBe(90);
      expect(result.scores.accessibility).toBe(92);
      expect(result.metrics.fcp_ms).toBe(1200);
      expect(result.metrics.lcp_ms).toBe(2500);
      expect(result.metrics.tbt_ms).toBe(150);
      expect(result.metrics.cls).toBe(0.05);
      expect(result.violations).toEqual([]);
    });

    it('Given lighthouse CLI runs, When exec is called, Then the command includes correct flags', async () => {
      // Given
      mock_exec_success(make_lighthouse_output());
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);

      // When
      await auditor.audit('https://example.com');

      // Then
      const mock_exec = child_process.exec as unknown as ReturnType<typeof vi.fn>;
      const called_cmd = mock_exec.mock.calls[0][0] as string;
      expect(called_cmd).toContain('npx lighthouse');
      expect(called_cmd).toContain('https://example.com');
      expect(called_cmd).toContain('--output=json');
      expect(called_cmd).toContain('--chrome-flags="--headless --no-sandbox"');
    });

    it('Given a URL with low scores, When audit runs, Then violations are returned', async () => {
      // Given
      mock_exec_success(make_lighthouse_output({
        performance: 50,
        seo: 60,
        accessibility: 65,
        fcp_ms: 5000,
        lcp_ms: 6000,
      }));
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);

      // When
      const result = await auditor.audit('https://slow-site.com');

      // Then
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations.some(v => v.includes('Performance'))).toBe(true);
      expect(result.violations.some(v => v.includes('SEO'))).toBe(true);
      expect(result.violations.some(v => v.includes('Accessibility'))).toBe(true);
      expect(result.violations.some(v => v.includes('FCP'))).toBe(true);
      expect(result.violations.some(v => v.includes('LCP'))).toBe(true);
    });

    it('Given custom thresholds, When audit runs, Then custom thresholds are used', async () => {
      // Given
      mock_exec_success(make_lighthouse_output({ performance: 95, seo: 85 }));
      const config: LighthouseConfig = {
        ...DEFAULT_CONFIG,
        thresholds: { performance: 98, seo: 90 },
      };
      const auditor = create_lighthouse_auditor(config);

      // When
      const result = await auditor.audit('https://example.com');

      // Then — 95 < 98 threshold, 85 < 90 threshold
      expect(result.violations.some(v => v.includes('Performance'))).toBe(true);
      expect(result.violations.some(v => v.includes('SEO'))).toBe(true);
    });

    it('Given all scores pass thresholds, When audit runs, Then violations is empty', async () => {
      // Given
      mock_exec_success(make_lighthouse_output({
        performance: 90,
        seo: 95,
        accessibility: 95,
        fcp_ms: 1000,
        lcp_ms: 2000,
      }));
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);

      // When
      const result = await auditor.audit('https://great-site.com');

      // Then
      expect(result.violations).toEqual([]);
    });
  });

  // === 3. Error handling ===

  describe('error handling', () => {
    it('Given lighthouse CLI fails, When audit runs, Then it throws with descriptive error', async () => {
      // Given
      mock_exec_error('Command not found: lighthouse');
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);

      // When / Then
      await expect(auditor.audit('https://example.com')).rejects.toThrow(/lighthouse/i);
    });

    it('Given lighthouse times out, When audit runs, Then it throws timeout error', async () => {
      // Given
      mock_exec_timeout();
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);

      // When / Then
      await expect(auditor.audit('https://example.com')).rejects.toThrow(/timed out/i);
    });

    it('Given lighthouse returns invalid JSON, When audit runs, Then it throws parse error', async () => {
      // Given
      mock_exec_success('This is not JSON output at all');
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);

      // When / Then
      await expect(auditor.audit('https://example.com')).rejects.toThrow(/parse|JSON/i);
    });

    it('Given lighthouse returns incomplete data, When audit runs, Then it throws with missing field info', async () => {
      // Given
      mock_exec_success(JSON.stringify({ categories: {} }));
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);

      // When / Then
      await expect(auditor.audit('https://example.com')).rejects.toThrow(/missing|invalid/i);
    });
  });

  // === 4. audit_all() — batch auditing ===

  describe('audit_all()', () => {
    it('Given multiple URLs, When audit_all runs, Then all URLs are audited', async () => {
      // Given
      mock_exec_success(make_lighthouse_output());
      const config: LighthouseConfig = {
        ...DEFAULT_CONFIG,
        urls: ['https://site-a.com', 'https://site-b.com', 'https://site-c.com'],
      };
      const auditor = create_lighthouse_auditor(config);

      // When
      const results = await auditor.audit_all();

      // Then
      expect(results).toHaveLength(3);
      expect(results[0].url).toBe('https://site-a.com');
      expect(results[1].url).toBe('https://site-b.com');
      expect(results[2].url).toBe('https://site-c.com');
    });

    it('Given one URL fails, When audit_all runs, Then other URLs still complete', async () => {
      // Given
      const mock_exec = child_process.exec as unknown as ReturnType<typeof vi.fn>;
      let call_count = 0;
      mock_exec.mockImplementation((_cmd: string, _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        call_count++;
        if (call_count === 2) {
          callback(new Error('Chrome crashed'), '', '');
        } else {
          callback(null, make_lighthouse_output(), '');
        }
      });
      const config: LighthouseConfig = {
        ...DEFAULT_CONFIG,
        urls: ['https://ok-1.com', 'https://fail.com', 'https://ok-2.com'],
      };
      const auditor = create_lighthouse_auditor(config);

      // When
      const results = await auditor.audit_all();

      // Then — 3 results: 2 success, 1 with error in violations
      expect(results).toHaveLength(3);
      expect(results[0].violations).toEqual([]);
      expect(results[1].violations.some(v => v.includes('ERROR'))).toBe(true);
      expect(results[2].violations).toEqual([]);
    });
  });

  // === 5. History tracking ===

  describe('history tracking', () => {
    it('Given no history file exists, When audit completes, Then history file is created', async () => {
      // Given
      mock_exec_success(make_lighthouse_output());
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);

      // When
      await auditor.audit('https://example.com');

      // Then
      expect(fs.writeFileSync).toHaveBeenCalled();
      const write_call = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(write_call[0]).toContain('lighthouse_history.json');
      const written_data = JSON.parse(write_call[1] as string);
      expect(written_data['https://example.com']).toBeDefined();
      expect(written_data['https://example.com']).toHaveLength(1);
    });

    it('Given existing history, When audit completes, Then new result is appended', async () => {
      // Given
      const existing_history = {
        'https://example.com': [
          {
            url: 'https://example.com',
            timestamp: '2026-03-20T10:00:00.000Z',
            scores: { performance: 80, seo: 85, accessibility: 90 },
            metrics: { fcp_ms: 1500, lcp_ms: 3000, tbt_ms: 200, cls: 0.1 },
            violations: [],
          },
        ],
      };
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(existing_history));
      mock_exec_success(make_lighthouse_output());
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);

      // When
      await auditor.audit('https://example.com');

      // Then
      const write_call = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0];
      const written_data = JSON.parse(write_call[1] as string);
      expect(written_data['https://example.com']).toHaveLength(2);
    });
  });

  // === 6. Degradation detection ===

  describe('check_degradation()', () => {
    it('Given performance dropped by 15 points, When check_degradation runs, Then degradation is detected', () => {
      // Given — previous: 85, current: 70 (dropped 15)
      const existing_history = {
        'https://example.com': [
          {
            url: 'https://example.com',
            timestamp: '2026-03-20T10:00:00.000Z',
            scores: { performance: 85, seo: 90, accessibility: 92 },
            metrics: { fcp_ms: 1200, lcp_ms: 2500, tbt_ms: 150, cls: 0.05 },
            violations: [],
          },
          {
            url: 'https://example.com',
            timestamp: '2026-03-21T10:00:00.000Z',
            scores: { performance: 70, seo: 90, accessibility: 92 },
            metrics: { fcp_ms: 1200, lcp_ms: 2500, tbt_ms: 150, cls: 0.05 },
            violations: [],
          },
        ],
      };
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(existing_history));
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);

      // When
      const degradations = auditor.check_degradation();

      // Then
      expect(degradations).toHaveLength(1);
      expect(degradations[0]).toContain('https://example.com');
      expect(degradations[0]).toContain('Performance');
      expect(degradations[0]).toContain('85');
      expect(degradations[0]).toContain('70');
    });

    it('Given no significant drop, When check_degradation runs, Then no degradation', () => {
      // Given — previous: 85, current: 80 (only 5 drop, below 10 threshold)
      const existing_history = {
        'https://example.com': [
          {
            url: 'https://example.com',
            timestamp: '2026-03-20T10:00:00.000Z',
            scores: { performance: 85, seo: 90, accessibility: 92 },
            metrics: { fcp_ms: 1200, lcp_ms: 2500, tbt_ms: 150, cls: 0.05 },
            violations: [],
          },
          {
            url: 'https://example.com',
            timestamp: '2026-03-21T10:00:00.000Z',
            scores: { performance: 80, seo: 88, accessibility: 90 },
            metrics: { fcp_ms: 1300, lcp_ms: 2600, tbt_ms: 160, cls: 0.06 },
            violations: [],
          },
        ],
      };
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(existing_history));
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);

      // When
      const degradations = auditor.check_degradation();

      // Then
      expect(degradations).toHaveLength(0);
    });

    it('Given no history file exists, When check_degradation runs, Then returns empty array', () => {
      // Given
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);

      // When
      const degradations = auditor.check_degradation();

      // Then
      expect(degradations).toEqual([]);
    });

    it('Given only one entry in history, When check_degradation runs, Then returns empty (nothing to compare)', () => {
      // Given
      const existing_history = {
        'https://example.com': [
          {
            url: 'https://example.com',
            timestamp: '2026-03-21T10:00:00.000Z',
            scores: { performance: 50, seo: 40, accessibility: 30 },
            metrics: { fcp_ms: 5000, lcp_ms: 8000, tbt_ms: 500, cls: 0.3 },
            violations: ['Performance below threshold'],
          },
        ],
      };
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(existing_history));
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);

      // When
      const degradations = auditor.check_degradation();

      // Then
      expect(degradations).toEqual([]);
    });

    it('Given multiple URLs with mixed degradation, When check_degradation runs, Then only degraded ones are reported', () => {
      // Given
      const existing_history = {
        'https://stable.com': [
          { url: 'https://stable.com', timestamp: '2026-03-20T10:00:00.000Z', scores: { performance: 90, seo: 90, accessibility: 90 }, metrics: { fcp_ms: 1000, lcp_ms: 2000, tbt_ms: 100, cls: 0.01 }, violations: [] },
          { url: 'https://stable.com', timestamp: '2026-03-21T10:00:00.000Z', scores: { performance: 88, seo: 89, accessibility: 91 }, metrics: { fcp_ms: 1100, lcp_ms: 2100, tbt_ms: 110, cls: 0.02 }, violations: [] },
        ],
        'https://degraded.com': [
          { url: 'https://degraded.com', timestamp: '2026-03-20T10:00:00.000Z', scores: { performance: 90, seo: 90, accessibility: 90 }, metrics: { fcp_ms: 1000, lcp_ms: 2000, tbt_ms: 100, cls: 0.01 }, violations: [] },
          { url: 'https://degraded.com', timestamp: '2026-03-21T10:00:00.000Z', scores: { performance: 60, seo: 70, accessibility: 75 }, metrics: { fcp_ms: 4000, lcp_ms: 6000, tbt_ms: 500, cls: 0.3 }, violations: [] },
        ],
      };
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(existing_history));
      const config: LighthouseConfig = {
        ...DEFAULT_CONFIG,
        urls: ['https://stable.com', 'https://degraded.com'],
      };
      const auditor = create_lighthouse_auditor(config);

      // When
      const degradations = auditor.check_degradation();

      // Then
      expect(degradations.length).toBeGreaterThan(0);
      expect(degradations.every(d => d.includes('https://degraded.com'))).toBe(true);
      expect(degradations.some(d => d.includes('https://stable.com'))).toBe(false);
    });
  });

  // === 7. Report formatting ===

  describe('format_report()', () => {
    it('Given a passing audit result, When formatted, Then shows pass indicators', () => {
      // Given
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);
      const result: AuditResult = {
        url: 'https://example.com',
        timestamp: '2026-03-21T10:00:00.000Z',
        scores: { performance: 90, seo: 95, accessibility: 92 },
        metrics: { fcp_ms: 1200, lcp_ms: 2500, tbt_ms: 150, cls: 0.05 },
        violations: [],
      };

      // When
      const report = auditor.format_report(result);

      // Then
      expect(report).toContain('https://example.com');
      expect(report).toContain('90');
      expect(report).toContain('95');
      expect(report).toContain('92');
      expect(report).toContain('PASS');
    });

    it('Given a failing audit result, When formatted, Then shows fail indicators and violations', () => {
      // Given
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);
      const result: AuditResult = {
        url: 'https://slow.com',
        timestamp: '2026-03-21T10:00:00.000Z',
        scores: { performance: 45, seo: 60, accessibility: 55 },
        metrics: { fcp_ms: 5000, lcp_ms: 7000, tbt_ms: 800, cls: 0.3 },
        violations: [
          'Performance score 45 below threshold 70',
          'SEO score 60 below threshold 80',
        ],
      };

      // When
      const report = auditor.format_report(result);

      // Then
      expect(report).toContain('FAIL');
      expect(report).toContain('45');
      expect(report).toContain('Performance');
    });

    it('Given a previous result, When formatted with comparison, Then shows arrows', () => {
      // Given
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);
      const current: AuditResult = {
        url: 'https://example.com',
        timestamp: '2026-03-21T10:00:00.000Z',
        scores: { performance: 90, seo: 85, accessibility: 92 },
        metrics: { fcp_ms: 1200, lcp_ms: 2500, tbt_ms: 150, cls: 0.05 },
        violations: [],
      };
      const previous: AuditResult = {
        url: 'https://example.com',
        timestamp: '2026-03-20T10:00:00.000Z',
        scores: { performance: 80, seo: 90, accessibility: 92 },
        metrics: { fcp_ms: 1500, lcp_ms: 3000, tbt_ms: 200, cls: 0.1 },
        violations: [],
      };

      // When
      const report = auditor.format_report(current, previous);

      // Then — performance improved (80 -> 90), seo declined (90 -> 85)
      expect(report).toContain('\u2191'); // up arrow for performance improvement
      expect(report).toContain('\u2193'); // down arrow for seo decline
    });
  });

  // === 8. Default config values ===

  describe('default config values', () => {
    it('Given no thresholds, When factory is called, Then defaults are used', async () => {
      // Given
      mock_exec_success(make_lighthouse_output({ performance: 65 }));
      const config: LighthouseConfig = { urls: ['https://test.com'], history_path: '/tmp/test_lh.json' };
      const auditor = create_lighthouse_auditor(config);

      // When
      const result = await auditor.audit('https://test.com');

      // Then — 65 < 70 default threshold
      expect(result.violations.some(v => v.includes('Performance'))).toBe(true);
    });

    it('Given no timeout, When factory is called, Then 120s default is used', async () => {
      // Given
      mock_exec_success(make_lighthouse_output());
      const config: LighthouseConfig = { urls: ['https://test.com'], history_path: '/tmp/test_lh.json' };
      const auditor = create_lighthouse_auditor(config);

      // When
      await auditor.audit('https://test.com');

      // Then
      const mock_exec = child_process.exec as unknown as ReturnType<typeof vi.fn>;
      const exec_opts = mock_exec.mock.calls[0][1] as { timeout: number };
      expect(exec_opts.timeout).toBe(120_000);
    });
  });

  // === 9. Edge cases ===

  describe('edge cases', () => {
    it('Given empty URL list, When audit_all runs, Then returns empty array', async () => {
      // Given
      const config: LighthouseConfig = { urls: [], history_path: '/tmp/test_lh.json' };
      const auditor = create_lighthouse_auditor(config);

      // When
      const results = await auditor.audit_all();

      // Then
      expect(results).toEqual([]);
    });

    it('Given score is exactly at threshold, When audit runs, Then no violation (>= passes)', async () => {
      // Given — performance exactly 70 (default threshold)
      mock_exec_success(make_lighthouse_output({ performance: 70, seo: 80, accessibility: 80 }));
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);

      // When
      const result = await auditor.audit('https://example.com');

      // Then
      expect(result.violations).toEqual([]);
    });

    it('Given corrupted history file, When audit runs, Then history is reset gracefully', async () => {
      // Given
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('not-valid-json{{{');
      mock_exec_success(make_lighthouse_output());
      const auditor = create_lighthouse_auditor(DEFAULT_CONFIG);

      // When — should not throw, gracefully handle corrupt history
      const result = await auditor.audit('https://example.com');

      // Then
      expect(result.url).toBe('https://example.com');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });
});
