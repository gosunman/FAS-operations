// Tests for test generator CLI module
// Covers: argument parsing, test generation with output formats

import { describe, it, expect } from 'vitest';
import {
  parse_test_gen_args,
  format_test_output,
  type TestGenCliArgs,
} from './cli_test_generator.js';
import { generate_test, type GeneratedTest } from './test_generator.js';

// === parse_test_gen_args ===

describe('parse_test_gen_args', () => {
  it('should parse minimal required arguments', () => {
    // Given: minimal args
    const argv = ['--subject', 'physics', '--chapter', '역학'];

    // When: parsing
    const result = parse_test_gen_args(argv);

    // Then: should return parsed args
    expect(result.subject).toBe('physics');
    expect(result.chapter).toBe('역학');
  });

  it('should parse all optional arguments', () => {
    const argv = [
      '--subject', 'physics',
      '--chapter', '역학',
      '--difficulty', 'medical',
      '--questions', '10',
      '--time', '30',
      '--no-explanations',
      '--format', 'pdf',
      '--output', './output',
    ];

    const result = parse_test_gen_args(argv);
    expect(result.subject).toBe('physics');
    expect(result.chapter).toBe('역학');
    expect(result.difficulty).toBe('medical');
    expect(result.num_questions).toBe(10);
    expect(result.time_limit).toBe(30);
    expect(result.include_explanations).toBe(false);
    expect(result.format).toBe('pdf');
    expect(result.output_dir).toBe('./output');
  });

  it('should default difficulty to regular', () => {
    const argv = ['--subject', 'physics', '--chapter', '역학'];
    const result = parse_test_gen_args(argv);
    expect(result.difficulty).toBe('regular');
  });

  it('should default num_questions to 20', () => {
    const argv = ['--subject', 'physics', '--chapter', '역학'];
    const result = parse_test_gen_args(argv);
    expect(result.num_questions).toBe(20);
  });

  it('should default time_limit to 40', () => {
    const argv = ['--subject', 'physics', '--chapter', '역학'];
    const result = parse_test_gen_args(argv);
    expect(result.time_limit).toBe(40);
  });

  it('should default format to text', () => {
    const argv = ['--subject', 'physics', '--chapter', '역학'];
    const result = parse_test_gen_args(argv);
    expect(result.format).toBe('text');
  });

  it('should default include_explanations to true', () => {
    const argv = ['--subject', 'physics', '--chapter', '역학'];
    const result = parse_test_gen_args(argv);
    expect(result.include_explanations).toBe(true);
  });

  it('should throw on missing --subject', () => {
    const argv = ['--chapter', '역학'];
    expect(() => parse_test_gen_args(argv)).toThrow('--subject');
  });

  it('should throw on missing --chapter', () => {
    const argv = ['--subject', 'physics'];
    expect(() => parse_test_gen_args(argv)).toThrow('--chapter');
  });

  it('should throw on invalid --subject', () => {
    const argv = ['--subject', 'math', '--chapter', '역학'];
    expect(() => parse_test_gen_args(argv)).toThrow('--subject');
  });

  it('should throw on invalid --difficulty', () => {
    const argv = ['--subject', 'physics', '--chapter', '역학', '--difficulty', 'extreme'];
    expect(() => parse_test_gen_args(argv)).toThrow('--difficulty');
  });

  it('should accept all valid subjects', () => {
    const subjects = ['physics', 'chemistry', 'biology', 'earth_science', 'integrated_science'];
    for (const subject of subjects) {
      const result = parse_test_gen_args(['--subject', subject, '--chapter', '역학']);
      expect(result.subject).toBe(subject);
    }
  });
});

// === format_test_output ===

describe('format_test_output', () => {
  // Helper: minimal generated test for formatting
  const make_test_result = (): GeneratedTest => {
    return generate_test({
      subject: 'physics' as const,
      chapter: '역학',
      difficulty: 'regular' as const,
      num_questions: 3,
      time_limit_minutes: 20,
      include_explanations: true,
    });
  };

  it('should format as text with both test sheet and answer key', () => {
    const test = make_test_result();
    const output = format_test_output(test, 'text');

    expect(output).toContain('EIDOS SCIENCE');
    expect(output).toContain('정답');
  });

  it('should format as json with all fields', () => {
    const test = make_test_result();
    const output = format_test_output(test, 'json');

    const parsed = JSON.parse(output);
    expect(parsed.test_sheet).toBeDefined();
    expect(parsed.answer_key).toBeDefined();
    expect(parsed.metadata).toBeDefined();
  });

  it('should include validation status in text format', () => {
    const test = make_test_result();
    const output = format_test_output(test, 'text');

    // Should contain validation result
    expect(output).toContain('VALID');
  });
});
