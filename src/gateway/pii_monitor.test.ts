// TDD tests for PII monitor
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { create_pii_monitor } from './pii_monitor.js';

describe('PII Monitor', () => {
  let tmp_dir: string;

  beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fas-pii-monitor-'));
  });

  afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true });
  });

  // === create_pii_monitor ===

  describe('create_pii_monitor()', () => {
    it('should create monitor with default patterns', () => {
      const monitor = create_pii_monitor();
      expect(monitor).toHaveProperty('check_for_pii');
      expect(monitor).toHaveProperty('log_pii_access');
    });
  });

  // === check_for_pii ===

  describe('check_for_pii()', () => {
    it('should detect phone numbers', () => {
      const monitor = create_pii_monitor();
      const result = monitor.check_for_pii('연락처: 010-1234-5678');
      expect(result.has_pii).toBe(true);
      expect(result.detected_types).toContain('phone_number');
    });

    it('should detect email addresses', () => {
      const monitor = create_pii_monitor();
      const result = monitor.check_for_pii('이메일: user@example.com');
      expect(result.has_pii).toBe(true);
      expect(result.detected_types).toContain('email');
    });

    it('should detect Korean resident IDs', () => {
      const monitor = create_pii_monitor();
      const result = monitor.check_for_pii('주민번호 900101-1234567');
      expect(result.has_pii).toBe(true);
      expect(result.detected_types).toContain('resident_id');
    });

    it('should detect Korean addresses', () => {
      const monitor = create_pii_monitor();
      const result = monitor.check_for_pii('서울시 강남구 역삼동');
      expect(result.has_pii).toBe(true);
      expect(result.detected_types).toContain('address');
    });

    it('should detect credit card numbers', () => {
      const monitor = create_pii_monitor();
      const result = monitor.check_for_pii('카드번호 1234-5678-9012-3456');
      expect(result.has_pii).toBe(true);
      expect(result.detected_types).toContain('credit_card');
    });

    it('should return clean for text without PII', () => {
      const monitor = create_pii_monitor();
      const result = monitor.check_for_pii('오늘 크롤링 대상: k-startup.go.kr');
      expect(result.has_pii).toBe(false);
      expect(result.detected_types).toEqual([]);
    });

    it('should detect multiple PII types in one text', () => {
      const monitor = create_pii_monitor();
      const result = monitor.check_for_pii('이름: 홍길동, 연락처: 010-1234-5678, 이메일: test@test.com');
      expect(result.has_pii).toBe(true);
      expect(result.detected_types.length).toBeGreaterThanOrEqual(2);
    });

    it('should distinguish critical vs warning severity', () => {
      const monitor = create_pii_monitor();
      // Phone number is critical
      const phone_result = monitor.check_for_pii('010-1234-5678');
      expect(phone_result.has_critical).toBe(true);

      // Email is warning
      const email_result = monitor.check_for_pii('user@example.com');
      expect(email_result.has_critical).toBe(false);
      expect(email_result.has_pii).toBe(true);
    });
  });

  // === log_pii_access ===

  describe('log_pii_access()', () => {
    it('should log PII access to file when logger is provided', () => {
      // We pass a simple log collector instead of full file_logger
      const logged: Array<{ agent: string; context: string; types: string[] }> = [];
      const monitor = create_pii_monitor({
        on_pii_detected: (agent, context, types) => {
          logged.push({ agent, context, types });
        },
      });

      monitor.log_pii_access('hunter', 'task description with 010-1234-5678', ['phone_number']);

      expect(logged).toHaveLength(1);
      expect(logged[0].agent).toBe('hunter');
      expect(logged[0].types).toContain('phone_number');
    });

    it('should work without callback (no-op)', () => {
      const monitor = create_pii_monitor();
      // Should not throw
      expect(() => {
        monitor.log_pii_access('hunter', 'some context', ['email']);
      }).not.toThrow();
    });
  });

  // === Hunter isolation check ===

  describe('hunter isolation', () => {
    it('should flag PII in hunter-bound task descriptions', () => {
      const monitor = create_pii_monitor();
      const task_desc = '크롤링 대상: k-startup.go.kr, 담당자 연락처 010-9999-8888';
      const result = monitor.check_for_pii(task_desc);

      expect(result.has_pii).toBe(true);
      expect(result.has_critical).toBe(true);
    });

    it('should pass clean task descriptions', () => {
      const monitor = create_pii_monitor();
      const task_desc = 'NotebookLM에서 FAS 아키텍처 문서 검증 실행';
      const result = monitor.check_for_pii(task_desc);

      expect(result.has_pii).toBe(false);
    });
  });
});
