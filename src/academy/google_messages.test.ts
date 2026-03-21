// Google Messages module tests — pure function tests (no browser)

import { describe, it, expect } from 'vitest';
import {
  normalize_phone,
  is_valid_phone,
  format_phone_display,
  truncate_for_sms,
  prepare_sms,
  validate_recipients,
  type SmsRecipient,
} from './google_messages.js';
import type { ParentMessage } from './parent_message.js';

// === normalize_phone ===

describe('normalize_phone', () => {
  it('normalizes standard 010 number', () => {
    expect(normalize_phone('010-1234-5678')).toBe('01012345678');
  });

  it('normalizes number without dashes', () => {
    expect(normalize_phone('01012345678')).toBe('01012345678');
  });

  it('normalizes 011 number', () => {
    expect(normalize_phone('011-123-4567')).toBe('0111234567');
  });

  it('normalizes 016 number', () => {
    expect(normalize_phone('016-123-4567')).toBe('0161234567');
  });

  it('returns null for invalid prefix', () => {
    expect(normalize_phone('020-1234-5678')).toBeNull();
  });

  it('returns null for too short number', () => {
    expect(normalize_phone('010-123')).toBeNull();
  });

  it('returns null for too long number', () => {
    expect(normalize_phone('010-12345-67890')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalize_phone('')).toBeNull();
  });

  it('handles extra spaces', () => {
    expect(normalize_phone(' 010-1234-5678 ')).toBe('01012345678');
  });
});

// === is_valid_phone ===

describe('is_valid_phone', () => {
  it('accepts valid 010 number', () => {
    expect(is_valid_phone('010-1234-5678')).toBe(true);
  });

  it('rejects invalid number', () => {
    expect(is_valid_phone('123-456-7890')).toBe(false);
  });
});

// === format_phone_display ===

describe('format_phone_display', () => {
  it('formats 11-digit number', () => {
    expect(format_phone_display('01012345678')).toBe('010-1234-5678');
  });

  it('formats already-dashed number', () => {
    expect(format_phone_display('010-1234-5678')).toBe('010-1234-5678');
  });

  it('formats 10-digit number', () => {
    expect(format_phone_display('0111234567')).toBe('011-123-4567');
  });

  it('returns original for invalid', () => {
    expect(format_phone_display('invalid')).toBe('invalid');
  });
});

// === truncate_for_sms ===

describe('truncate_for_sms', () => {
  it('does not truncate short messages', () => {
    const result = truncate_for_sms('Hello');
    expect(result.text).toBe('Hello');
    expect(result.truncated).toBe(false);
  });

  it('truncates messages exceeding max_length', () => {
    const long = 'A'.repeat(2100);
    const result = truncate_for_sms(long, 2000);
    expect(result.text.length).toBe(2000);
    expect(result.text.endsWith('...')).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it('respects custom max_length', () => {
    const result = truncate_for_sms('Hello World', 5);
    expect(result.text).toBe('He...');
    expect(result.truncated).toBe(true);
  });
});

// === prepare_sms ===

describe('prepare_sms', () => {
  const make_message = (text: string): ParentMessage => ({
    greeting: '',
    body: '',
    closing: '',
    full_text: text,
    char_count: text.length,
  });

  it('prepares valid SMS', () => {
    const result = prepare_sms(
      { name: '김철수', phone: '010-1234-5678' },
      make_message('안녕하세요, 김철수 학부모님.'),
    );

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.phone).toBe('01012345678');
      expect(result.text).toContain('안녕하세요');
      expect(result.preview.length).toBeLessThanOrEqual(50);
    }
  });

  it('returns error for invalid phone', () => {
    const result = prepare_sms(
      { name: '김철수', phone: 'invalid' },
      make_message('test'),
    );

    expect('error' in result).toBe(true);
  });
});

// === validate_recipients ===

describe('validate_recipients', () => {
  it('separates valid and invalid recipients', () => {
    const recipients: SmsRecipient[] = [
      { name: '김철수', phone: '010-1234-5678' },
      { name: '', phone: '010-1111-2222' },
      { name: '이영희', phone: 'invalid' },
      { name: '박민수', phone: '010-9876-5432' },
    ];

    const result = validate_recipients(recipients);
    expect(result.valid).toHaveLength(2);
    expect(result.invalid).toHaveLength(2);
    expect(result.invalid[0].reason).toContain('Empty name');
    expect(result.invalid[1].reason).toContain('Invalid phone');
  });

  it('handles empty array', () => {
    const result = validate_recipients([]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(0);
  });

  it('all valid', () => {
    const result = validate_recipients([
      { name: 'A', phone: '010-1111-2222' },
      { name: 'B', phone: '010-3333-4444' },
    ]);
    expect(result.valid).toHaveLength(2);
    expect(result.invalid).toHaveLength(0);
  });
});
