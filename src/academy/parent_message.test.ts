// Parent message auto-generation tests — vitest, Given-When-Then pattern
// Tests: message generation, tone rules, validation, edge cases

import { describe, it, expect } from 'vitest';
import {
  generate_parent_message,
  apply_tone_rules,
  validate_message,
  type StudentContext,
  type ClassKeywords,
  type ToneConfig,
  type ParentMessage,
} from './parent_message.js';

// === Test fixtures ===

const make_student = (overrides?: Partial<StudentContext>): StudentContext => ({
  name: '김민수',
  grade: '고1',
  class_type: 'regular',
  subjects: ['수학', '물리'],
  ...overrides,
});

const make_keywords = (overrides?: Partial<ClassKeywords>): ClassKeywords => ({
  date: '2026-03-21',
  topics_covered: ['이차함수의 그래프', '판별식'],
  performance_keywords: ['집중력 좋음', '질문 많이 함'],
  ...overrides,
});

const make_tone = (overrides?: Partial<ToneConfig>): ToneConfig => ({
  formality: 'formal',
  warmth: 'caring',
  language: 'ko',
  ...overrides,
});

// === generate_parent_message ===

describe('generate_parent_message', () => {
  it('should return a ParentMessage with all required fields', () => {
    const result = generate_parent_message(make_student(), make_keywords());

    expect(result).toHaveProperty('greeting');
    expect(result).toHaveProperty('body');
    expect(result).toHaveProperty('closing');
    expect(result).toHaveProperty('full_text');
    expect(result).toHaveProperty('char_count');
    expect(typeof result.greeting).toBe('string');
    expect(typeof result.body).toBe('string');
    expect(typeof result.closing).toBe('string');
    expect(typeof result.full_text).toBe('string');
    expect(typeof result.char_count).toBe('number');
  });

  it('should include student name in greeting', () => {
    const result = generate_parent_message(make_student({ name: '박서연' }), make_keywords());

    expect(result.greeting).toContain('박서연');
  });

  it('should include topics covered in body', () => {
    const keywords = make_keywords({ topics_covered: ['벡터의 내적', '정사영'] });
    const result = generate_parent_message(make_student(), keywords);

    expect(result.body).toContain('벡터의 내적');
    expect(result.body).toContain('정사영');
  });

  it('should include performance keywords in body', () => {
    const keywords = make_keywords({ performance_keywords: ['집중력 우수', '응용력 향상'] });
    const result = generate_parent_message(make_student(), keywords);

    expect(result.body).toContain('집중력 우수');
    expect(result.body).toContain('응용력 향상');
  });

  it('should include homework when provided', () => {
    const keywords = make_keywords({ homework: '교재 p.52~54 풀어오기' });
    const result = generate_parent_message(make_student(), keywords);

    expect(result.full_text).toContain('교재 p.52~54 풀어오기');
  });

  it('should not include homework section when not provided', () => {
    const keywords = make_keywords({ homework: undefined });
    const result = generate_parent_message(make_student(), keywords);

    expect(result.full_text).not.toContain('숙제');
    expect(result.full_text).not.toContain('과제');
  });

  it('should include next class note when provided', () => {
    const keywords = make_keywords({ next_class_note: '다음 시간에 단원평가 예정' });
    const result = generate_parent_message(make_student(), keywords);

    expect(result.full_text).toContain('다음 시간에 단원평가 예정');
  });

  it('should have char_count matching full_text length', () => {
    const result = generate_parent_message(make_student(), make_keywords());

    expect(result.char_count).toBe(result.full_text.length);
  });

  it('should produce full_text that is concatenation of greeting + body + closing', () => {
    const result = generate_parent_message(make_student(), make_keywords());

    // full_text should contain all three sections
    expect(result.full_text).toContain(result.greeting);
    expect(result.full_text).toContain(result.body);
    expect(result.full_text).toContain(result.closing);
  });

  it('should generate message within 200-500 char range by default', () => {
    const result = generate_parent_message(make_student(), make_keywords());

    expect(result.char_count).toBeGreaterThanOrEqual(200);
    expect(result.char_count).toBeLessThanOrEqual(500);
  });

  // === Default tone ===

  it('should use formal + caring + ko as default tone', () => {
    const result = generate_parent_message(make_student(), make_keywords());

    // Formal: should use 존댓말 endings
    expect(result.full_text).toMatch(/습니다|드립니다|바랍니다|감사합니다/);
  });

  // === Different class types ===

  it('should handle medical class type', () => {
    const student = make_student({ class_type: 'medical', grade: '고2' });
    const result = generate_parent_message(student, make_keywords());

    expect(result.full_text).toBeDefined();
    expect(result.char_count).toBeGreaterThan(0);
  });

  it('should handle ogeum class type', () => {
    const student = make_student({ class_type: 'ogeum', grade: '고1' });
    const result = generate_parent_message(student, make_keywords());

    expect(result.full_text).toBeDefined();
    expect(result.char_count).toBeGreaterThan(0);
  });

  // === Recent scores ===

  it('should include score information when recent_scores provided', () => {
    const student = make_student({
      recent_scores: [{ subject: '수학', score: 85, max_score: 100 }],
    });
    const result = generate_parent_message(student, make_keywords());

    expect(result.full_text).toMatch(/85|수학/);
  });

  // === Attendance note ===

  it('should include attendance note when provided', () => {
    const student = make_student({ attendance_note: '10분 지각' });
    const result = generate_parent_message(student, make_keywords());

    expect(result.full_text).toContain('10분 지각');
  });

  // === Previous memo ===

  it('should reference previous memo when provided', () => {
    const student = make_student({ previous_memo: '미적분 기초 보충 필요' });
    const result = generate_parent_message(student, make_keywords());

    // Should acknowledge continuity from previous class
    expect(result.full_text).toBeDefined();
    // The implementation should use previous_memo to provide context
  });

  // === Custom tone ===

  it('should respect semi_formal tone setting', () => {
    const tone: ToneConfig = { formality: 'semi_formal', warmth: 'professional', language: 'ko' };
    const result = generate_parent_message(make_student(), make_keywords(), tone);

    expect(result.full_text).toBeDefined();
    expect(result.char_count).toBeGreaterThan(0);
  });

  it('should respect enthusiastic warmth setting', () => {
    const tone: ToneConfig = { formality: 'formal', warmth: 'enthusiastic', language: 'ko' };
    const result = generate_parent_message(make_student(), make_keywords(), tone);

    expect(result.full_text).toBeDefined();
    expect(result.char_count).toBeGreaterThan(0);
  });

  // === Edge cases ===

  it('should handle empty performance keywords', () => {
    const keywords = make_keywords({ performance_keywords: [] });
    const result = generate_parent_message(make_student(), keywords);

    expect(result.full_text).toBeDefined();
    expect(result.char_count).toBeGreaterThan(0);
  });

  it('should handle single topic', () => {
    const keywords = make_keywords({ topics_covered: ['확률'] });
    const result = generate_parent_message(make_student(), keywords);

    expect(result.body).toContain('확률');
  });

  it('should handle many topics without exceeding char limit', () => {
    const keywords = make_keywords({
      topics_covered: ['미분', '적분', '급수', '극한', '연속', '도함수'],
    });
    const result = generate_parent_message(make_student(), keywords);

    expect(result.char_count).toBeLessThanOrEqual(500);
  });

  it('should handle middle school grade', () => {
    const student = make_student({ grade: '중3' });
    const result = generate_parent_message(student, make_keywords());

    expect(result.full_text).toBeDefined();
    expect(result.char_count).toBeGreaterThan(0);
  });
});

// === apply_tone_rules ===

describe('apply_tone_rules', () => {
  it('should return a string', () => {
    const result = apply_tone_rules('테스트 문장입니다.', make_tone());

    expect(typeof result).toBe('string');
  });

  it('should preserve core content in formal tone', () => {
    const draft = '오늘 수업에서 미적분을 다뤘습니다.';
    const result = apply_tone_rules(draft, make_tone({ formality: 'formal' }));

    expect(result).toContain('미적분');
  });

  it('should preserve core content in semi_formal tone', () => {
    const draft = '오늘 수업에서 미적분을 다뤘습니다.';
    const result = apply_tone_rules(draft, make_tone({ formality: 'semi_formal' }));

    expect(result).toContain('미적분');
  });

  it('should not contain slang in formal mode', () => {
    const draft = '오늘 수업 진짜 대박이었어요 ㅋㅋ 완전 잘했음';
    const result = apply_tone_rules(draft, make_tone({ formality: 'formal' }));

    expect(result).not.toMatch(/ㅋㅋ|ㅎㅎ|대박|완전/);
  });

  it('should add positive framing for caring warmth', () => {
    const draft = '민수 학생이 수업에 참여했습니다.';
    const result = apply_tone_rules(draft, make_tone({ warmth: 'caring' }));

    // Caring tone should add warmth indicators
    expect(result.length).toBeGreaterThanOrEqual(draft.length);
  });

  it('should maintain professional distance in professional warmth', () => {
    const draft = '오늘 수업 내용을 전달드립니다.';
    const result = apply_tone_rules(draft, make_tone({ warmth: 'professional' }));

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });

  it('should add enthusiasm markers for enthusiastic warmth', () => {
    const draft = '민수 학생이 오늘 잘했습니다.';
    const result = apply_tone_rules(draft, make_tone({ warmth: 'enthusiastic' }));

    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle empty string input', () => {
    const result = apply_tone_rules('', make_tone());

    expect(typeof result).toBe('string');
  });
});

// === validate_message ===

describe('validate_message', () => {
  const make_valid_message = (overrides?: Partial<ParentMessage>): ParentMessage => {
    const greeting = '안녕하세요, 김민수 학부모님.';
    const body = '오늘 수업에서 이차함수의 그래프와 판별식을 학습하였습니다. 민수 학생이 집중력 좋음, 질문 많이 함 등의 모습을 보여주었습니다. 전반적으로 수업 참여도가 높았으며 개념 이해도도 우수한 편입니다. 앞으로도 학생의 학습 진도와 이해도를 세심하게 관리하겠습니다.';
    const closing = '민수 학생이 꾸준히 성장할 수 있도록 함께 지도하겠습니다. 감사합니다.';
    const full_text = `${greeting}\n\n${body}\n\n${closing}`;
    return {
      greeting,
      body,
      closing,
      full_text,
      char_count: full_text.length,
      ...overrides,
    };
  };

  it('should validate a correct message as valid', () => {
    const result = validate_message(make_valid_message());

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should reject message with char_count below 200', () => {
    const short_msg = make_valid_message({
      full_text: '짧은 메시지',
      char_count: 6,
    });
    const result = validate_message(short_msg);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('200'))).toBe(true);
  });

  it('should reject message with char_count above 500', () => {
    const long_text = '가'.repeat(501);
    const long_msg = make_valid_message({
      full_text: long_text,
      char_count: 501,
    });
    const result = validate_message(long_msg);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('500'))).toBe(true);
  });

  it('should reject message with empty greeting', () => {
    const result = validate_message(make_valid_message({ greeting: '' }));

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.toLowerCase().includes('greeting'))).toBe(true);
  });

  it('should reject message with empty body', () => {
    const result = validate_message(make_valid_message({ body: '' }));

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.toLowerCase().includes('body'))).toBe(true);
  });

  it('should reject message with empty closing', () => {
    const result = validate_message(make_valid_message({ closing: '' }));

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.toLowerCase().includes('closing'))).toBe(true);
  });

  it('should reject message with mismatched char_count', () => {
    const msg = make_valid_message();
    msg.char_count = 999;
    const result = validate_message(msg);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('char_count'))).toBe(true);
  });

  it('should detect inappropriate content — profanity patterns', () => {
    const msg = make_valid_message({
      body: '학생이 멍청하게 문제를 풀었습니다.',
    });
    // Recalculate full_text and char_count
    msg.full_text = `${msg.greeting}\n\n${msg.body}\n\n${msg.closing}`;
    msg.char_count = msg.full_text.length;

    const result = validate_message(msg);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('inappropriate') || i.includes('부적절'))).toBe(true);
  });

  it('should detect negative/harsh language patterns', () => {
    const msg = make_valid_message({
      body: '학생이 수업 태도가 최악이었습니다. 게으르고 집중을 못합니다.',
    });
    msg.full_text = `${msg.greeting}\n\n${msg.body}\n\n${msg.closing}`;
    msg.char_count = msg.full_text.length;

    const result = validate_message(msg);

    expect(result.valid).toBe(false);
  });

  it('should accept message at exactly 200 chars', () => {
    const text = '가'.repeat(200);
    const msg: ParentMessage = {
      greeting: '인사',
      body: '본문',
      closing: '마무리',
      full_text: text,
      char_count: 200,
    };
    const result = validate_message(msg);

    // Should not have char count issue (may have other issues)
    expect(result.issues.some((i) => i.includes('200'))).toBe(false);
  });

  it('should accept message at exactly 500 chars', () => {
    const text = '가'.repeat(500);
    const msg: ParentMessage = {
      greeting: '인사',
      body: '본문',
      closing: '마무리',
      full_text: text,
      char_count: 500,
    };
    const result = validate_message(msg);

    expect(result.issues.some((i) => i.includes('500'))).toBe(false);
  });

  it('should collect multiple issues', () => {
    const msg: ParentMessage = {
      greeting: '',
      body: '',
      closing: '',
      full_text: '',
      char_count: 0,
    };
    const result = validate_message(msg);

    expect(result.valid).toBe(false);
    // Should report at least char_count issue + missing sections
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });
});
