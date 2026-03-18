// TDD tests for SLEEP/AWAKE mode manager
import { describe, it, expect } from 'vitest';
import { create_mode_manager } from './mode_manager.js';

const DEFAULT_CONFIG = {
  sleep_start_hour: 23,
  sleep_end_hour: 7,
  sleep_end_minute: 30,
};

describe('ModeManager', () => {
  describe('get_state()', () => {
    it('should default to awake mode', () => {
      const mm = create_mode_manager(DEFAULT_CONFIG);
      const state = mm.get_state();
      expect(state.current_mode).toBe('awake');
      expect(state.switched_at).toBeDefined();
      expect(state.next_scheduled_switch).toBeDefined();
    });

    it('should respect initial_mode config', () => {
      const mm = create_mode_manager({ ...DEFAULT_CONFIG, initial_mode: 'sleep' });
      expect(mm.get_state().current_mode).toBe('sleep');
    });
  });

  describe('transition()', () => {
    it('should switch from awake to sleep', () => {
      const mm = create_mode_manager(DEFAULT_CONFIG);
      const result = mm.transition({ target_mode: 'sleep', reason: 'bedtime', requested_by: 'cron' });

      expect(result.success).toBe(true);
      expect(result.previous_mode).toBe('awake');
      expect(result.current_mode).toBe('sleep');
      expect(mm.get_state().current_mode).toBe('sleep');
      expect(mm.get_state().switched_by).toBe('cron');
    });

    it('should switch from sleep to awake', () => {
      const mm = create_mode_manager({ ...DEFAULT_CONFIG, initial_mode: 'sleep' });
      const result = mm.transition({ target_mode: 'awake', reason: 'morning', requested_by: 'cron' });

      expect(result.success).toBe(true);
      expect(result.previous_mode).toBe('sleep');
      expect(result.current_mode).toBe('awake');
    });

    it('should handle same-mode transition as no-op', () => {
      const mm = create_mode_manager(DEFAULT_CONFIG);
      const result = mm.transition({ target_mode: 'awake', reason: 'already awake', requested_by: 'api' });

      expect(result.success).toBe(true);
      expect(result.previous_mode).toBe('awake');
      expect(result.current_mode).toBe('awake');
      expect(result.reason).toContain('Already');
    });

    it('should update next_scheduled_switch after transition', () => {
      const mm = create_mode_manager(DEFAULT_CONFIG);
      const before = mm.get_state().next_scheduled_switch;
      mm.transition({ target_mode: 'sleep', reason: 'test', requested_by: 'api' });
      const after = mm.get_state().next_scheduled_switch;

      expect(after).not.toBe(before);
    });
  });

  describe('is_action_allowed()', () => {
    it('should allow all actions in awake mode', () => {
      const mm = create_mode_manager(DEFAULT_CONFIG);

      expect(mm.is_action_allowed('git_push', 'high')).toBe(true);
      expect(mm.is_action_allowed('deploy', 'critical')).toBe(true);
      expect(mm.is_action_allowed('file_read', 'low')).toBe(true);
      expect(mm.is_action_allowed('file_write', 'mid')).toBe(true);
    });

    it('should block high risk actions in sleep mode', () => {
      const mm = create_mode_manager({ ...DEFAULT_CONFIG, initial_mode: 'sleep' });

      expect(mm.is_action_allowed('anything', 'high')).toBe(false);
      expect(mm.is_action_allowed('anything', 'critical')).toBe(false);
    });

    it('should block specific actions in sleep mode even at low/mid risk', () => {
      const mm = create_mode_manager({ ...DEFAULT_CONFIG, initial_mode: 'sleep' });

      expect(mm.is_action_allowed('git_push', 'mid')).toBe(false);
      expect(mm.is_action_allowed('deploy', 'mid')).toBe(false);
      expect(mm.is_action_allowed('pr_creation', 'low')).toBe(false);
      expect(mm.is_action_allowed('external_api_call', 'low')).toBe(false);
    });

    it('should allow safe actions in sleep mode', () => {
      const mm = create_mode_manager({ ...DEFAULT_CONFIG, initial_mode: 'sleep' });

      expect(mm.is_action_allowed('file_read', 'low')).toBe(true);
      expect(mm.is_action_allowed('web_search', 'low')).toBe(true);
      expect(mm.is_action_allowed('crawling', 'low')).toBe(true);
      expect(mm.is_action_allowed('file_write', 'mid')).toBe(true);
      expect(mm.is_action_allowed('git_commit', 'mid')).toBe(true);
    });
  });
});
