// Tests for parent message CLI module
// Covers: argument parsing, interactive prompt building, output formatting

import { describe, it, expect } from 'vitest';
import {
  parse_parent_message_args,
  build_student_context_from_args,
  format_output,
  type ParentMessageCliArgs,
} from './cli_parent_message.js';

// === parse_parent_message_args ===

describe('parse_parent_message_args', () => {
  it('should parse minimal required arguments', () => {
    // Given: minimal args
    const argv = ['--name', '김민수', '--grade', '고1', '--topics', '이차함수,판별식'];

    // When: parsing
    const result = parse_parent_message_args(argv);

    // Then: should return parsed args
    expect(result.name).toBe('김민수');
    expect(result.grade).toBe('고1');
    expect(result.topics).toEqual(['이차함수', '판별식']);
  });

  it('should parse all optional arguments', () => {
    // Given: full args
    const argv = [
      '--name', '박서연',
      '--grade', '고2',
      '--class-type', 'medical',
      '--topics', '벡터의 내적,정사영',
      '--performance', '집중력 좋음,질문 많이 함',
      '--homework', '교재 p.52~54',
      '--next-class', '다음 시간 단원평가',
      '--date', '2026-03-22',
      '--tone', 'enthusiastic',
    ];

    // When: parsing
    const result = parse_parent_message_args(argv);

    // Then: should include all fields
    expect(result.name).toBe('박서연');
    expect(result.grade).toBe('고2');
    expect(result.class_type).toBe('medical');
    expect(result.topics).toEqual(['벡터의 내적', '정사영']);
    expect(result.performance).toEqual(['집중력 좋음', '질문 많이 함']);
    expect(result.homework).toBe('교재 p.52~54');
    expect(result.next_class).toBe('다음 시간 단원평가');
    expect(result.date).toBe('2026-03-22');
    expect(result.tone).toBe('enthusiastic');
  });

  it('should default class_type to regular', () => {
    const argv = ['--name', '김민수', '--grade', '고1', '--topics', '역학'];
    const result = parse_parent_message_args(argv);
    expect(result.class_type).toBe('regular');
  });

  it('should default date to today', () => {
    const argv = ['--name', '김민수', '--grade', '고1', '--topics', '역학'];
    const result = parse_parent_message_args(argv);
    const today = new Date().toISOString().split('T')[0];
    expect(result.date).toBe(today);
  });

  it('should default tone to caring', () => {
    const argv = ['--name', '김민수', '--grade', '고1', '--topics', '역학'];
    const result = parse_parent_message_args(argv);
    expect(result.tone).toBe('caring');
  });

  it('should throw on missing required --name', () => {
    const argv = ['--grade', '고1', '--topics', '역학'];
    expect(() => parse_parent_message_args(argv)).toThrow('--name');
  });

  it('should throw on missing required --grade', () => {
    const argv = ['--name', '김민수', '--topics', '역학'];
    expect(() => parse_parent_message_args(argv)).toThrow('--grade');
  });

  it('should throw on missing required --topics', () => {
    const argv = ['--name', '김민수', '--grade', '고1'];
    expect(() => parse_parent_message_args(argv)).toThrow('--topics');
  });
});

// === build_student_context_from_args ===

describe('build_student_context_from_args', () => {
  it('should build StudentContext and ClassKeywords from parsed args', () => {
    // Given: parsed args
    const args: ParentMessageCliArgs = {
      name: '김민수',
      grade: '고1',
      class_type: 'regular',
      topics: ['이차함수', '판별식'],
      performance: ['집중력 좋음'],
      homework: '교재 p.52',
      next_class: '다음 시간 시험',
      date: '2026-03-22',
      tone: 'caring',
    };

    // When: building context
    const { student, keywords, tone } = build_student_context_from_args(args);

    // Then: student context should be correct
    expect(student.name).toBe('김민수');
    expect(student.grade).toBe('고1');
    expect(student.class_type).toBe('regular');

    // And: keywords should be correct
    expect(keywords.date).toBe('2026-03-22');
    expect(keywords.topics_covered).toEqual(['이차함수', '판별식']);
    expect(keywords.performance_keywords).toEqual(['집중력 좋음']);
    expect(keywords.homework).toBe('교재 p.52');
    expect(keywords.next_class_note).toBe('다음 시간 시험');

    // And: tone should be correct
    expect(tone.warmth).toBe('caring');
    expect(tone.formality).toBe('formal');
    expect(tone.language).toBe('ko');
  });

  it('should handle empty performance keywords', () => {
    const args: ParentMessageCliArgs = {
      name: '김민수',
      grade: '고1',
      class_type: 'regular',
      topics: ['역학'],
      date: '2026-03-22',
      tone: 'caring',
    };

    const { keywords } = build_student_context_from_args(args);
    expect(keywords.performance_keywords).toEqual([]);
  });

  it('should map medical class type correctly', () => {
    const args: ParentMessageCliArgs = {
      name: '김민수',
      grade: '고2',
      class_type: 'medical',
      topics: ['역학'],
      date: '2026-03-22',
      tone: 'caring',
    };

    const { student } = build_student_context_from_args(args);
    expect(student.class_type).toBe('medical');
  });
});

// === format_output ===

describe('format_output', () => {
  it('should format message as plain text by default', () => {
    // Given: a generated message
    const message = {
      greeting: '안녕하세요, 김민수 학부모님.',
      body: '오늘 수업에서 역학을 학습했습니다.',
      closing: '감사합니다.',
      full_text: '안녕하세요, 김민수 학부모님.\n\n오늘 수업에서 역학을 학습했습니다.\n\n감사합니다.',
      char_count: 55,
    };

    // When: formatting as text
    const output = format_output(message, 'text');

    // Then: should contain the full text
    expect(output).toContain(message.full_text);
  });

  it('should format message as JSON', () => {
    const message = {
      greeting: '안녕하세요',
      body: '본문',
      closing: '감사합니다',
      full_text: '안녕하세요\n\n본문\n\n감사합니다',
      char_count: 20,
    };

    const output = format_output(message, 'json');
    const parsed = JSON.parse(output);
    expect(parsed.greeting).toBe('안녕하세요');
    expect(parsed.char_count).toBe(20);
  });

  it('should include char count and validation in text format', () => {
    const message = {
      greeting: '안녕하세요, 김민수 학부모님.',
      body: '오늘 수업에서 이차함수의 그래프와 판별식을 학습하였습니다. 김민수 학생은 집중력 좋음, 질문 많이 함 등의 모습을 보여주었습니다. 앞으로도 학생의 학습 진도와 이해도를 세심하게 관리하겠습니다.',
      closing: '김민수 학생이 꾸준히 성장할 수 있도록 함께 지도하겠습니다. 감사합니다.',
      full_text: '',
      char_count: 250,
    };
    message.full_text = `${message.greeting}\n\n${message.body}\n\n${message.closing}`;
    message.char_count = message.full_text.length;

    const output = format_output(message, 'text');
    expect(output).toContain('글자수');
  });
});
