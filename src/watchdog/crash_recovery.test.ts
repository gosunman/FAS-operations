// TDD tests for crash recovery monitor
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { create_crash_monitor, type CrashRecoveryConfig } from './crash_recovery.js';

describe('Crash Recovery', () => {
  let tmp_dir: string;
  let state_path: string;

  beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fas-crash-'));
    state_path = path.join(tmp_dir, 'crash_history.json');
  });

  afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true });
  });

  // === create_crash_monitor ===

  describe('create_crash_monitor()', () => {
    it('should create monitor with default config', () => {
      const monitor = create_crash_monitor({ state_path });
      expect(monitor).toHaveProperty('record_crash');
      expect(monitor).toHaveProperty('should_restart');
      expect(monitor).toHaveProperty('get_crash_history');
      expect(monitor).toHaveProperty('reset');
    });

    it('should create state file on first crash', () => {
      const monitor = create_crash_monitor({ state_path });
      monitor.record_crash('captain', 'Segfault');
      expect(fs.existsSync(state_path)).toBe(true);
    });

    it('should load existing state file on creation', () => {
      // Pre-populate state
      const existing_state = {
        captain: [
          { agent: 'captain', crashed_at: '2026-03-21T10:00:00.000Z', error_message: 'OOM', restart_attempt: 1 },
        ],
      };
      fs.mkdirSync(path.dirname(state_path), { recursive: true });
      fs.writeFileSync(state_path, JSON.stringify(existing_state));

      const monitor = create_crash_monitor({ state_path });
      const history = monitor.get_crash_history('captain');
      expect(history).toHaveLength(1);
      expect(history[0].error_message).toBe('OOM');
    });
  });

  // === record_crash ===

  describe('record_crash()', () => {
    it('should record a crash and increment attempt number', () => {
      const monitor = create_crash_monitor({ state_path });
      const record = monitor.record_crash('hunter', 'Connection refused');

      expect(record.agent).toBe('hunter');
      expect(record.error_message).toBe('Connection refused');
      expect(record.restart_attempt).toBe(1);
    });

    it('should increment restart_attempt on subsequent crashes', () => {
      const monitor = create_crash_monitor({ state_path });
      monitor.record_crash('hunter', 'Error 1');
      monitor.record_crash('hunter', 'Error 2');
      const third = monitor.record_crash('hunter', 'Error 3');

      expect(third.restart_attempt).toBe(3);
    });

    it('should track crashes per agent independently', () => {
      const monitor = create_crash_monitor({ state_path });
      monitor.record_crash('captain', 'CPU overload');
      monitor.record_crash('hunter', 'Timeout');
      monitor.record_crash('captain', 'CPU overload again');

      expect(monitor.get_crash_history('captain')).toHaveLength(2);
      expect(monitor.get_crash_history('hunter')).toHaveLength(1);
    });

    it('should persist crash records to disk', () => {
      const monitor = create_crash_monitor({ state_path });
      monitor.record_crash('captain', 'Disk full');

      // Read state file directly
      const raw = JSON.parse(fs.readFileSync(state_path, 'utf-8'));
      expect(raw.captain).toHaveLength(1);
      expect(raw.captain[0].error_message).toBe('Disk full');
    });
  });

  // === should_restart ===

  describe('should_restart()', () => {
    it('should return true when crash count is below max_restarts', () => {
      const monitor = create_crash_monitor({ state_path, max_restarts: 3 });
      monitor.record_crash('captain', 'Error');

      expect(monitor.should_restart('captain')).toBe(true);
    });

    it('should return true when crash count equals max_restarts minus one', () => {
      const monitor = create_crash_monitor({ state_path, max_restarts: 3 });
      monitor.record_crash('captain', 'Error 1');
      monitor.record_crash('captain', 'Error 2');

      expect(monitor.should_restart('captain')).toBe(true);
    });

    it('should return false when crash count reaches max_restarts', () => {
      const monitor = create_crash_monitor({ state_path, max_restarts: 3 });
      monitor.record_crash('captain', 'Error 1');
      monitor.record_crash('captain', 'Error 2');
      monitor.record_crash('captain', 'Error 3');

      expect(monitor.should_restart('captain')).toBe(false);
    });

    it('should return true for agent with no crash history', () => {
      const monitor = create_crash_monitor({ state_path, max_restarts: 3 });
      expect(monitor.should_restart('captain')).toBe(true);
    });

    it('should respect cooldown period', () => {
      // Use a very long cooldown so the crash is still "hot"
      const monitor = create_crash_monitor({
        state_path,
        max_restarts: 3,
        cooldown_ms: 60_000,
      });
      monitor.record_crash('captain', 'Error 1');
      monitor.record_crash('captain', 'Error 2');
      monitor.record_crash('captain', 'Error 3');

      // Within cooldown, should not restart
      expect(monitor.should_restart('captain')).toBe(false);
    });

    it('should allow restart after cooldown expires and reset', () => {
      const monitor = create_crash_monitor({
        state_path,
        max_restarts: 3,
        cooldown_ms: 1, // 1ms cooldown for testing
      });
      monitor.record_crash('captain', 'Error 1');
      monitor.record_crash('captain', 'Error 2');
      monitor.record_crash('captain', 'Error 3');

      // Reset the agent
      monitor.reset('captain');
      expect(monitor.should_restart('captain')).toBe(true);
    });
  });

  // === get_crash_history ===

  describe('get_crash_history()', () => {
    it('should return empty array for agent with no crashes', () => {
      const monitor = create_crash_monitor({ state_path });
      expect(monitor.get_crash_history('hunter')).toEqual([]);
    });

    it('should return all crash records for an agent', () => {
      const monitor = create_crash_monitor({ state_path });
      monitor.record_crash('captain', 'Error A');
      monitor.record_crash('captain', 'Error B');

      const history = monitor.get_crash_history('captain');
      expect(history).toHaveLength(2);
      expect(history[0].error_message).toBe('Error A');
      expect(history[1].error_message).toBe('Error B');
    });

    it('should include timestamps in crash records', () => {
      const monitor = create_crash_monitor({ state_path });
      monitor.record_crash('captain', 'Error');

      const history = monitor.get_crash_history('captain');
      expect(history[0].crashed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // === reset ===

  describe('reset()', () => {
    it('should clear crash history for specific agent', () => {
      const monitor = create_crash_monitor({ state_path });
      monitor.record_crash('captain', 'Error');
      monitor.record_crash('hunter', 'Error');

      monitor.reset('captain');

      expect(monitor.get_crash_history('captain')).toEqual([]);
      expect(monitor.get_crash_history('hunter')).toHaveLength(1);
    });

    it('should persist reset to state file', () => {
      const monitor = create_crash_monitor({ state_path });
      monitor.record_crash('captain', 'Error');
      monitor.reset('captain');

      const raw = JSON.parse(fs.readFileSync(state_path, 'utf-8'));
      expect(raw.captain).toEqual([]);
    });

    it('should allow fresh crashes after reset', () => {
      const monitor = create_crash_monitor({ state_path, max_restarts: 3 });
      monitor.record_crash('captain', 'Error 1');
      monitor.record_crash('captain', 'Error 2');
      monitor.record_crash('captain', 'Error 3');
      expect(monitor.should_restart('captain')).toBe(false);

      monitor.reset('captain');
      expect(monitor.should_restart('captain')).toBe(true);

      const record = monitor.record_crash('captain', 'New error');
      expect(record.restart_attempt).toBe(1);
    });
  });
});
