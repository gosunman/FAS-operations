// Tests for student data management module
// Covers: CRUD, scoring with auto-percentile, progress tracking,
// markdown report generation, and class rankings.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  create_student_data,
  type Student,
  type TestScore,
  type StudentProgress,
  type StudentFilter,
  type ClassRankingEntry,
} from './student_data.js';

const TEST_STATE_DIR = path.join(import.meta.dirname, '../../state/student_data_test_' + process.pid);

let store: ReturnType<typeof create_student_data>;

// Helper factory for creating test students
const make_student = (overrides: Partial<Omit<Student, 'id'>> = {}): Omit<Student, 'id'> => ({
  name: '김민수',
  grade: '고2',
  class_type: '의대반',
  parent_phone: '010-1234-5678',
  enrolled_at: '2026-03-01',
  notes: '',
  active: true,
  ...overrides,
});

// Helper factory for creating test scores
const make_score = (
  student_id: string,
  overrides: Partial<Omit<TestScore, 'percentile'>> = {},
): Omit<TestScore, 'percentile'> => ({
  student_id,
  test_id: 'test-001',
  test_name: '3월 월간 테스트',
  test_date: '2026-03-15',
  subject: 'physics',
  score: 85,
  total: 100,
  notes: '',
  ...overrides,
});

beforeEach(() => {
  fs.mkdirSync(TEST_STATE_DIR, { recursive: true });
  store = create_student_data({ state_dir: TEST_STATE_DIR });
});

afterEach(() => {
  fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
});

// === add_student ===

describe('add_student', () => {
  it('should create a student with a generated UUID', () => {
    // Given: student data without an ID
    const data = make_student();

    // When: adding the student
    const result = store.add_student(data);

    // Then: should return a student with an auto-generated ID
    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
    expect(result.name).toBe('김민수');
    expect(result.grade).toBe('고2');
    expect(result.class_type).toBe('의대반');
    expect(result.parent_phone).toBe('010-1234-5678');
    expect(result.active).toBe(true);
  });

  it('should generate unique IDs for different students', () => {
    // Given/When: creating two students
    const s1 = store.add_student(make_student({ name: '학생A' }));
    const s2 = store.add_student(make_student({ name: '학생B' }));

    // Then: IDs should be different
    expect(s1.id).not.toBe(s2.id);
  });

  it('should persist student data to disk', () => {
    // Given: a student is created
    const created = store.add_student(make_student());

    // When: re-creating the store from the same directory
    const store2 = create_student_data({ state_dir: TEST_STATE_DIR });
    const fetched = store2.get_student(created.id);

    // Then: the student should be retrievable
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('김민수');
  });

  it('should store all fields including notes', () => {
    // Given/When: creating a student with notes
    const result = store.add_student(make_student({
      notes: '의대 목표, 물리 집중 필요',
    }));

    // Then: notes should be preserved
    expect(result.notes).toBe('의대 목표, 물리 집중 필요');
  });
});

// === get_student ===

describe('get_student', () => {
  it('should retrieve an existing student by ID', () => {
    // Given: a student exists
    const created = store.add_student(make_student());

    // When: getting by ID
    const fetched = store.get_student(created.id);

    // Then: should return the matching student
    expect(fetched).toEqual(created);
  });

  it('should return null for a non-existent ID', () => {
    // Given: no students exist
    // When: querying a fake ID
    const result = store.get_student('non-existent-id');

    // Then: should be null
    expect(result).toBeNull();
  });
});

// === list_students ===

describe('list_students', () => {
  beforeEach(() => {
    store.add_student(make_student({ name: '학생A', class_type: '의대반', active: true }));
    store.add_student(make_student({ name: '학생B', class_type: '의대반', active: true }));
    store.add_student(make_student({ name: '학생C', class_type: '일반반', active: true }));
    store.add_student(make_student({ name: '학생D', class_type: '의대반', active: false }));
  });

  it('should return all students without a filter', () => {
    // Given/When: listing without filter
    const all = store.list_students();

    // Then: should return all 4 students
    expect(all).toHaveLength(4);
  });

  it('should filter by class_type', () => {
    // Given/When: filtering by 의대반
    const result = store.list_students({ class_type: '의대반' });

    // Then: should return 3 students
    expect(result).toHaveLength(3);
    expect(result.every(s => s.class_type === '의대반')).toBe(true);
  });

  it('should filter by active status', () => {
    // Given/When: filtering active only
    const result = store.list_students({ active: true });

    // Then: should return 3 active students
    expect(result).toHaveLength(3);
    expect(result.every(s => s.active === true)).toBe(true);
  });

  it('should combine class_type and active filters', () => {
    // Given/When: filtering by both
    const result = store.list_students({ class_type: '의대반', active: true });

    // Then: should return only active 의대반 students
    expect(result).toHaveLength(2);
    expect(result.every(s => s.class_type === '의대반' && s.active)).toBe(true);
  });

  it('should return empty array when no students match', () => {
    // Given/When: filtering with no match
    const result = store.list_students({ class_type: '오금고반' });

    // Then: should be empty
    expect(result).toHaveLength(0);
  });
});

// === update_student ===

describe('update_student', () => {
  it('should partially update student fields', () => {
    // Given: a student exists
    const created = store.add_student(make_student());

    // When: updating grade and notes
    const updated = store.update_student(created.id, {
      grade: '고3',
      notes: '성적 향상',
    });

    // Then: updated fields should reflect, others unchanged
    expect(updated.grade).toBe('고3');
    expect(updated.notes).toBe('성적 향상');
    expect(updated.name).toBe('김민수');
    expect(updated.class_type).toBe('의대반');
    expect(updated.id).toBe(created.id);
  });

  it('should throw for a non-existent student', () => {
    // Given: no such student
    // When/Then: should throw
    expect(() => store.update_student('no-such-id', { grade: '고1' }))
      .toThrow('Student not found');
  });

  it('should persist updates to disk', () => {
    // Given: a student exists
    const created = store.add_student(make_student());
    store.update_student(created.id, { notes: '최근 성적 좋아짐' });

    // When: re-loading from disk
    const store2 = create_student_data({ state_dir: TEST_STATE_DIR });
    const fetched = store2.get_student(created.id);

    // Then: update should be persisted
    expect(fetched!.notes).toBe('최근 성적 좋아짐');
  });

  it('should allow deactivating a student', () => {
    // Given: an active student
    const created = store.add_student(make_student());

    // When: deactivating
    const updated = store.update_student(created.id, { active: false });

    // Then: should be inactive
    expect(updated.active).toBe(false);
  });
});

// === add_test_score ===

describe('add_test_score', () => {
  let student_id: string;

  beforeEach(() => {
    const s = store.add_student(make_student());
    student_id = s.id;
  });

  it('should record a score and auto-calculate percentile', () => {
    // Given: a student
    // When: adding a test score
    const score = store.add_test_score(make_score(student_id));

    // Then: should return a complete score entry with percentile
    expect(score.student_id).toBe(student_id);
    expect(score.test_id).toBe('test-001');
    expect(score.score).toBe(85);
    expect(score.total).toBe(100);
    expect(score.percentile).toBeDefined();
    expect(typeof score.percentile).toBe('number');
  });

  it('should throw for a non-existent student', () => {
    // Given/When/Then: should throw
    expect(() => store.add_test_score(make_score('no-such-id')))
      .toThrow('Student not found');
  });

  it('should persist scores to disk', () => {
    // Given: a score is recorded
    store.add_test_score(make_score(student_id));

    // When: re-loading from disk
    const store2 = create_student_data({ state_dir: TEST_STATE_DIR });
    const progress = store2.get_student_progress(student_id);

    // Then: the score should be persisted
    expect(progress.scores).toHaveLength(1);
    expect(progress.scores[0].score).toBe(85);
  });

  it('should calculate percentile relative to same class students on same test', () => {
    // Given: 3 students in the same class
    const s2 = store.add_student(make_student({ name: '학생B' }));
    const s3 = store.add_student(make_student({ name: '학생C' }));

    // When: adding scores for the same test
    store.add_test_score(make_score(student_id, { score: 60, total: 100, test_id: 'test-002' }));
    store.add_test_score(make_score(s2.id, { score: 80, total: 100, test_id: 'test-002' }));
    const top_score = store.add_test_score(make_score(s3.id, { score: 95, total: 100, test_id: 'test-002' }));

    // Then: the highest score should have a high percentile
    expect(top_score.percentile).toBeGreaterThanOrEqual(50);
  });

  it('should give 100 percentile when only one score exists', () => {
    // Given/When: single score for a test
    const score = store.add_test_score(make_score(student_id, { test_id: 'solo-test' }));

    // Then: should be 100th percentile
    expect(score.percentile).toBe(100);
  });
});

// === get_student_progress ===

describe('get_student_progress', () => {
  let student_id: string;

  beforeEach(() => {
    const s = store.add_student(make_student());
    student_id = s.id;
  });

  it('should return empty progress for student with no scores', () => {
    // Given: a student with no scores
    // When: getting progress
    const progress = store.get_student_progress(student_id);

    // Then: should have empty scores and default values
    expect(progress.student.name).toBe('김민수');
    expect(progress.scores).toHaveLength(0);
    expect(progress.average_score).toBe(0);
    expect(progress.trend).toBe('stable');
    expect(progress.last_test_date).toBeNull();
  });

  it('should throw for a non-existent student', () => {
    // Given/When/Then: should throw
    expect(() => store.get_student_progress('no-such-id'))
      .toThrow('Student not found');
  });

  it('should calculate average score correctly', () => {
    // Given: multiple test scores
    store.add_test_score(make_score(student_id, { score: 70, total: 100, test_id: 't1', test_date: '2026-01-15' }));
    store.add_test_score(make_score(student_id, { score: 80, total: 100, test_id: 't2', test_date: '2026-02-15' }));
    store.add_test_score(make_score(student_id, { score: 90, total: 100, test_id: 't3', test_date: '2026-03-15' }));

    // When: getting progress
    const progress = store.get_student_progress(student_id);

    // Then: average should be 80
    expect(progress.average_score).toBe(80);
  });

  it('should detect improving trend', () => {
    // Given: steadily improving scores
    store.add_test_score(make_score(student_id, { score: 60, total: 100, test_id: 't1', test_date: '2026-01-15' }));
    store.add_test_score(make_score(student_id, { score: 70, total: 100, test_id: 't2', test_date: '2026-02-15' }));
    store.add_test_score(make_score(student_id, { score: 80, total: 100, test_id: 't3', test_date: '2026-03-15' }));

    // When: getting progress
    const progress = store.get_student_progress(student_id);

    // Then: trend should be improving
    expect(progress.trend).toBe('improving');
  });

  it('should detect declining trend', () => {
    // Given: steadily declining scores
    store.add_test_score(make_score(student_id, { score: 90, total: 100, test_id: 't1', test_date: '2026-01-15' }));
    store.add_test_score(make_score(student_id, { score: 75, total: 100, test_id: 't2', test_date: '2026-02-15' }));
    store.add_test_score(make_score(student_id, { score: 60, total: 100, test_id: 't3', test_date: '2026-03-15' }));

    // When: getting progress
    const progress = store.get_student_progress(student_id);

    // Then: trend should be declining
    expect(progress.trend).toBe('declining');
  });

  it('should detect stable trend', () => {
    // Given: relatively stable scores
    store.add_test_score(make_score(student_id, { score: 75, total: 100, test_id: 't1', test_date: '2026-01-15' }));
    store.add_test_score(make_score(student_id, { score: 76, total: 100, test_id: 't2', test_date: '2026-02-15' }));
    store.add_test_score(make_score(student_id, { score: 74, total: 100, test_id: 't3', test_date: '2026-03-15' }));

    // When: getting progress
    const progress = store.get_student_progress(student_id);

    // Then: trend should be stable
    expect(progress.trend).toBe('stable');
  });

  it('should default to stable when fewer than 3 scores', () => {
    // Given: only 2 scores
    store.add_test_score(make_score(student_id, { score: 60, total: 100, test_id: 't1', test_date: '2026-01-15' }));
    store.add_test_score(make_score(student_id, { score: 90, total: 100, test_id: 't2', test_date: '2026-02-15' }));

    // When: getting progress
    const progress = store.get_student_progress(student_id);

    // Then: trend should be stable (insufficient data)
    expect(progress.trend).toBe('stable');
  });

  it('should return scores sorted by test_date ascending', () => {
    // Given: scores added out of order
    store.add_test_score(make_score(student_id, { score: 90, total: 100, test_id: 't3', test_date: '2026-03-15' }));
    store.add_test_score(make_score(student_id, { score: 60, total: 100, test_id: 't1', test_date: '2026-01-15' }));
    store.add_test_score(make_score(student_id, { score: 75, total: 100, test_id: 't2', test_date: '2026-02-15' }));

    // When: getting progress
    const progress = store.get_student_progress(student_id);

    // Then: scores should be sorted by date
    expect(progress.scores[0].test_date).toBe('2026-01-15');
    expect(progress.scores[1].test_date).toBe('2026-02-15');
    expect(progress.scores[2].test_date).toBe('2026-03-15');
  });

  it('should return the correct last_test_date', () => {
    // Given: multiple scores
    store.add_test_score(make_score(student_id, { test_id: 't1', test_date: '2026-01-15' }));
    store.add_test_score(make_score(student_id, { test_id: 't2', test_date: '2026-03-20' }));

    // When: getting progress
    const progress = store.get_student_progress(student_id);

    // Then: last_test_date should be the most recent
    expect(progress.last_test_date).toBe('2026-03-20');
  });

  it('should handle non-100 total correctly in average calculation', () => {
    // Given: scores with different totals
    store.add_test_score(make_score(student_id, { score: 40, total: 50, test_id: 't1', test_date: '2026-01-15' }));
    store.add_test_score(make_score(student_id, { score: 80, total: 100, test_id: 't2', test_date: '2026-02-15' }));
    store.add_test_score(make_score(student_id, { score: 45, total: 50, test_id: 't3', test_date: '2026-03-15' }));

    // When: getting progress
    const progress = store.get_student_progress(student_id);

    // Then: average should be based on percentages (80, 80, 90) = 83.33
    expect(progress.average_score).toBeCloseTo(83.33, 1);
  });
});

// === generate_student_report ===

describe('generate_student_report', () => {
  let student_id: string;

  beforeEach(() => {
    const s = store.add_student(make_student({
      name: '이서연',
      grade: '고3',
      class_type: '의대반',
    }));
    student_id = s.id;
  });

  it('should throw for a non-existent student', () => {
    // Given/When/Then: should throw
    expect(() => store.generate_student_report('no-such-id'))
      .toThrow('Student not found');
  });

  it('should return a markdown formatted string', () => {
    // Given: a student with scores
    store.add_test_score(make_score(student_id, { score: 85, total: 100, test_id: 't1', test_date: '2026-01-15' }));

    // When: generating report
    const report = store.generate_student_report(student_id);

    // Then: should be a markdown string with header
    expect(typeof report).toBe('string');
    expect(report).toContain('# 이서연 학생 성적 보고서');
  });

  it('should include student info section', () => {
    // Given/When
    const report = store.generate_student_report(student_id);

    // Then: should contain student metadata
    expect(report).toContain('고3');
    expect(report).toContain('의대반');
    expect(report).toContain('재원');
  });

  it('should handle student with no scores gracefully', () => {
    // Given: a student with no scores
    // When: generating report
    const report = store.generate_student_report(student_id);

    // Then: should mention no test results
    expect(report).toContain('아직 기록된 시험 결과가 없습니다');
  });

  it('should include score history table when scores exist', () => {
    // Given: multiple scores
    store.add_test_score(make_score(student_id, {
      score: 85, total: 100, test_id: 't1',
      test_name: '1월 모의고사', test_date: '2026-01-15', subject: 'physics',
    }));
    store.add_test_score(make_score(student_id, {
      score: 90, total: 100, test_id: 't2',
      test_name: '2월 모의고사', test_date: '2026-02-15', subject: 'chemistry',
    }));

    // When: generating report
    const report = store.generate_student_report(student_id);

    // Then: should include markdown table with scores
    expect(report).toContain('| 시험명 | 과목 | 날짜 | 점수 | 백분위 |');
    expect(report).toContain('1월 모의고사');
    expect(report).toContain('2월 모의고사');
    expect(report).toContain('85/100');
    expect(report).toContain('90/100');
  });

  it('should include overall summary with average and trend', () => {
    // Given: enough scores for trend analysis
    store.add_test_score(make_score(student_id, { score: 70, total: 100, test_id: 't1', test_date: '2026-01-15' }));
    store.add_test_score(make_score(student_id, { score: 80, total: 100, test_id: 't2', test_date: '2026-02-15' }));
    store.add_test_score(make_score(student_id, { score: 90, total: 100, test_id: 't3', test_date: '2026-03-15' }));

    // When: generating report
    const report = store.generate_student_report(student_id);

    // Then: should contain summary metrics
    expect(report).toContain('## 종합 요약');
    expect(report).toContain('평균 점수');
    expect(report).toContain('성적 추세');
    expect(report).toContain('총 시험 횟수');
  });

  it('should include subject-level analysis', () => {
    // Given: scores in multiple subjects
    store.add_test_score(make_score(student_id, { score: 85, total: 100, test_id: 't1', test_date: '2026-01-15', subject: 'physics' }));
    store.add_test_score(make_score(student_id, { score: 90, total: 100, test_id: 't2', test_date: '2026-02-15', subject: 'physics' }));
    store.add_test_score(make_score(student_id, { score: 95, total: 100, test_id: 't3', test_date: '2026-03-15', subject: 'physics' }));
    store.add_test_score(make_score(student_id, { score: 70, total: 100, test_id: 't1', test_date: '2026-01-15', subject: 'chemistry' }));

    // When: generating report
    const report = store.generate_student_report(student_id);

    // Then: should have per-subject sections
    expect(report).toContain('## 과목별 분석');
    expect(report).toContain('### physics');
    expect(report).toContain('### chemistry');
  });

  it('should include notes section when student has notes', () => {
    // Given: a student with notes
    store.update_student(student_id, { notes: '물리 심화 학습 필요' });

    // When: generating report
    const report = store.generate_student_report(student_id);

    // Then: should include notes
    expect(report).toContain('## 특이사항');
    expect(report).toContain('물리 심화 학습 필요');
  });

  it('should include report generation date', () => {
    // Given/When
    const report = store.generate_student_report(student_id);

    // Then: should have generation date
    expect(report).toContain('보고서 생성일');
  });
});

// === get_class_rankings ===

describe('get_class_rankings', () => {
  let s1_id: string;
  let s2_id: string;
  let s3_id: string;

  beforeEach(() => {
    // Given: 3 students in 의대반, 1 in 일반반
    const s1 = store.add_student(make_student({ name: '김민수' }));
    const s2 = store.add_student(make_student({ name: '이서연' }));
    const s3 = store.add_student(make_student({ name: '박지훈' }));
    store.add_student(make_student({ name: '최영희', class_type: '일반반' }));

    s1_id = s1.id;
    s2_id = s2.id;
    s3_id = s3.id;
  });

  it('should rank students by score descending', () => {
    // Given: scores for a test
    store.add_test_score(make_score(s1_id, { score: 70, total: 100, test_id: 'rank-test' }));
    store.add_test_score(make_score(s2_id, { score: 90, total: 100, test_id: 'rank-test' }));
    store.add_test_score(make_score(s3_id, { score: 80, total: 100, test_id: 'rank-test' }));

    // When: getting rankings
    const rankings = store.get_class_rankings('의대반', 'rank-test');

    // Then: should be sorted by score descending
    expect(rankings).toHaveLength(3);
    expect(rankings[0].student.name).toBe('이서연');
    expect(rankings[0].rank).toBe(1);
    expect(rankings[1].student.name).toBe('박지훈');
    expect(rankings[1].rank).toBe(2);
    expect(rankings[2].student.name).toBe('김민수');
    expect(rankings[2].rank).toBe(3);
  });

  it('should only include students from the specified class', () => {
    // Given: 일반반 student also has a score
    const other_student = store.add_student(make_student({ name: '일반반학생', class_type: '일반반' }));
    store.add_test_score(make_score(s1_id, { score: 70, total: 100, test_id: 'class-test' }));
    store.add_test_score(make_score(other_student.id, { score: 95, total: 100, test_id: 'class-test' }));

    // When: getting 의대반 rankings
    const rankings = store.get_class_rankings('의대반', 'class-test');

    // Then: should only include 의대반 students
    expect(rankings).toHaveLength(1);
    expect(rankings[0].student.class_type).toBe('의대반');
  });

  it('should handle ties with same rank', () => {
    // Given: two students with the same score
    store.add_test_score(make_score(s1_id, { score: 85, total: 100, test_id: 'tie-test' }));
    store.add_test_score(make_score(s2_id, { score: 85, total: 100, test_id: 'tie-test' }));
    store.add_test_score(make_score(s3_id, { score: 70, total: 100, test_id: 'tie-test' }));

    // When: getting rankings
    const rankings = store.get_class_rankings('의대반', 'tie-test');

    // Then: tied students should share the same rank
    expect(rankings).toHaveLength(3);
    expect(rankings[0].rank).toBe(1);
    expect(rankings[1].rank).toBe(1);
    // The next rank after a tie should skip (1, 1, 3)
    expect(rankings[2].rank).toBe(3);
  });

  it('should return empty array for non-existent test', () => {
    // Given/When: querying a test that doesn't exist
    const rankings = store.get_class_rankings('의대반', 'non-existent-test');

    // Then: should be empty
    expect(rankings).toHaveLength(0);
  });

  it('should return empty array for a class with no students', () => {
    // Given/When: querying a class that doesn't exist
    const rankings = store.get_class_rankings('오금고반', 'any-test');

    // Then: should be empty
    expect(rankings).toHaveLength(0);
  });

  it('should include the full score entry in each ranking', () => {
    // Given: a student with a score
    store.add_test_score(make_score(s1_id, {
      score: 88,
      total: 100,
      test_id: 'detail-test',
      test_name: '3월 중간고사',
      subject: 'physics',
    }));

    // When: getting rankings
    const rankings = store.get_class_rankings('의대반', 'detail-test');

    // Then: score entry should be complete
    expect(rankings[0].score.score).toBe(88);
    expect(rankings[0].score.total).toBe(100);
    expect(rankings[0].score.test_name).toBe('3월 중간고사');
    expect(rankings[0].score.subject).toBe('physics');
  });
});

// === Integration tests ===

describe('integration: full workflow', () => {
  it('should support a complete student lifecycle', () => {
    // 1. Add a student
    const student = store.add_student(make_student({ name: '통합테스트학생' }));
    expect(student.id).toBeDefined();

    // 2. Add scores over time
    store.add_test_score(make_score(student.id, { score: 65, total: 100, test_id: 't1', test_date: '2026-01-15' }));
    store.add_test_score(make_score(student.id, { score: 72, total: 100, test_id: 't2', test_date: '2026-02-15' }));
    store.add_test_score(make_score(student.id, { score: 80, total: 100, test_id: 't3', test_date: '2026-03-15' }));

    // 3. Check progress
    const progress = store.get_student_progress(student.id);
    expect(progress.scores).toHaveLength(3);
    expect(progress.trend).toBe('improving');
    expect(progress.average_score).toBeCloseTo(72.33, 1);

    // 4. Generate report
    const report = store.generate_student_report(student.id);
    expect(report).toContain('통합테스트학생');
    expect(report).toContain('향상');

    // 5. Update student notes
    store.update_student(student.id, { notes: '꾸준한 성장세' });
    const updated_report = store.generate_student_report(student.id);
    expect(updated_report).toContain('꾸준한 성장세');
  });

  it('should support multi-student class ranking workflow', () => {
    // 1. Add multiple students
    const students = [
      store.add_student(make_student({ name: '학생1', class_type: '의대반' })),
      store.add_student(make_student({ name: '학생2', class_type: '의대반' })),
      store.add_student(make_student({ name: '학생3', class_type: '의대반' })),
    ];

    // 2. Add scores for the same test
    const scores = [92, 78, 85];
    for (let i = 0; i < students.length; i++) {
      store.add_test_score(make_score(students[i].id, {
        score: scores[i],
        total: 100,
        test_id: 'ranking-test',
        test_name: '3월 모의고사',
      }));
    }

    // 3. Get class rankings
    const rankings = store.get_class_rankings('의대반', 'ranking-test');
    expect(rankings).toHaveLength(3);
    expect(rankings[0].student.name).toBe('학생1'); // 92 points
    expect(rankings[0].rank).toBe(1);
    expect(rankings[1].student.name).toBe('학생3'); // 85 points
    expect(rankings[1].rank).toBe(2);
    expect(rankings[2].student.name).toBe('학생2'); // 78 points
    expect(rankings[2].rank).toBe(3);
  });
});
