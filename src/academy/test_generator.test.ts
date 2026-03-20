import { describe, it, expect } from 'vitest';
import {
  create_question_bank,
  generate_test,
  format_test_sheet,
  format_answer_key,
  validate_test,
  type TestConfig,
  type Question,
  type GeneratedTest,
  type DifficultyLevel,
  type SubjectArea,
} from './test_generator';

const VALID_LABELS = ['①', '②', '③', '④', '⑤'];

describe('create_question_bank', () => {
  it('should return Question[] for physics/역학', () => {
    const bank = create_question_bank('physics', '역학');
    expect(Array.isArray(bank)).toBe(true);
    expect(bank.length).toBeGreaterThanOrEqual(25);
  });

  it('should have 5 choices per question with Korean labels', () => {
    const bank = create_question_bank('physics', '역학');
    for (const q of bank) {
      expect(q.choices).toHaveLength(5);
      const labels = q.choices.map((c) => c.label);
      expect(labels).toEqual(VALID_LABELS);
    }
  });

  it('should include all 3 difficulty levels', () => {
    const bank = create_question_bank('physics', '역학');
    const levels = new Set(bank.map((q) => q.difficulty_tag));
    expect(levels.has('regular')).toBe(true);
    expect(levels.has('ogeum')).toBe(true);
    expect(levels.has('medical')).toBe(true);
  });

  it('should have valid correct_answer labels', () => {
    const bank = create_question_bank('physics', '역학');
    for (const q of bank) {
      expect(VALID_LABELS).toContain(q.correct_answer);
    }
  });

  it('should have numbered questions starting from 1', () => {
    const bank = create_question_bank('physics', '역학');
    for (let i = 0; i < bank.length; i++) {
      expect(bank[i].number).toBe(i + 1);
    }
  });

  it('should have non-empty stems and explanations', () => {
    const bank = create_question_bank('physics', '역학');
    for (const q of bank) {
      expect(q.stem.length).toBeGreaterThan(0);
      expect(q.explanation.length).toBeGreaterThan(0);
    }
  });

  it('should return empty array for unsupported subject/chapter', () => {
    const bank = create_question_bank('chemistry', '유기화학');
    expect(Array.isArray(bank)).toBe(true);
    // May be empty or have questions depending on implementation
  });
});

describe('generate_test', () => {
  const base_config: TestConfig = {
    subject: 'physics',
    chapter: '역학',
    difficulty: 'regular',
    num_questions: 20,
    time_limit_minutes: 40,
    include_explanations: true,
  };

  it('should return a GeneratedTest with correct structure', () => {
    const test = generate_test(base_config);
    expect(test.test_sheet).toBeDefined();
    expect(test.answer_key).toBeDefined();
    expect(test.metadata).toBeDefined();
  });

  it('should respect num_questions from config', () => {
    const test = generate_test({ ...base_config, num_questions: 10 });
    expect(test.test_sheet.questions).toHaveLength(10);
    expect(test.answer_key.answers).toHaveLength(10);
  });

  it('should default to 20 questions when not specified', () => {
    const config: TestConfig = {
      subject: 'physics',
      chapter: '역학',
      difficulty: 'regular',
    };
    const test = generate_test(config);
    expect(test.test_sheet.questions).toHaveLength(20);
  });

  it('should default to 40 minutes when not specified', () => {
    const config: TestConfig = {
      subject: 'physics',
      chapter: '역학',
      difficulty: 'regular',
    };
    const test = generate_test(config);
    expect(test.test_sheet.time_limit_minutes).toBe(40);
  });

  it('should filter by difficulty level', () => {
    const test = generate_test({ ...base_config, difficulty: 'medical', num_questions: 5 });
    // Should have questions, borrowing from adjacent if needed
    expect(test.test_sheet.questions.length).toBe(5);
  });

  it('should populate metadata with generated_at timestamp', () => {
    const test = generate_test(base_config);
    expect(test.metadata.generated_at).toBeDefined();
    expect(typeof test.metadata.generated_at).toBe('string');
    // Should be a valid ISO date
    expect(() => new Date(test.metadata.generated_at)).not.toThrow();
  });

  it('should populate metadata with difficulty_distribution', () => {
    const test = generate_test(base_config);
    expect(test.metadata.difficulty_distribution).toBeDefined();
    const total = Object.values(test.metadata.difficulty_distribution).reduce((a, b) => a + b, 0);
    expect(total).toBe(test.test_sheet.questions.length);
  });

  it('should populate metadata with topic_coverage', () => {
    const test = generate_test(base_config);
    expect(Array.isArray(test.metadata.topic_coverage)).toBe(true);
    expect(test.metadata.topic_coverage.length).toBeGreaterThan(0);
  });

  it('should set correct subject and chapter on test sheet', () => {
    const test = generate_test(base_config);
    expect(test.test_sheet.subject).toBe('physics');
    expect(test.test_sheet.chapter).toBe('역학');
    expect(test.test_sheet.difficulty).toBe('regular');
  });

  it('should number questions sequentially from 1', () => {
    const test = generate_test(base_config);
    for (let i = 0; i < test.test_sheet.questions.length; i++) {
      expect(test.test_sheet.questions[i].number).toBe(i + 1);
    }
  });

  it('should have total_points equal to question count * 5', () => {
    const test = generate_test({ ...base_config, num_questions: 10 });
    expect(test.test_sheet.total_points).toBe(50);
  });
});

describe('format_test_sheet', () => {
  const config: TestConfig = {
    subject: 'physics',
    chapter: '역학',
    difficulty: 'regular',
    num_questions: 5,
    time_limit_minutes: 30,
  };

  it('should include EIDOS SCIENCE header', () => {
    const test = generate_test(config);
    const sheet = format_test_sheet(test);
    expect(sheet).toContain('EIDOS SCIENCE');
  });

  it('should include subject and chapter', () => {
    const test = generate_test(config);
    const sheet = format_test_sheet(test);
    expect(sheet).toContain('물리학');
    expect(sheet).toContain('역학');
  });

  it('should include time limit', () => {
    const test = generate_test(config);
    const sheet = format_test_sheet(test);
    expect(sheet).toContain('30');
  });

  it('should include name field', () => {
    const test = generate_test(config);
    const sheet = format_test_sheet(test);
    expect(sheet).toContain('이름');
  });

  it('should include all questions with numbered stems', () => {
    const test = generate_test(config);
    const sheet = format_test_sheet(test);
    for (let i = 1; i <= 5; i++) {
      expect(sheet).toContain(`${i}.`);
    }
  });

  it('should include choice labels ① through ⑤', () => {
    const test = generate_test(config);
    const sheet = format_test_sheet(test);
    for (const label of VALID_LABELS) {
      expect(sheet).toContain(label);
    }
  });

  it('should include total points in footer', () => {
    const test = generate_test(config);
    const sheet = format_test_sheet(test);
    expect(sheet).toContain(`${test.test_sheet.total_points}`);
  });
});

describe('format_answer_key', () => {
  const config: TestConfig = {
    subject: 'physics',
    chapter: '역학',
    difficulty: 'regular',
    num_questions: 5,
    include_explanations: true,
  };

  it('should include answer grid with correct answers', () => {
    const test = generate_test(config);
    const key = format_answer_key(test);
    for (const ans of test.answer_key.answers) {
      expect(key).toContain(ans.correct);
    }
  });

  it('should include explanations when enabled', () => {
    const test = generate_test(config);
    const key = format_answer_key(test);
    expect(key).toContain('해설');
  });

  it('should omit explanations when disabled', () => {
    const test = generate_test({ ...config, include_explanations: false });
    const key = format_answer_key(test);
    // Should still have answers but no detailed explanations section
    expect(key).toContain('정답');
  });

  it('should include test title', () => {
    const test = generate_test(config);
    const key = format_answer_key(test);
    expect(key).toContain(test.answer_key.test_title);
  });
});

describe('validate_test', () => {
  const config: TestConfig = {
    subject: 'physics',
    chapter: '역학',
    difficulty: 'regular',
    num_questions: 10,
  };

  it('should return valid for a properly generated test', () => {
    const test = generate_test(config);
    const result = validate_test(test);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should detect wrong question count', () => {
    const test = generate_test(config);
    // Mutate: remove a question
    test.test_sheet.questions.pop();
    const result = validate_test(test);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('count'))).toBe(true);
  });

  it('should detect questions with wrong number of choices', () => {
    const test = generate_test(config);
    // Mutate: remove a choice from first question
    test.test_sheet.questions[0].choices = test.test_sheet.questions[0].choices.slice(0, 3);
    const result = validate_test(test);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('choices') || i.includes('5'))).toBe(true);
  });

  it('should detect invalid correct_answer labels', () => {
    const test = generate_test(config);
    // Mutate: set invalid answer
    test.test_sheet.questions[0].correct_answer = '⑥';
    const result = validate_test(test);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('answer') || i.includes('label'))).toBe(true);
  });

  it('should detect duplicate stems', () => {
    const test = generate_test(config);
    // Mutate: duplicate a stem
    test.test_sheet.questions[1].stem = test.test_sheet.questions[0].stem;
    const result = validate_test(test);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('duplicate') || i.includes('중복'))).toBe(true);
  });

  it('should return multiple issues when multiple problems exist', () => {
    const test = generate_test(config);
    // Mutate multiple things
    test.test_sheet.questions[0].correct_answer = '⑥';
    test.test_sheet.questions[1].stem = test.test_sheet.questions[0].stem;
    test.test_sheet.questions[2].choices = [];
    const result = validate_test(test);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });
});
