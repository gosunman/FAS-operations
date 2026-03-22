#!/usr/bin/env tsx
// CLI tool for generating weekly tests
// Usage: pnpm run academy:test -- --subject physics --chapter "역학"
//
// Required args:
//   --subject    Subject: physics | chemistry | biology | earth_science | integrated_science
//   --chapter    Chapter name (e.g. "역학")
//
// Optional args:
//   --difficulty       Difficulty: regular | ogeum | medical (default: regular)
//   --questions        Number of questions (default: 20)
//   --time             Time limit in minutes (default: 40)
//   --no-explanations  Omit explanations from answer key
//   --format           Output: text | json | pdf (default: text)
//   --output           Output directory for PDF (default: ./output/tests)

import {
  generate_test,
  format_test_sheet,
  format_answer_key,
  validate_test,
  type TestConfig,
  type SubjectArea,
  type DifficultyLevel,
  type GeneratedTest,
} from './test_generator.js';
import { generate_combined_pdf } from './pdf_generator.js';

// === Types ===

export type TestGenCliArgs = {
  subject: SubjectArea;
  chapter: string;
  difficulty: DifficultyLevel;
  num_questions: number;
  time_limit: number;
  include_explanations: boolean;
  format: 'text' | 'json' | 'pdf';
  output_dir: string;
};

// === Constants ===

const VALID_SUBJECTS: SubjectArea[] = ['physics', 'chemistry', 'biology', 'earth_science', 'integrated_science'];
const VALID_DIFFICULTIES: DifficultyLevel[] = ['regular', 'ogeum', 'medical'];

const SUBJECT_NAMES: Record<SubjectArea, string> = {
  physics: '물리학',
  chemistry: '화학',
  biology: '생명과학',
  earth_science: '지구과학',
  integrated_science: '통합과학',
};

// === Argument Parser ===

export const parse_test_gen_args = (argv: string[]): TestGenCliArgs => {
  const get_flag = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    if (index === -1 || index + 1 >= argv.length) return undefined;
    return argv[index + 1];
  };

  const has_flag = (flag: string): boolean => argv.includes(flag);

  const subject_raw = get_flag('--subject');
  const chapter = get_flag('--chapter');

  // Validate required arguments
  if (!subject_raw) throw new Error('Missing required argument: --subject (physics | chemistry | biology | earth_science | integrated_science)');
  if (!chapter) throw new Error('Missing required argument: --chapter (e.g. "역학")');

  if (!VALID_SUBJECTS.includes(subject_raw as SubjectArea)) {
    throw new Error(`Invalid --subject: ${subject_raw}. Must be one of: ${VALID_SUBJECTS.join(', ')}`);
  }

  const difficulty_raw = get_flag('--difficulty') ?? 'regular';
  if (!VALID_DIFFICULTIES.includes(difficulty_raw as DifficultyLevel)) {
    throw new Error(`Invalid --difficulty: ${difficulty_raw}. Must be one of: ${VALID_DIFFICULTIES.join(', ')}`);
  }

  const questions_raw = get_flag('--questions');
  const num_questions = questions_raw ? parseInt(questions_raw, 10) : 20;
  if (isNaN(num_questions) || num_questions < 1 || num_questions > 50) {
    throw new Error(`Invalid --questions: must be a number between 1 and 50`);
  }

  const time_raw = get_flag('--time');
  const time_limit = time_raw ? parseInt(time_raw, 10) : 40;
  if (isNaN(time_limit) || time_limit < 1) {
    throw new Error(`Invalid --time: must be a positive number`);
  }

  const format_raw = get_flag('--format') ?? 'text';
  const valid_formats = ['text', 'json', 'pdf'] as const;
  if (!valid_formats.includes(format_raw as typeof valid_formats[number])) {
    throw new Error(`Invalid --format: ${format_raw}. Must be one of: ${valid_formats.join(', ')}`);
  }

  return {
    subject: subject_raw as SubjectArea,
    chapter,
    difficulty: difficulty_raw as DifficultyLevel,
    num_questions,
    time_limit,
    include_explanations: !has_flag('--no-explanations'),
    format: format_raw as 'text' | 'json' | 'pdf',
    output_dir: get_flag('--output') ?? './output/tests',
  };
};

// === Output Formatter ===

export const format_test_output = (test: GeneratedTest, format: 'text' | 'json' | 'pdf'): string => {
  if (format === 'json') {
    return JSON.stringify(test, null, 2);
  }

  // Text format: test sheet + separator + answer key
  const validation = validate_test(test);
  const status = validation.valid ? 'VALID' : `INVALID (${validation.issues.join(', ')})`;

  const sheet = format_test_sheet(test);
  const answer = format_answer_key(test);

  const meta_lines = [
    '',
    '-'.repeat(60),
    `  Validation: ${status}`,
    `  Questions: ${test.test_sheet.questions.length}`,
    `  Difficulty distribution: ${JSON.stringify(test.metadata.difficulty_distribution)}`,
    `  Topics: ${test.metadata.topic_coverage.join(', ')}`,
    `  Generated: ${test.metadata.generated_at}`,
    '='.repeat(60),
  ];

  return [sheet, '\n', answer, ...meta_lines].join('\n');
};

// === Main (CLI entry point) ===

const main = async () => {
  try {
    // Filter out bare "--" separators from pnpm/tsx argv passthrough
    const argv = process.argv.slice(2).filter(a => a !== '--');

    // Show help if no args or --help flag
    if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
      console.log(`
EIDOS SCIENCE - Test Generator
================================

Usage:
  pnpm run academy:test -- --subject physics --chapter "역학"

Required:
  --subject     Subject: physics | chemistry | biology | earth_science | integrated_science
  --chapter     Chapter name (e.g. "역학")

Optional:
  --difficulty       Difficulty: regular | ogeum | medical (default: regular)
  --questions        Number of questions, 1-50 (default: 20)
  --time             Time limit in minutes (default: 40)
  --no-explanations  Omit explanations from answer key
  --format           Output: text | json | pdf (default: text)
  --output           Output directory for PDF (default: ./output/tests)

Available question banks:
  physics: 역학

Examples:
  pnpm run academy:test -- --subject physics --chapter "역학"
  pnpm run academy:test -- --subject physics --chapter "역학" --difficulty medical --questions 10
  pnpm run academy:test -- --subject physics --chapter "역학" --format pdf --output ./tests
`);
      return;
    }

    const args = parse_test_gen_args(argv);

    // Build test config
    const config: TestConfig = {
      subject: args.subject,
      chapter: args.chapter,
      difficulty: args.difficulty,
      num_questions: args.num_questions,
      time_limit_minutes: args.time_limit,
      include_explanations: args.include_explanations,
    };

    // Generate test
    const test = generate_test(config);

    // Validate
    const validation = validate_test(test);
    if (!validation.valid) {
      console.warn(`Warning: Generated test has issues: ${validation.issues.join(', ')}`);
    }

    // Output based on format
    if (args.format === 'pdf') {
      const subject_name = SUBJECT_NAMES[args.subject];
      const date_str = new Date().toISOString().split('T')[0];
      const { test_path, answer_path } = await generate_combined_pdf(test, args.output_dir, {
        test_filename: `${subject_name}_${args.chapter}_${args.difficulty}_${date_str}.pdf`,
        answer_filename: `${subject_name}_${args.chapter}_${args.difficulty}_${date_str}_answers.pdf`,
      });
      console.log(`Test sheet PDF: ${test_path}`);
      console.log(`Answer key PDF: ${answer_path}`);
    } else {
      const output = format_test_output(test, args.format);
      console.log(output);
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
};

// Run only when executed directly
if (process.argv[1]?.includes('cli_test_generator')) {
  main();
}
