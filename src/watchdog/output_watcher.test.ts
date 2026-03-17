// TDD tests for output watcher
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scan_line, OutputWatcher, type PatternMatch } from './output_watcher.js';

describe('Output Watcher', () => {
  // === scan_line() — pure function tests ===

  describe('scan_line()', () => {
    it('should detect [APPROVAL_NEEDED] pattern', () => {
      const result = scan_line(
        '[APPROVAL_NEEDED] git push to main requires approval',
        'fas-claude',
      );

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('APPROVAL_NEEDED');
      expect(result!.description).toBe('git push to main requires approval');
      expect(result!.session).toBe('fas-claude');
      expect(result!.timestamp).toBeDefined();
    });

    it('should detect [BLOCKED] pattern', () => {
      const result = scan_line('[BLOCKED] API key not configured', 'fas-gemini-a');

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('BLOCKED');
      expect(result!.description).toBe('API key not configured');
    });

    it('should detect [MILESTONE] pattern', () => {
      const result = scan_line('[MILESTONE] Phase 0 infrastructure complete', 'fas-claude');

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('MILESTONE');
      expect(result!.description).toBe('Phase 0 infrastructure complete');
    });

    it('should detect [DONE] pattern', () => {
      const result = scan_line('[DONE] Crawler setup finished', 'fas-claude');

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('DONE');
      expect(result!.description).toBe('Crawler setup finished');
    });

    it('should detect [ERROR] pattern', () => {
      const result = scan_line('[ERROR] Database connection failed', 'fas-gateway');

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('ERROR');
      expect(result!.description).toBe('Database connection failed');
    });

    it('should return null for non-matching lines', () => {
      expect(scan_line('Normal log output', 'fas-claude')).toBeNull();
      expect(scan_line('', 'fas-claude')).toBeNull();
      expect(scan_line('compiling src/main.ts...', 'fas-claude')).toBeNull();
    });

    it('should handle pattern at any position in line', () => {
      const result = scan_line(
        '2026-03-17 10:30:00 [MILESTONE] Phase 1 started',
        'fas-claude',
      );

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('MILESTONE');
    });

    it('should handle empty description after pattern', () => {
      const result = scan_line('[BLOCKED]', 'fas-claude');

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('BLOCKED');
      expect(result!.description).toBe('');
    });
  });

  // === OutputWatcher class ===

  describe('OutputWatcher', () => {
    let matches: PatternMatch[];

    beforeEach(() => {
      matches = [];
    });

    it('should create and start/stop without errors', () => {
      const watcher = new OutputWatcher({
        sessions: ['test-session'],
        poll_interval_ms: 100,
        on_match: (match) => { matches.push(match); },
      });

      watcher.start();
      expect(watcher.is_running()).toBe(true);

      watcher.stop();
      expect(watcher.is_running()).toBe(false);
    });

    it('should not start twice', () => {
      const watcher = new OutputWatcher({
        sessions: ['test-session'],
        poll_interval_ms: 100,
        on_match: vi.fn(),
      });

      watcher.start();
      watcher.start(); // should be no-op

      expect(watcher.is_running()).toBe(true);
      watcher.stop();
    });

    it('should emit started and stopped events', () => {
      const started_handler = vi.fn();
      const stopped_handler = vi.fn();

      const watcher = new OutputWatcher({
        sessions: ['fas-claude'],
        on_match: vi.fn(),
      });

      watcher.on('started', started_handler);
      watcher.on('stopped', stopped_handler);

      watcher.start();
      expect(started_handler).toHaveBeenCalledWith(['fas-claude']);

      watcher.stop();
      expect(stopped_handler).toHaveBeenCalled();
    });
  });
});
