// TDD tests for API whitelist
import { describe, it, expect } from 'vitest';
import { create_api_whitelist, DEFAULT_WHITELIST, type WhitelistEntry } from './api_whitelist.js';

describe('API Whitelist', () => {
  // === create_api_whitelist ===

  describe('create_api_whitelist()', () => {
    it('should create whitelist with default entries', () => {
      const wl = create_api_whitelist();
      expect(wl.get_whitelist().length).toBeGreaterThan(0);
    });

    it('should create whitelist with custom entries', () => {
      const custom: WhitelistEntry[] = [
        { domain: 'example.com', allowed_paths: ['/api/.*'], requires_approval: false, risk_level: 'low' },
      ];
      const wl = create_api_whitelist({ entries: custom });
      expect(wl.get_whitelist()).toHaveLength(1);
      expect(wl.get_whitelist()[0].domain).toBe('example.com');
    });
  });

  // === is_allowed ===

  describe('is_allowed()', () => {
    it('should allow whitelisted Telegram API', () => {
      const wl = create_api_whitelist();
      const result = wl.is_allowed('https://api.telegram.org/bot123/sendMessage');
      expect(result.allowed).toBe(true);
    });

    it('should allow whitelisted Slack webhook', () => {
      const wl = create_api_whitelist();
      const result = wl.is_allowed('https://hooks.slack.com/services/T01/B02/xxx');
      expect(result.allowed).toBe(true);
    });

    it('should allow whitelisted Notion API', () => {
      const wl = create_api_whitelist();
      const result = wl.is_allowed('https://api.notion.com/v1/pages');
      expect(result.allowed).toBe(true);
    });

    it('should reject unknown domains', () => {
      const wl = create_api_whitelist();
      const result = wl.is_allowed('https://evil.example.com/steal-data');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not in whitelist');
    });

    it('should reject whitelisted domain with wrong path', () => {
      const custom: WhitelistEntry[] = [
        { domain: 'api.example.com', allowed_paths: ['/v1/safe'], requires_approval: false, risk_level: 'low' },
      ];
      const wl = create_api_whitelist({ entries: custom });
      const result = wl.is_allowed('https://api.example.com/v2/dangerous');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not allowed');
    });

    it('should handle URLs with query parameters', () => {
      const wl = create_api_whitelist();
      const result = wl.is_allowed('https://api.telegram.org/bot123/sendMessage?chat_id=456');
      expect(result.allowed).toBe(true);
    });

    it('should handle URLs with ports', () => {
      const custom: WhitelistEntry[] = [
        { domain: 'localhost:3000', allowed_paths: ['/.*'], requires_approval: false, risk_level: 'low' },
      ];
      const wl = create_api_whitelist({ entries: custom });
      const result = wl.is_allowed('http://localhost:3000/api/test');
      expect(result.allowed).toBe(true);
    });

    it('should reject malformed URLs', () => {
      const wl = create_api_whitelist();
      const result = wl.is_allowed('not-a-url');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('invalid URL');
    });
  });

  // === check_request ===

  describe('check_request()', () => {
    it('should indicate when approval is required', () => {
      const wl = create_api_whitelist();
      // api.clay.com requires approval
      const result = wl.check_request('https://api.clay.com/some/path', 'GET');
      expect(result.allowed).toBe(true);
      expect(result.requires_approval).toBe(true);
      expect(result.risk_level).toBe('mid');
    });

    it('should indicate when approval is NOT required', () => {
      const wl = create_api_whitelist();
      const result = wl.check_request('https://api.telegram.org/bot123/sendMessage', 'POST');
      expect(result.allowed).toBe(true);
      expect(result.requires_approval).toBe(false);
      expect(result.risk_level).toBe('low');
    });

    it('should reject non-whitelisted URLs', () => {
      const wl = create_api_whitelist();
      const result = wl.check_request('https://malicious.com/api', 'POST');
      expect(result.allowed).toBe(false);
    });

    it('should include risk level in response', () => {
      const wl = create_api_whitelist();
      const result = wl.check_request('https://api.notion.com/v1/databases', 'PATCH');
      expect(result.risk_level).toBe('low');
    });
  });

  // === add_entry ===

  describe('add_entry()', () => {
    it('should add new entry to whitelist', () => {
      const wl = create_api_whitelist({ entries: [] });
      wl.add_entry({
        domain: 'new-api.example.com',
        allowed_paths: ['/v1/.*'],
        requires_approval: true,
        risk_level: 'high',
      });

      expect(wl.get_whitelist()).toHaveLength(1);
      const result = wl.is_allowed('https://new-api.example.com/v1/action');
      expect(result.allowed).toBe(true);
    });

    it('should not duplicate existing domain entries', () => {
      const wl = create_api_whitelist({ entries: [] });
      const entry: WhitelistEntry = {
        domain: 'api.test.com',
        allowed_paths: ['/.*'],
        requires_approval: false,
        risk_level: 'low',
      };
      wl.add_entry(entry);
      wl.add_entry(entry); // duplicate

      // Should update, not duplicate
      expect(wl.get_whitelist().filter(e => e.domain === 'api.test.com')).toHaveLength(1);
    });
  });

  // === get_whitelist ===

  describe('get_whitelist()', () => {
    it('should return copy of entries (not reference)', () => {
      const wl = create_api_whitelist();
      const list1 = wl.get_whitelist();
      const list2 = wl.get_whitelist();
      expect(list1).not.toBe(list2);
      expect(list1).toEqual(list2);
    });
  });

  // === DEFAULT_WHITELIST ===

  describe('DEFAULT_WHITELIST', () => {
    it('should include Telegram, Slack, Notion, k-startup, applyhome, clay', () => {
      const domains = DEFAULT_WHITELIST.map(e => e.domain);
      expect(domains).toContain('api.telegram.org');
      expect(domains).toContain('hooks.slack.com');
      expect(domains).toContain('api.notion.com');
      expect(domains).toContain('k-startup.go.kr');
      expect(domains).toContain('applyhome.co.kr');
      expect(domains).toContain('api.clay.com');
    });

    it('should require approval only for clay API', () => {
      const clay = DEFAULT_WHITELIST.find(e => e.domain === 'api.clay.com');
      expect(clay?.requires_approval).toBe(true);

      const others = DEFAULT_WHITELIST.filter(e => e.domain !== 'api.clay.com');
      for (const entry of others) {
        expect(entry.requires_approval).toBe(false);
      }
    });
  });
});
