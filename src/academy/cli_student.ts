#!/usr/bin/env tsx
// CLI tool for student data management
// Usage: pnpm run academy:student -- <command> [options]
//
// Subcommands:
//   list     List all students (with optional filters)
//   add      Add a new student
//   score    Record a test score
//   report   Generate a student report (markdown)
//   progress View a student's progress summary
//   ranking  View class rankings for a specific test

import * as path from 'node:path';
import { create_student_data, type Student, type StudentProgress, type ClassRankingEntry } from './student_data.js';

// === Types ===

export type StudentCliArgs = {
  command: 'list' | 'add' | 'score' | 'report' | 'progress' | 'ranking';
  // list filters
  class_type?: string;
  active?: boolean;
  // add fields
  name?: string;
  grade?: string;
  phone?: string;
  notes?: string;
  // score fields
  id?: string;
  test_name?: string;
  test_id?: string;
  test_date?: string;
  subject?: string;
  score?: number;
  total?: number;
  // format
  format?: 'text' | 'json';
};

// === Constants ===

const VALID_COMMANDS = ['list', 'add', 'score', 'report', 'progress', 'ranking'] as const;
const DEFAULT_STATE_DIR = path.join(process.cwd(), 'state', 'academy');

// === Argument Parser ===

export const parse_student_args = (argv: string[]): StudentCliArgs => {
  if (argv.length === 0) {
    throw new Error(`No subcommand provided. Available commands: ${VALID_COMMANDS.join(', ')}`);
  }

  const command = argv[0];
  if (!VALID_COMMANDS.includes(command as typeof VALID_COMMANDS[number])) {
    throw new Error(`Unknown command: "${command}". Available commands: ${VALID_COMMANDS.join(', ')}`);
  }

  const rest = argv.slice(1);

  const get_flag = (flag: string): string | undefined => {
    const index = rest.indexOf(flag);
    if (index === -1 || index + 1 >= rest.length) return undefined;
    return rest[index + 1];
  };

  const has_flag = (flag: string): boolean => rest.includes(flag);

  const base: StudentCliArgs = {
    command: command as StudentCliArgs['command'],
    format: (get_flag('--format') ?? 'text') as 'text' | 'json',
  };

  switch (command) {
    case 'list':
      return {
        ...base,
        class_type: get_flag('--class-type'),
        active: has_flag('--active') ? true : undefined,
      };

    case 'add': {
      const name = get_flag('--name');
      const grade = get_flag('--grade');
      const class_type = get_flag('--class-type');
      const phone = get_flag('--phone');

      if (!name) throw new Error('Missing required argument: --name');
      if (!grade) throw new Error('Missing required argument: --grade');
      if (!class_type) throw new Error('Missing required argument: --class-type');
      if (!phone) throw new Error('Missing required argument: --phone');

      return {
        ...base,
        name,
        grade,
        class_type,
        phone,
        notes: get_flag('--notes') ?? '',
      };
    }

    case 'score': {
      const id = get_flag('--id');
      const test_name = get_flag('--test-name');
      const subject = get_flag('--subject');
      const score_raw = get_flag('--score');
      const total_raw = get_flag('--total');

      if (!id) throw new Error('Missing required argument: --id (student ID)');
      if (!test_name) throw new Error('Missing required argument: --test-name');
      if (!subject) throw new Error('Missing required argument: --subject');
      if (!score_raw) throw new Error('Missing required argument: --score');
      if (!total_raw) throw new Error('Missing required argument: --total');

      return {
        ...base,
        id,
        test_name,
        test_id: get_flag('--test-id') ?? `test-${Date.now()}`,
        test_date: get_flag('--test-date') ?? new Date().toISOString().split('T')[0],
        subject,
        score: parseInt(score_raw, 10),
        total: parseInt(total_raw, 10),
      };
    }

    case 'report':
    case 'progress': {
      const id = get_flag('--id');
      if (!id) throw new Error('Missing required argument: --id (student ID)');
      return { ...base, id };
    }

    case 'ranking': {
      const class_type = get_flag('--class-type');
      const test_id = get_flag('--test-id');
      if (!class_type) throw new Error('Missing required argument: --class-type');
      if (!test_id) throw new Error('Missing required argument: --test-id');
      return { ...base, class_type, test_id };
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
};

// === Command Executor ===

export const execute_student_command = (
  args: StudentCliArgs,
  state_dir: string = DEFAULT_STATE_DIR,
): string => {
  const store = create_student_data({ state_dir });

  switch (args.command) {
    case 'list': {
      const filter = {
        class_type: args.class_type,
        active: args.active,
      };
      const students = store.list_students(
        Object.values(filter).some(v => v !== undefined) ? filter : undefined,
      );

      if (args.format === 'json') {
        return JSON.stringify(students, null, 2);
      }

      if (students.length === 0) {
        return 'No students found.';
      }

      const lines: string[] = [
        '='.repeat(70),
        '  EIDOS SCIENCE - Student List',
        '='.repeat(70),
        '',
        format_student_table(students),
        '',
        `-  Total: ${students.length} students`,
        '='.repeat(70),
      ];
      return lines.join('\n');
    }

    case 'add': {
      const student = store.add_student({
        name: args.name!,
        grade: args.grade!,
        class_type: args.class_type!,
        parent_phone: args.phone!,
        enrolled_at: new Date().toISOString().split('T')[0],
        notes: args.notes ?? '',
        active: true,
      });

      if (args.format === 'json') {
        return JSON.stringify(student, null, 2);
      }

      return [
        `학생 추가 완료: ${student.name} (ID: ${student.id})`,
        `  Grade: ${student.grade}`,
        `  Class: ${student.class_type}`,
        `  Phone: ${student.parent_phone}`,
        student.notes ? `  Notes: ${student.notes}` : '',
      ].filter(Boolean).join('\n');
    }

    case 'score': {
      try {
        const score = store.add_test_score({
          student_id: args.id!,
          test_id: args.test_id!,
          test_name: args.test_name!,
          test_date: args.test_date!,
          subject: args.subject!,
          score: args.score!,
          total: args.total!,
          notes: '',
        });

        if (args.format === 'json') {
          return JSON.stringify(score, null, 2);
        }

        return [
          `Score recorded:`,
          `  Student: ${args.id}`,
          `  Test: ${score.test_name} (${score.subject})`,
          `  Score: ${score.score}/${score.total} (percentile: ${score.percentile ?? '-'})`,
          `  Date: ${score.test_date}`,
        ].join('\n');
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          return `Error: Student not found (ID: ${args.id})`;
        }
        throw error;
      }
    }

    case 'report': {
      try {
        const report = store.generate_student_report(args.id!);
        return report;
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          return `Error: Student not found (ID: ${args.id})`;
        }
        throw error;
      }
    }

    case 'progress': {
      try {
        const progress = store.get_student_progress(args.id!);

        if (args.format === 'json') {
          return JSON.stringify(progress, null, 2);
        }

        return format_progress(progress);
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          return `Error: Student not found (ID: ${args.id})`;
        }
        throw error;
      }
    }

    case 'ranking': {
      const rankings = store.get_class_rankings(args.class_type!, args.test_id!);

      if (args.format === 'json') {
        return JSON.stringify(rankings, null, 2);
      }

      return format_rankings(rankings, args.class_type!, args.test_id!);
    }

    default:
      throw new Error(`Unknown command: ${args.command}`);
  }
};

// === Formatters ===

const format_student_table = (students: Student[]): string => {
  const header = '  #  | Name             | Grade | Class      | Phone           | Active';
  const separator = '  ' + '-'.repeat(header.length - 2);
  const rows = students.map((s, i) => {
    const num = String(i + 1).padStart(3);
    const name = s.name.padEnd(16);
    const grade = s.grade.padEnd(5);
    const cls = s.class_type.padEnd(10);
    const phone = s.parent_phone.padEnd(15);
    const active = s.active ? 'Y' : 'N';
    return `  ${num} | ${name} | ${grade} | ${cls} | ${phone} | ${active}`;
  });

  return [header, separator, ...rows].join('\n');
};

const TREND_LABELS: Record<string, string> = {
  improving: 'Improving',
  declining: 'Declining',
  stable: 'Stable',
};

const format_progress = (progress: StudentProgress): string => {
  const { student, scores, average_score, trend, last_test_date } = progress;
  const lines: string[] = [
    '='.repeat(60),
    `  ${student.name} - Progress Summary`,
    '='.repeat(60),
    '',
    `  Grade: ${student.grade}`,
    `  Class: ${student.class_type}`,
    `  Average: ${average_score}%`,
    `  Trend: ${TREND_LABELS[trend] ?? trend}`,
    `  Last test: ${last_test_date ?? 'N/A'}`,
    `  Total tests: ${scores.length}`,
    '',
  ];

  if (scores.length > 0) {
    lines.push('  Recent scores:');
    const recent = scores.slice(-5);
    for (const s of recent) {
      lines.push(`    ${s.test_date} | ${s.test_name} (${s.subject}): ${s.score}/${s.total}`);
    }
  }

  lines.push('='.repeat(60));
  return lines.join('\n');
};

const format_rankings = (
  rankings: ClassRankingEntry[],
  class_type: string,
  test_id: string,
): string => {
  if (rankings.length === 0) {
    return `No rankings found for class "${class_type}", test "${test_id}".`;
  }

  const lines: string[] = [
    '='.repeat(60),
    `  ${class_type} - Rankings (Test: ${test_id})`,
    '='.repeat(60),
    '',
    '  Rank | Name             | Score      | Percentile',
    '  ' + '-'.repeat(54),
  ];

  for (const entry of rankings) {
    const rank = String(entry.rank).padStart(4);
    const name = entry.student.name.padEnd(16);
    const score = `${entry.score.score}/${entry.score.total}`.padEnd(10);
    const pct = entry.score.percentile !== null ? `${entry.score.percentile}%` : '-';
    lines.push(`  ${rank} | ${name} | ${score} | ${pct}`);
  }

  lines.push('');
  lines.push(`  Total: ${rankings.length} students`);
  lines.push('='.repeat(60));
  return lines.join('\n');
};

// === Main (CLI entry point) ===

const main = () => {
  try {
    // Filter out bare "--" separators from pnpm/tsx argv passthrough
    const argv = process.argv.slice(2).filter(a => a !== '--');

    if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
      console.log(`
EIDOS SCIENCE - Student Data Manager
======================================

Usage:
  pnpm run academy:student -- <command> [options]

Commands:
  list        List all students
  add         Add a new student
  score       Record a test score
  report      Generate student report (markdown)
  progress    View student progress summary
  ranking     View class rankings for a test

List options:
  --class-type  Filter by class type (e.g. "의대반")
  --active      Only show active students

Add options (all required):
  --name        Student name
  --grade       Grade (e.g. "고2")
  --class-type  Class type (e.g. "의대반", "일반반")
  --phone       Parent phone number
  --notes       Optional notes

Score options:
  --id          Student ID (required)
  --test-name   Test name (required, e.g. "3월 모의고사")
  --subject     Subject (required, e.g. "physics")
  --score       Score (required, e.g. 85)
  --total       Total points (required, e.g. 100)
  --test-id     Test ID (optional, auto-generated)
  --test-date   Test date (optional, default: today)

Report/Progress options:
  --id          Student ID (required)

Ranking options:
  --class-type  Class type (required)
  --test-id     Test ID (required)

Global options:
  --format      Output format: text | json (default: text)

Examples:
  pnpm run academy:student -- list
  pnpm run academy:student -- list --class-type "의대반" --active
  pnpm run academy:student -- add --name "김민수" --grade "고2" --class-type "의대반" --phone "010-1234-5678"
  pnpm run academy:student -- score --id "abc123" --test-name "3월 모의" --subject physics --score 85 --total 100
  pnpm run academy:student -- report --id "abc123"
  pnpm run academy:student -- progress --id "abc123"
  pnpm run academy:student -- ranking --class-type "의대반" --test-id "test-001"
`);
      return;
    }

    const args = parse_student_args(argv);
    const output = execute_student_command(args);
    console.log(output);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
};

// Run only when executed directly
if (process.argv[1]?.includes('cli_student')) {
  main();
}
