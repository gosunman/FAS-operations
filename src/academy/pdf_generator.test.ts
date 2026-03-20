// PDF generator tests for EIDOS SCIENCE test sheets and answer keys
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, statSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generate_test } from './test_generator.js';
import {
  generate_test_pdf,
  generate_answer_key_pdf,
  generate_combined_pdf,
} from './pdf_generator.js';
import type { GeneratedTest } from './test_generator.js';

// Shared test fixtures
const TEST_OUTPUT_DIR = join(tmpdir(), 'fas-pdf-test-' + Date.now());
let sample_test: GeneratedTest;

// Setup: create output dir and generate a sample test
mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
sample_test = generate_test({
  subject: 'physics',
  chapter: '역학',
  difficulty: 'regular',
  num_questions: 10,
  time_limit_minutes: 30,
  include_explanations: true,
});

// Cleanup: remove all generated PDFs and temp dir after tests
afterAll(() => {
  const cleanup_files = [
    join(TEST_OUTPUT_DIR, 'test_sheet.pdf'),
    join(TEST_OUTPUT_DIR, 'answer_key.pdf'),
    join(TEST_OUTPUT_DIR, 'combined_test.pdf'),
    join(TEST_OUTPUT_DIR, 'combined_answer.pdf'),
  ];
  for (const f of cleanup_files) {
    if (existsSync(f)) unlinkSync(f);
  }
  // Remove temp dir if empty
  try {
    rmdirSync(TEST_OUTPUT_DIR);
  } catch {
    // ignore if not empty
  }
});

describe('generate_test_pdf', () => {
  it('creates a PDF file at the expected path', async () => {
    const output_path = join(TEST_OUTPUT_DIR, 'test_sheet.pdf');
    const result = await generate_test_pdf(sample_test, output_path);

    expect(result).toBe(output_path);
    expect(existsSync(output_path)).toBe(true);
  });

  it('generates a non-empty PDF file (> 1KB)', async () => {
    const output_path = join(TEST_OUTPUT_DIR, 'test_sheet.pdf');
    // File was already created by previous test
    if (!existsSync(output_path)) {
      await generate_test_pdf(sample_test, output_path);
    }
    const stats = statSync(output_path);
    expect(stats.size).toBeGreaterThan(1024);
  });

  it('handles Korean text in questions without throwing', async () => {
    // The sample_test already contains Korean text (물리학, 역학, etc.)
    // This test verifies no encoding errors occur
    const output_path = join(TEST_OUTPUT_DIR, 'test_sheet.pdf');
    if (!existsSync(output_path)) {
      await expect(generate_test_pdf(sample_test, output_path)).resolves.toBeDefined();
    }
    // File should exist and be valid (non-empty)
    expect(existsSync(output_path)).toBe(true);
    expect(statSync(output_path).size).toBeGreaterThan(1024);
  });
});

describe('generate_answer_key_pdf', () => {
  it('creates an answer key PDF at the expected path', async () => {
    const output_path = join(TEST_OUTPUT_DIR, 'answer_key.pdf');
    const result = await generate_answer_key_pdf(sample_test, output_path);

    expect(result).toBe(output_path);
    expect(existsSync(output_path)).toBe(true);
  });

  it('generates a non-empty answer key PDF (> 1KB)', async () => {
    const output_path = join(TEST_OUTPUT_DIR, 'answer_key.pdf');
    if (!existsSync(output_path)) {
      await generate_answer_key_pdf(sample_test, output_path);
    }
    const stats = statSync(output_path);
    expect(stats.size).toBeGreaterThan(1024);
  });
});

describe('generate_combined_pdf', () => {
  it('creates both test and answer PDFs', async () => {
    const result = await generate_combined_pdf(sample_test, TEST_OUTPUT_DIR, {
      test_filename: 'combined_test.pdf',
      answer_filename: 'combined_answer.pdf',
    });

    expect(result.test_path).toBe(join(TEST_OUTPUT_DIR, 'combined_test.pdf'));
    expect(result.answer_path).toBe(join(TEST_OUTPUT_DIR, 'combined_answer.pdf'));
    expect(existsSync(result.test_path)).toBe(true);
    expect(existsSync(result.answer_path)).toBe(true);
  });

  it('both combined PDFs are non-empty (> 1KB)', async () => {
    const test_path = join(TEST_OUTPUT_DIR, 'combined_test.pdf');
    const answer_path = join(TEST_OUTPUT_DIR, 'combined_answer.pdf');

    if (!existsSync(test_path)) {
      await generate_combined_pdf(sample_test, TEST_OUTPUT_DIR, {
        test_filename: 'combined_test.pdf',
        answer_filename: 'combined_answer.pdf',
      });
    }

    expect(statSync(test_path).size).toBeGreaterThan(1024);
    expect(statSync(answer_path).size).toBeGreaterThan(1024);
  });
});
