import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { load_agents_config, get_sessions_for_device, get_all_sessions } from './agents_config.js';

const CONFIG_PATH = resolve(process.cwd(), 'config/agents.yml');

describe('agents_config', () => {
  describe('load_agents_config', () => {
    it('should load all agents from agents.yml', () => {
      const agents = load_agents_config(CONFIG_PATH);
      expect(agents).toBeDefined();
      expect(agents.claude).toBeDefined();
      expect(agents.gemini_a).toBeDefined();
      expect(agents.openclaw).toBeDefined();
    });

    it('should have tmux_session for each agent', () => {
      const agents = load_agents_config(CONFIG_PATH);
      for (const [name, agent] of Object.entries(agents)) {
        expect(agent.tmux_session, `${name} missing tmux_session`).toBeTruthy();
      }
    });
  });

  describe('get_sessions_for_device', () => {
    it('should return captain-device sessions', () => {
      const sessions = get_sessions_for_device('captain', CONFIG_PATH);
      expect(sessions.length).toBeGreaterThan(0);
      // cc-fas (claude) and fas-gemini-a should be captain sessions
      expect(sessions).toContain('cc-fas');
      expect(sessions).toContain('fas-gemini-a');
    });

    it('should return hunter-device sessions', () => {
      const sessions = get_sessions_for_device('hunter', CONFIG_PATH);
      expect(sessions).toContain('fas-openclaw');
    });

    it('should return empty array for unknown device', () => {
      const sessions = get_sessions_for_device('nonexistent', CONFIG_PATH);
      expect(sessions).toEqual([]);
    });
  });

  describe('get_all_sessions', () => {
    it('should return sessions from all devices', () => {
      const all = get_all_sessions(CONFIG_PATH);
      expect(all).toContain('cc-fas');
      expect(all).toContain('fas-gemini-a');
      expect(all).toContain('fas-openclaw');
    });
  });
});
