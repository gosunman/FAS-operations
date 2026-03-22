#!/usr/bin/env tsx
// CLI tool for generating parent messages
// Usage: pnpm run academy:text -- --name "김민수" --grade "고1" --topics "이차함수,판별식"
//
// Required args:
//   --name       Student name
//   --grade      Grade (e.g. "고1", "고2", "중3")
//   --topics     Comma-separated list of topics covered
//
// Optional args:
//   --class-type  Class type: regular | ogeum | medical (default: regular)
//   --performance Comma-separated performance keywords
//   --homework    Homework description
//   --next-class  Next class note
//   --date        Class date (YYYY-MM-DD, default: today)
//   --tone        Message tone: caring | professional | enthusiastic (default: caring)
//   --format      Output format: text | json (default: text)

import {
  generate_parent_message,
  validate_message,
  type StudentContext,
  type ClassKeywords,
  type ToneConfig,
  type ParentMessage,
} from './parent_message.js';

// === Types ===

export type ParentMessageCliArgs = {
  name: string;
  grade: string;
  class_type: 'regular' | 'ogeum' | 'medical';
  topics: string[];
  performance?: string[];
  homework?: string;
  next_class?: string;
  date: string;
  tone: 'caring' | 'professional' | 'enthusiastic';
  format?: 'text' | 'json';
};

// === Argument Parser ===

// Parse CLI argv array into structured args
export const parse_parent_message_args = (argv: string[]): ParentMessageCliArgs => {
  const get_flag = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    if (index === -1 || index + 1 >= argv.length) return undefined;
    return argv[index + 1];
  };

  const name = get_flag('--name');
  const grade = get_flag('--grade');
  const topics_raw = get_flag('--topics');

  // Validate required arguments
  if (!name) throw new Error('Missing required argument: --name (student name)');
  if (!grade) throw new Error('Missing required argument: --grade (e.g. "고1", "중3")');
  if (!topics_raw) throw new Error('Missing required argument: --topics (comma-separated topics)');

  const class_type_raw = get_flag('--class-type') ?? 'regular';
  const valid_class_types = ['regular', 'ogeum', 'medical'] as const;
  if (!valid_class_types.includes(class_type_raw as typeof valid_class_types[number])) {
    throw new Error(`Invalid --class-type: ${class_type_raw}. Must be one of: ${valid_class_types.join(', ')}`);
  }

  const tone_raw = get_flag('--tone') ?? 'caring';
  const valid_tones = ['caring', 'professional', 'enthusiastic'] as const;
  if (!valid_tones.includes(tone_raw as typeof valid_tones[number])) {
    throw new Error(`Invalid --tone: ${tone_raw}. Must be one of: ${valid_tones.join(', ')}`);
  }

  const format_raw = get_flag('--format') ?? 'text';
  const valid_formats = ['text', 'json'] as const;
  if (!valid_formats.includes(format_raw as typeof valid_formats[number])) {
    throw new Error(`Invalid --format: ${format_raw}. Must be one of: ${valid_formats.join(', ')}`);
  }

  const performance_raw = get_flag('--performance');
  const today = new Date().toISOString().split('T')[0];

  return {
    name,
    grade,
    class_type: class_type_raw as 'regular' | 'ogeum' | 'medical',
    topics: topics_raw.split(',').map(t => t.trim()).filter(t => t.length > 0),
    performance: performance_raw
      ? performance_raw.split(',').map(p => p.trim()).filter(p => p.length > 0)
      : undefined,
    homework: get_flag('--homework'),
    next_class: get_flag('--next-class'),
    date: get_flag('--date') ?? today,
    tone: tone_raw as 'caring' | 'professional' | 'enthusiastic',
    format: format_raw as 'text' | 'json',
  };
};

// === Context Builder ===

// Build StudentContext and ClassKeywords from parsed CLI args
export const build_student_context_from_args = (args: ParentMessageCliArgs): {
  student: StudentContext;
  keywords: ClassKeywords;
  tone: ToneConfig;
} => {
  const student: StudentContext = {
    name: args.name,
    grade: args.grade,
    class_type: args.class_type,
    subjects: [], // not needed for message generation
  };

  const keywords: ClassKeywords = {
    date: args.date,
    topics_covered: args.topics,
    performance_keywords: args.performance ?? [],
    homework: args.homework,
    next_class_note: args.next_class,
  };

  const tone: ToneConfig = {
    formality: 'formal',
    warmth: args.tone,
    language: 'ko',
  };

  return { student, keywords, tone };
};

// === Output Formatter ===

// Format the generated message for display
export const format_output = (message: ParentMessage, format: 'text' | 'json'): string => {
  if (format === 'json') {
    return JSON.stringify(message, null, 2);
  }

  // Text format with header and footer
  const validation = validate_message(message);
  const status = validation.valid ? 'VALID' : `INVALID (${validation.issues.join(', ')})`;

  const lines: string[] = [
    '=' .repeat(60),
    '  EIDOS SCIENCE - Parent Message Generator',
    '='.repeat(60),
    '',
    message.full_text,
    '',
    '-'.repeat(60),
    `  Status: ${status}`,
    `  \uAE00\uC790\uC218: ${message.char_count}\uC790`,
    '='.repeat(60),
  ];

  return lines.join('\n');
};

// === Main (CLI entry point) ===

const main = () => {
  try {
    // Parse arguments (skip node and script path, filter pnpm "--" separator)
    const argv = process.argv.slice(2).filter(a => a !== '--');

    // Show help if no args or --help flag
    if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
      console.log(`
EIDOS SCIENCE - Parent Message Generator
=========================================

Usage:
  pnpm run academy:text -- --name "name" --grade "grade" --topics "topic1,topic2"

Required:
  --name        Student name (e.g. "김민수")
  --grade       Grade (e.g. "고1", "고2", "중3")
  --topics      Comma-separated topics (e.g. "이차함수,판별식")

Optional:
  --class-type  Class type: regular | ogeum | medical (default: regular)
  --performance Comma-separated keywords (e.g. "집중력 좋음,질문 많이 함")
  --homework    Homework description (e.g. "교재 p.52~54")
  --next-class  Next class note (e.g. "다음 시간 단원평가")
  --date        Class date YYYY-MM-DD (default: today)
  --tone        Tone: caring | professional | enthusiastic (default: caring)
  --format      Output: text | json (default: text)

Examples:
  pnpm run academy:text -- --name "김민수" --grade "고1" --topics "이차함수,판별식" --performance "집중력 좋음" --homework "교재 p.52~54"
  pnpm run academy:text -- --name "박서연" --grade "고2" --class-type medical --topics "뉴턴 법칙,운동량" --tone enthusiastic
`);
      return;
    }

    const args = parse_parent_message_args(argv);
    const { student, keywords, tone } = build_student_context_from_args(args);

    // Generate message
    const message = generate_parent_message(student, keywords, tone);

    // Format and output
    const output = format_output(message, args.format ?? 'text');
    console.log(output);

    // Copy-friendly: output just the text for easy copy-paste
    if (args.format !== 'json') {
      console.log('\n--- Copy below this line ---\n');
      console.log(message.full_text);
      console.log('\n--- End ---');
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
};

// Run only when executed directly (not imported)
if (process.argv[1]?.includes('cli_parent_message')) {
  main();
}
