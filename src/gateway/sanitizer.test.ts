// TDD tests for PII sanitizer
import { describe, it, expect } from 'vitest';
import { sanitize_text, sanitize_task, contains_pii, contains_critical_pii, detect_pii_types, detect_pii_with_severity, type HunterSafeTask, type PiiDetection } from './sanitizer.js';
import type { Task } from '../shared/types.js';

describe('Sanitizer', () => {
  // === sanitize_text() ===

  describe('sanitize_text()', () => {
    it('should remove phone numbers', () => {
      expect(sanitize_text('연락처: 010-1234-5678')).toBe('연락처: [전화번호 제거됨]');
      expect(sanitize_text('전화 01012345678')).toBe('전화 [전화번호 제거됨]');
    });

    it('should remove phone numbers with spaces around hyphens', () => {
      expect(sanitize_text('전화 010 - 1234 - 5678')).toBe('전화 [전화번호 제거됨]');
      expect(sanitize_text('연락처 010 -1234- 5678')).toBe('연락처 [전화번호 제거됨]');
    });

    it('should remove email addresses', () => {
      expect(sanitize_text('이메일: user@example.com')).toBe('이메일: [이메일 제거됨]');
    });

    it('should remove Korean resident IDs', () => {
      expect(sanitize_text('주민번호 900101-1234567')).toBe('주민번호 [주민번호 제거됨]');
      expect(sanitize_text('9001011234567')).toBe('[주민번호 제거됨]');
    });

    it('should remove Korean addresses with sub-district', () => {
      // Full address with 동/로/길 — should be sanitized
      expect(sanitize_text('주소: 서울시 강남구 역삼동')).toBe('주소: [주소 제거됨]');
      expect(sanitize_text('경기 성남시 분당로')).toBe('[주소 제거됨]');
      expect(sanitize_text('부산시 해운대구 우동')).toBe('[주소 제거됨]');
    });

    it('should NOT remove general area mentions without sub-district', () => {
      // General area mention (시/도 + 시/군/구 only) — should NOT match
      expect(sanitize_text('서울시 강남구')).toBe('서울시 강남구');
      expect(sanitize_text('경기 성남시')).toBe('경기 성남시');
    });

    it('should remove bank account numbers', () => {
      expect(sanitize_text('계좌 110-123-456789')).toBe('계좌 [계좌 제거됨]');
    });

    it('should remove bank account numbers with spaces around hyphens', () => {
      expect(sanitize_text('계좌 110 - 123 - 456789')).toBe('계좌 [계좌 제거됨]');
    });

    it('should NOT match date patterns as bank account numbers', () => {
      // Date format YYYY-MM-DD (4-2-2) should NOT be matched
      expect(sanitize_text('날짜: 2026-03-19')).toBe('날짜: 2026-03-19');
      expect(sanitize_text('2025-12-31')).toBe('2025-12-31');
      expect(sanitize_text('기한: 2026-01-01까지')).toBe('기한: 2026-01-01까지');
    });

    it('should remove financial amounts with labels', () => {
      expect(sanitize_text('연봉 약 5000만')).toBe('[금융정보 제거됨]');
      expect(sanitize_text('보증금: 3억')).toBe('[금융정보 제거됨]');
    });

    it('should remove labeled Korean names', () => {
      expect(sanitize_text('이름: 홍길동')).toContain('[이름 제거됨]');
      expect(sanitize_text('성명：김철수')).toContain('[이름 제거됨]');
    });

    it('should remove credit card numbers', () => {
      expect(sanitize_text('카드 1234-5678-9012-3456')).toBe('카드 [카드번호 제거됨]');
      expect(sanitize_text('카드 1234 5678 9012 3456')).toBe('카드 [카드번호 제거됨]');
    });

    it('should remove credit card numbers with spaces around separators', () => {
      expect(sanitize_text('카드 1234 - 5678 - 9012 - 3456')).toBe('카드 [카드번호 제거됨]');
    });

    it('should remove internal IP addresses', () => {
      expect(sanitize_text('서버 100.64.0.1에 접속')).toBe('서버 [IP 제거됨]에 접속');
      expect(sanitize_text('http://192.168.1.100:3100')).toBe('http://[IP 제거됨]:3100');
      expect(sanitize_text('10.0.0.5 연결')).toBe('[IP 제거됨] 연결');
    });

    it('should not remove public IP addresses', () => {
      // 8.8.8.8 is a public IP — should not match private/Tailscale ranges
      expect(sanitize_text('DNS: 8.8.8.8')).toBe('DNS: 8.8.8.8');
    });

    it('should remove internal URLs (*.local, *.internal, *.ts.net)', () => {
      expect(sanitize_text('접속: http://captain.local:3100/api/tasks'))
        .toBe('접속: [내부URL 제거됨]');
      expect(sanitize_text('URL: https://fas.internal/dashboard'))
        .toBe('URL: [내부URL 제거됨]');
      expect(sanitize_text('http://hunter.tailnet:8080'))
        .toBe('[내부URL 제거됨]');
      expect(sanitize_text('http://my-device.ts.net/path'))
        .toBe('[내부URL 제거됨]');
    });

    it('should remove localhost URLs', () => {
      expect(sanitize_text('서버 http://localhost:3100에서 실행'))
        .toBe('서버 [내부URL 제거됨]에서 실행');
    });

    it('should not remove public URLs', () => {
      expect(sanitize_text('https://github.com/repo')).toBe('https://github.com/repo');
      expect(sanitize_text('https://k-startup.go.kr')).toBe('https://k-startup.go.kr');
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

    it('should only include whitelisted fields', () => {
      const task = make_task({
        title: 'Test',
        requires_personal_info: true,
        assigned_to: 'openclaw',
      });
      const sanitized = sanitize_task(task) as Record<string, unknown>;

      // Whitelisted fields should exist
      expect(sanitized.id).toBeDefined();
      expect(sanitized.title).toBeDefined();
      expect(sanitized.priority).toBeDefined();

      // Non-whitelisted fields should NOT exist
      expect(sanitized).not.toHaveProperty('requires_personal_info');
      expect(sanitized).not.toHaveProperty('assigned_to');
      expect(sanitized).not.toHaveProperty('depends_on');
      expect(sanitized).not.toHaveProperty('output');
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

    it('should return consistent results on repeated calls (lastIndex reset)', () => {
      // Global regex .test() advances lastIndex — calling twice could return false without reset
      const text = '전화 010-1234-5678';
      expect(contains_pii(text)).toBe(true);
      expect(contains_pii(text)).toBe(true);
      expect(contains_pii(text)).toBe(true);
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

  // === contains_critical_pii() ===

  describe('contains_critical_pii()', () => {
    it('should return true for critical PII (phone, resident_id, labeled name)', () => {
      expect(contains_critical_pii('전화 010-1234-5678')).toBe(true);
      expect(contains_critical_pii('주민번호 900101-1234567')).toBe(true);
      expect(contains_critical_pii('이름: 홍길동')).toBe(true);
    });

    it('should return false for warning-only PII (email, address, bank_account)', () => {
      expect(contains_critical_pii('이메일: user@example.com')).toBe(false);
      expect(contains_critical_pii('서울시 강남구 역삼동')).toBe(false);
      expect(contains_critical_pii('계좌 110-123-456789')).toBe(false);
      expect(contains_critical_pii('연봉 약 5000만')).toBe(false);
    });

    it('should return false for clean text', () => {
      expect(contains_critical_pii('K-Startup 검색')).toBe(false);
    });

    it('should return true when text has both critical and warning PII', () => {
      expect(contains_critical_pii('이름: 홍길동, 이메일: hong@test.com')).toBe(true);
    });
  });

  // === detect_pii_with_severity() ===

  describe('detect_pii_with_severity()', () => {
    it('should return detections with severity levels', () => {
      const text = '이름: 홍길동, 이메일: test@test.com';
      const detections = detect_pii_with_severity(text);

      const name_detection = detections.find((d) => d.name === 'labeled_korean_name');
      const email_detection = detections.find((d) => d.name === 'email');

      expect(name_detection?.severity).toBe('critical');
      expect(email_detection?.severity).toBe('warning');
    });

    it('should return empty array for clean text', () => {
      expect(detect_pii_with_severity('no PII here')).toEqual([]);
    });

    it('should classify all PII types with correct severity', () => {
      // Critical types
      const critical_text = '이름: 홍길동 전화 010-1234-5678 주민번호 900101-1234567 카드 1234-5678-9012-3456';
      const critical_detections = detect_pii_with_severity(critical_text);
      const critical_names = critical_detections.filter((d) => d.severity === 'critical').map((d) => d.name);
      expect(critical_names).toContain('labeled_korean_name');
      expect(critical_names).toContain('phone_number');
      expect(critical_names).toContain('resident_id');
      expect(critical_names).toContain('credit_card');

      // Warning types
      const warning_text = 'user@test.com 서울시 강남구 역삼동 계좌 110-123-456789 연봉 약 5000만 10.0.0.1 http://localhost:3100';
      const warning_detections = detect_pii_with_severity(warning_text);
      const warning_names = warning_detections.filter((d) => d.severity === 'warning').map((d) => d.name);
      expect(warning_names).toContain('email');
      expect(warning_names).toContain('address');
      expect(warning_names).toContain('bank_account');
      expect(warning_names).toContain('financial_amount');
      expect(warning_names).toContain('ip_address');
      expect(warning_names).toContain('internal_url');
    });
  });
});
