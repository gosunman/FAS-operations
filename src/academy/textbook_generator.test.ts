// Textbook chapter content generator tests for EIDOS SCIENCE
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, statSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  generate_chapter_content,
  format_chapter_for_print,
  generate_chapter_pdf,
  validate_chapter,
  type ChapterConfig,
  type ChapterContent,
  type ConceptSection,
  type ExampleProblem,
  type PracticeProblem,
} from './textbook_generator.js';

// ─── Shared Fixtures ─────────────────────────────────────────

const PHYSICS_CONFIG: ChapterConfig = {
  subject: 'physics',
  unit: '역학과 에너지',
  chapter: '운동의 법칙',
  level: 'standard',
  include_examples: true,
  include_practice: true,
};

const TEST_OUTPUT_DIR = join(tmpdir(), 'fas-textbook-test-' + Date.now());

// Setup temp dir
mkdirSync(TEST_OUTPUT_DIR, { recursive: true });

// Cleanup after all tests
afterAll(() => {
  const files_to_clean = [
    join(TEST_OUTPUT_DIR, 'chapter_test.pdf'),
  ];
  for (const f of files_to_clean) {
    if (existsSync(f)) unlinkSync(f);
  }
  try {
    rmdirSync(TEST_OUTPUT_DIR);
  } catch {
    // ignore if not empty
  }
});

// ─── generate_chapter_content ─────────────────────────────────

describe('generate_chapter_content', () => {
  it('should return a ChapterContent with correct metadata', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    expect(content.subject).toBe('physics');
    expect(content.unit).toBe('역학과 에너지');
    expect(content.chapter).toBe('운동의 법칙');
    expect(content.level).toBe('standard');
  });

  it('should have generated_at as a valid ISO timestamp', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    expect(content.generated_at).toBeDefined();
    expect(() => new Date(content.generated_at)).not.toThrow();
    // Should be a recent timestamp (within last minute)
    const diff = Date.now() - new Date(content.generated_at).getTime();
    expect(diff).toBeLessThan(60_000);
  });

  it('should have 3-5 concept sections', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    expect(content.sections.length).toBeGreaterThanOrEqual(3);
    expect(content.sections.length).toBeLessThanOrEqual(5);
  });

  it('should have concept sections with title and content', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    for (const section of content.sections) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.content.length).toBeGreaterThan(0);
    }
  });

  it('should have at least one section with key_formulas for physics', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    const has_formulas = content.sections.some(
      (s) => s.key_formulas && s.key_formulas.length > 0,
    );
    expect(has_formulas).toBe(true);
  });

  it('should have at least one section with important_notes', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    const has_notes = content.sections.some(
      (s) => s.important_notes && s.important_notes.length > 0,
    );
    expect(has_notes).toBe(true);
  });

  it('should include 3 worked examples when include_examples is true', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    expect(content.examples.length).toBeGreaterThanOrEqual(3);
  });

  it('should have examples with numbered problem, solution_steps, answer', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    for (const ex of content.examples) {
      expect(ex.number).toBeGreaterThan(0);
      expect(ex.problem.length).toBeGreaterThan(0);
      expect(ex.solution_steps.length).toBeGreaterThan(0);
      expect(ex.answer.length).toBeGreaterThan(0);
      expect(['basic', 'standard', 'advanced']).toContain(ex.difficulty);
    }
  });

  it('should include 5 practice problems when include_practice is true', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    expect(content.practice_problems.length).toBeGreaterThanOrEqual(5);
  });

  it('should have practice problems with numbered problem and answer', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    for (const pp of content.practice_problems) {
      expect(pp.number).toBeGreaterThan(0);
      expect(pp.problem.length).toBeGreaterThan(0);
      expect(pp.answer.length).toBeGreaterThan(0);
    }
  });

  it('should have at least some multiple-choice practice problems with choices', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    const has_choices = content.practice_problems.some(
      (pp) => pp.choices && pp.choices.length > 0,
    );
    expect(has_choices).toBe(true);
  });

  it('should include a non-empty summary', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    expect(content.summary.length).toBeGreaterThan(0);
    // Summary should mention key physics terms
    expect(content.summary).toMatch(/뉴턴|운동|법칙|힘/);
  });

  it('should include key_terms with term and definition', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    expect(content.key_terms.length).toBeGreaterThan(0);
    for (const kt of content.key_terms) {
      expect(kt.term.length).toBeGreaterThan(0);
      expect(kt.definition.length).toBeGreaterThan(0);
    }
  });

  it('should return empty examples when include_examples is false', () => {
    const config: ChapterConfig = { ...PHYSICS_CONFIG, include_examples: false };
    const content = generate_chapter_content(config);
    expect(content.examples).toHaveLength(0);
  });

  it('should return empty practice_problems when include_practice is false', () => {
    const config: ChapterConfig = { ...PHYSICS_CONFIG, include_practice: false };
    const content = generate_chapter_content(config);
    expect(content.practice_problems).toHaveLength(0);
  });

  it('should handle all three levels: basic, standard, advanced', () => {
    for (const level of ['basic', 'standard', 'advanced'] as const) {
      const config: ChapterConfig = { ...PHYSICS_CONFIG, level };
      const content = generate_chapter_content(config);
      expect(content.level).toBe(level);
      expect(content.sections.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('should return content with Korean text', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    // Check that sections contain Korean characters
    const all_text = content.sections.map((s) => s.content).join('');
    expect(all_text).toMatch(/[가-힣]/);
  });
});

// ─── format_chapter_for_print ─────────────────────────────────

describe('format_chapter_for_print', () => {
  let content: ChapterContent;

  it('should return a non-empty string', () => {
    content = generate_chapter_content(PHYSICS_CONFIG);
    const text = format_chapter_for_print(content);
    expect(text.length).toBeGreaterThan(0);
  });

  it('should include EIDOS SCIENCE header', () => {
    content = generate_chapter_content(PHYSICS_CONFIG);
    const text = format_chapter_for_print(content);
    expect(text).toContain('EIDOS SCIENCE');
  });

  it('should include chapter and unit info', () => {
    content = generate_chapter_content(PHYSICS_CONFIG);
    const text = format_chapter_for_print(content);
    expect(text).toContain('운동의 법칙');
    expect(text).toContain('역학과 에너지');
  });

  it('should include all section titles', () => {
    content = generate_chapter_content(PHYSICS_CONFIG);
    const text = format_chapter_for_print(content);
    for (const section of content.sections) {
      expect(text).toContain(section.title);
    }
  });

  it('should include example problems section', () => {
    content = generate_chapter_content(PHYSICS_CONFIG);
    const text = format_chapter_for_print(content);
    expect(text).toContain('예제');
  });

  it('should include practice problems section', () => {
    content = generate_chapter_content(PHYSICS_CONFIG);
    const text = format_chapter_for_print(content);
    expect(text).toContain('연습문제');
  });

  it('should include summary section', () => {
    content = generate_chapter_content(PHYSICS_CONFIG);
    const text = format_chapter_for_print(content);
    expect(text).toContain('단원 요약');
  });

  it('should include key terms section', () => {
    content = generate_chapter_content(PHYSICS_CONFIG);
    const text = format_chapter_for_print(content);
    expect(text).toContain('핵심 용어');
  });

  it('should include formulas when present', () => {
    content = generate_chapter_content(PHYSICS_CONFIG);
    const text = format_chapter_for_print(content);
    // Physics chapter should include F=ma or similar
    expect(text).toMatch(/F\s*=\s*ma|F=ma/);
  });
});

// ─── generate_chapter_pdf ─────────────────────────────────────

describe('generate_chapter_pdf', () => {
  it('should create a PDF file at the expected path', async () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    const output_path = join(TEST_OUTPUT_DIR, 'chapter_test.pdf');
    const result = await generate_chapter_pdf(content, output_path);

    expect(result).toBe(output_path);
    expect(existsSync(output_path)).toBe(true);
  });

  it('should generate a non-empty PDF (> 1KB)', async () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    const output_path = join(TEST_OUTPUT_DIR, 'chapter_test.pdf');
    if (!existsSync(output_path)) {
      await generate_chapter_pdf(content, output_path);
    }
    const stats = statSync(output_path);
    expect(stats.size).toBeGreaterThan(1024);
  });
});

// ─── validate_chapter ─────────────────────────────────────────

describe('validate_chapter', () => {
  it('should return valid for a properly generated chapter', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    const result = validate_chapter(content);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should detect empty sections', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    content.sections = [];
    const result = validate_chapter(content);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('section'))).toBe(true);
  });

  it('should detect section with empty title', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    content.sections[0] = { ...content.sections[0], title: '' };
    const result = validate_chapter(content);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('title'))).toBe(true);
  });

  it('should detect section with empty content', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    content.sections[0] = { ...content.sections[0], content: '' };
    const result = validate_chapter(content);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('content'))).toBe(true);
  });

  it('should detect example with empty solution_steps', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    if (content.examples.length > 0) {
      content.examples[0] = { ...content.examples[0], solution_steps: [] };
      const result = validate_chapter(content);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('solution'))).toBe(true);
    }
  });

  it('should detect practice problem with empty answer', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    if (content.practice_problems.length > 0) {
      content.practice_problems[0] = { ...content.practice_problems[0], answer: '' };
      const result = validate_chapter(content);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('answer'))).toBe(true);
    }
  });

  it('should detect empty summary', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    content.summary = '';
    const result = validate_chapter(content);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('summary'))).toBe(true);
  });

  it('should detect empty key_terms', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    content.key_terms = [];
    const result = validate_chapter(content);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('key_terms') || i.includes('용어'))).toBe(true);
  });

  it('should detect missing subject', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    content.subject = '';
    const result = validate_chapter(content);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('subject'))).toBe(true);
  });

  it('should report multiple issues at once', () => {
    const content = generate_chapter_content(PHYSICS_CONFIG);
    content.sections = [];
    content.summary = '';
    content.key_terms = [];
    const result = validate_chapter(content);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });
});
