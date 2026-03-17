// TDD tests for PII sanitizer
import { describe, it, expect } from 'vitest';
import { sanitize_text, sanitize_task, contains_pii, detect_pii_types } from './sanitizer.js';
import type { Task } from '../shared/types.js';

describe('Sanitizer', () => {
  // === sanitize_text() ===

  describe('sanitize_text()', () => {
    it('should remove phone numbers', () => {
      expect(sanitize_text('연락처: 010-1234-5678')).toBe('연락처: [전화번호 제거됨]');
      expect(sanitize_text('전화 01012345678')).toBe('전화 [전화번호 제거됨]');
    });

    it('should remove email addresses', () => {
      expect(sanitize_text('이메일: user@example.com')).toBe('이메일: [이메일 제거됨]');
    });

    it('should remove Korean resident IDs', () => {
      expect(sanitize_text('주민번호 900101-1234567')).toBe('주민번호 [주민번호 제거됨]');
      expect(sanitize_text('9001011234567')).toBe('[주민번호 제거됨]');
    });

    it('should remove Korean addresses', () => {
      expect(sanitize_text('주소: 서울시 강남구')).toBe('주소: [주소 제거됨]');
      expect(sanitize_text('경기 성남시')).toBe('[주소 제거됨]');
    });

    it('should remove bank account numbers', () => {
      expect(sanitize_text('계좌 110-123-456789')).toBe('계좌 [계좌 제거됨]');
    });

    it('should remove financial amounts with labels', () => {
      expect(sanitize_text('연봉 약 5000만')).toBe('[금융정보 제거됨]');
      expect(sanitize_text('보증금: 3억')).toBe('[금융정보 제거됨]');
    });

    it('should remove labeled Korean names', () => {
      expect(sanitize_text('이름: 홍길동')).toContain('[이름 제거됨]');
      expect(sanitize_text('성명：김철수')).toContain('[이름 제거됨]');
    });

    it('should not modify text without PII', () => {
      const clean_text = 'K-Startup 창업지원사업 검색 결과 3건';
      expect(sanitize_text(clean_text)).toBe(clean_text);
    });

    it('should handle multiple PII types in one text', () => {
      const text = '이름: 홍길동, 연락처: 010-1234-5678, 이메일: hong@test.com';
      const result = sanitize_text(text);

      expect(result).toContain('[이름 제거됨]');
      expect(result).toContain('[전화번호 제거됨]');
      expect(result).toContain('[이메일 제거됨]');
      expect(result).not.toContain('홍길동');
      expect(result).not.toContain('010-1234-5678');
      expect(result).not.toContain('hong@test.com');
    });
  });

  // === sanitize_task() ===

  describe('sanitize_task()', () => {
    const make_task = (overrides: Partial<Task> = {}): Task => ({
      id: 'test_001',
      title: 'Research task',
      description: 'Find startup programs',
      priority: 'medium',
      assigned_to: 'openclaw',
      mode: 'awake',
      risk_level: 'low',
      requires_personal_info: false,
      status: 'pending',
      created_at: '2026-03-17T00:00:00Z',
      deadline: null,
      depends_on: [],
      ...overrides,
    });

    it('should sanitize title and description', () => {
      const task = make_task({
        title: '이름: 홍길동의 청약 조회',
        description: '연락처 010-1234-5678로 결과 전달',
      });

      const sanitized = sanitize_task(task);

      expect(sanitized.title).toContain('[이름 제거됨]');
      expect(sanitized.description).toContain('[전화번호 제거됨]');
    });

    it('should set requires_personal_info to false', () => {
      const task = make_task({ requires_personal_info: true });
      const sanitized = sanitize_task(task);

      expect(sanitized.requires_personal_info).toBe(false);
    });

    it('should not mutate the original task', () => {
      const task = make_task({ title: '이름: 홍길동' });
      sanitize_task(task);

      expect(task.title).toBe('이름: 홍길동');
    });
  });

  // === contains_pii() ===

  describe('contains_pii()', () => {
    it('should return true for text with PII', () => {
      expect(contains_pii('전화 010-1234-5678')).toBe(true);
      expect(contains_pii('user@test.com')).toBe(true);
    });

    it('should return false for clean text', () => {
      expect(contains_pii('K-Startup 검색')).toBe(false);
    });
  });

  // === detect_pii_types() ===

  describe('detect_pii_types()', () => {
    it('should detect all PII types present', () => {
      const text = '연락처: 010-1234-5678, 이메일: test@test.com';
      const types = detect_pii_types(text);

      expect(types).toContain('phone_number');
      expect(types).toContain('email');
      expect(types).not.toContain('resident_id');
    });

    it('should return empty array for clean text', () => {
      expect(detect_pii_types('no PII here')).toEqual([]);
    });
  });
});
