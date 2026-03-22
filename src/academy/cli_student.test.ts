// Tests for student data management CLI module
// Covers: argument parsing, subcommand routing, output formatting

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parse_student_args,
  execute_student_command,
  type StudentCliArgs,
} from './cli_student.js';
import { create_student_data } from './student_data.js';

const TEST_STATE_DIR = path.join(import.meta.dirname, '../../state/cli_student_test_' + process.pid);

// === parse_student_args ===

describe('parse_student_args', () => {
  // --- list subcommand ---
  it('should parse "list" subcommand with no filters', () => {
    const result = parse_student_args(['list']);
    expect(result.command).toBe('list');
  });

  it('should parse "list" subcommand with class filter', () => {
    const result = parse_student_args(['list', '--class-type', '의대반']);
    expect(result.command).toBe('list');
    expect(result.class_type).toBe('의대반');
  });

  it('should parse "list" subcommand with active filter', () => {
    const result = parse_student_args(['list', '--active']);
    expect(result.command).toBe('list');
    expect(result.active).toBe(true);
  });

  // --- add subcommand ---
  it('should parse "add" subcommand with required fields', () => {
    const result = parse_student_args([
      'add',
      '--name', '김민수',
      '--grade', '고2',
      '--class-type', '의대반',
      '--phone', '010-1234-5678',
    ]);

    expect(result.command).toBe('add');
    expect(result.name).toBe('김민수');
    expect(result.grade).toBe('고2');
    expect(result.class_type).toBe('의대반');
    expect(result.phone).toBe('010-1234-5678');
  });

  it('should parse "add" with optional notes', () => {
    const result = parse_student_args([
      'add',
      '--name', '김민수',
      '--grade', '고2',
      '--class-type', '의대반',
      '--phone', '010-1234-5678',
      '--notes', '물리 집중 필요',
    ]);

    expect(result.notes).toBe('물리 집중 필요');
  });

  it('should throw on "add" with missing --name', () => {
    expect(() => parse_student_args([
      'add', '--grade', '고2', '--class-type', '의대반', '--phone', '010-1234-5678',
    ])).toThrow('--name');
  });

  // --- score subcommand ---
  it('should parse "score" subcommand', () => {
    const result = parse_student_args([
      'score',
      '--id', 'abc123',
      '--test-name', '3월 모의고사',
      '--subject', 'physics',
      '--score', '85',
      '--total', '100',
    ]);

    expect(result.command).toBe('score');
    expect(result.id).toBe('abc123');
    expect(result.test_name).toBe('3월 모의고사');
    expect(result.subject).toBe('physics');
    expect(result.score).toBe(85);
    expect(result.total).toBe(100);
  });

  // --- report subcommand ---
  it('should parse "report" subcommand', () => {
    const result = parse_student_args(['report', '--id', 'abc123']);
    expect(result.command).toBe('report');
    expect(result.id).toBe('abc123');
  });

  // --- progress subcommand ---
  it('should parse "progress" subcommand', () => {
    const result = parse_student_args(['progress', '--id', 'abc123']);
    expect(result.command).toBe('progress');
    expect(result.id).toBe('abc123');
  });

  // --- ranking subcommand ---
  it('should parse "ranking" subcommand', () => {
    const result = parse_student_args([
      'ranking',
      '--class-type', '의대반',
      '--test-id', 'test-001',
    ]);

    expect(result.command).toBe('ranking');
    expect(result.class_type).toBe('의대반');
    expect(result.test_id).toBe('test-001');
  });

  // --- unknown subcommand ---
  it('should throw on unknown subcommand', () => {
    expect(() => parse_student_args(['unknown'])).toThrow();
  });

  // --- no subcommand ---
  it('should throw on empty args', () => {
    expect(() => parse_student_args([])).toThrow();
  });
});

// === execute_student_command ===

describe('execute_student_command', () => {
  let store: ReturnType<typeof create_student_data>;

  beforeEach(() => {
    fs.mkdirSync(TEST_STATE_DIR, { recursive: true });
    store = create_student_data({ state_dir: TEST_STATE_DIR });
  });

  afterEach(() => {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  });

  it('should list students', () => {
    // Given: some students exist
    store.add_student({
      name: '김민수', grade: '고2', class_type: '의대반',
      parent_phone: '010-1234-5678', enrolled_at: '2026-03-01', notes: '', active: true,
    });

    // When: executing list command
    const result = execute_student_command(
      { command: 'list' } as StudentCliArgs,
      TEST_STATE_DIR,
    );

    // Then: should contain student name
    expect(result).toContain('김민수');
  });

  it('should add a student and return confirmation', () => {
    const result = execute_student_command(
      {
        command: 'add',
        name: '박서연',
        grade: '고3',
        class_type: '의대반',
        phone: '010-9876-5432',
        notes: '화학 집중',
      } as StudentCliArgs,
      TEST_STATE_DIR,
    );

    expect(result).toContain('박서연');
    expect(result).toContain('추가');

    // Verify persisted
    const students = store.list_students();
    // Re-load store to see the new student (it was added by execute_student_command which created its own store)
    const store2 = create_student_data({ state_dir: TEST_STATE_DIR });
    const all = store2.list_students();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.some(s => s.name === '박서연')).toBe(true);
  });

  it('should record a score', () => {
    // Given: a student exists
    const student = store.add_student({
      name: '김민수', grade: '고2', class_type: '의대반',
      parent_phone: '010-1234-5678', enrolled_at: '2026-03-01', notes: '', active: true,
    });

    // When: recording a score
    const result = execute_student_command(
      {
        command: 'score',
        id: student.id,
        test_name: '3월 모의고사',
        subject: 'physics',
        score: 85,
        total: 100,
        test_date: '2026-03-15',
      } as StudentCliArgs,
      TEST_STATE_DIR,
    );

    // Then: should confirm recording
    expect(result).toContain('85');
    expect(result).toContain('physics');
  });

  it('should generate a student report', () => {
    // Given: a student with scores
    const student = store.add_student({
      name: '이서연', grade: '고3', class_type: '의대반',
      parent_phone: '010-1111-2222', enrolled_at: '2026-01-01', notes: '', active: true,
    });
    store.add_test_score({
      student_id: student.id, test_id: 't1', test_name: '1월 모의',
      test_date: '2026-01-15', subject: 'physics', score: 85, total: 100, notes: '',
    });

    // When: generating report
    const result = execute_student_command(
      { command: 'report', id: student.id } as StudentCliArgs,
      TEST_STATE_DIR,
    );

    // Then: should contain report header
    expect(result).toContain('이서연');
    expect(result).toContain('성적 보고서');
  });

  it('should show student progress', () => {
    // Given: a student with scores
    const student = store.add_student({
      name: '김민수', grade: '고2', class_type: '의대반',
      parent_phone: '010-1234-5678', enrolled_at: '2026-03-01', notes: '', active: true,
    });
    store.add_test_score({
      student_id: student.id, test_id: 't1', test_name: '1월',
      test_date: '2026-01-15', subject: 'physics', score: 70, total: 100, notes: '',
    });
    store.add_test_score({
      student_id: student.id, test_id: 't2', test_name: '2월',
      test_date: '2026-02-15', subject: 'physics', score: 80, total: 100, notes: '',
    });

    // When: getting progress
    const result = execute_student_command(
      { command: 'progress', id: student.id } as StudentCliArgs,
      TEST_STATE_DIR,
    );

    // Then: should contain progress info
    expect(result).toContain('김민수');
    expect(result).toContain('Average');
  });

  it('should show class rankings', () => {
    // Given: students with scores
    const s1 = store.add_student({
      name: '학생A', grade: '고2', class_type: '의대반',
      parent_phone: '010-0000-0001', enrolled_at: '2026-01-01', notes: '', active: true,
    });
    const s2 = store.add_student({
      name: '학생B', grade: '고2', class_type: '의대반',
      parent_phone: '010-0000-0002', enrolled_at: '2026-01-01', notes: '', active: true,
    });
    store.add_test_score({
      student_id: s1.id, test_id: 'rank-test', test_name: '3월',
      test_date: '2026-03-15', subject: 'physics', score: 90, total: 100, notes: '',
    });
    store.add_test_score({
      student_id: s2.id, test_id: 'rank-test', test_name: '3월',
      test_date: '2026-03-15', subject: 'physics', score: 80, total: 100, notes: '',
    });

    // When: getting rankings
    const result = execute_student_command(
      { command: 'ranking', class_type: '의대반', test_id: 'rank-test' } as StudentCliArgs,
      TEST_STATE_DIR,
    );

    // Then: should contain ranking info
    expect(result).toContain('학생A');
    expect(result).toContain('학생B');
    expect(result).toContain('1');
  });

  it('should return error message for score with non-existent student', () => {
    const result = execute_student_command(
      {
        command: 'score',
        id: 'non-existent',
        test_name: 'test',
        subject: 'physics',
        score: 85,
        total: 100,
      } as StudentCliArgs,
      TEST_STATE_DIR,
    );

    expect(result).toContain('not found');
  });
});
