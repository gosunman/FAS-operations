// Tests for student data management module
// File-based JSON store with MongoDB-swappable interface

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  create_student_store,
  type StudentProfile,
  type ScoreEntry,
  type SubjectTrend,
  type StudentReport,
  type StudentFilter,
  type StudentStore,
} from './student_store.js';

const TEST_STATE_DIR = path.join(import.meta.dirname, '../../state/academy_test_' + process.pid);

let store: StudentStore;

const make_student = (overrides: Partial<Omit<StudentProfile, 'id'>> = {}): Omit<StudentProfile, 'id'> => ({
  name: '김민수',
  grade: '고2',
  class_type: 'medical',
  subjects: ['physics', 'chemistry', 'biology'],
  enrollment_date: '2026-03-01',
  ...overrides,
});

beforeEach(() => {
  fs.mkdirSync(TEST_STATE_DIR, { recursive: true });
  store = create_student_store({ state_dir: TEST_STATE_DIR });
});

afterEach(() => {
  fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
});

// === create_student ===

describe('create_student', () => {
  it('should create a student with a generated ID', () => {
    const result = store.create_student(make_student());
    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
    expect(result.name).toBe('김민수');
    expect(result.grade).toBe('고2');
    expect(result.class_type).toBe('medical');
  });

  it('should persist the student to disk', () => {
    const created = store.create_student(make_student());
    // Re-create store from same dir to verify persistence
    const store2 = create_student_store({ state_dir: TEST_STATE_DIR });
    const fetched = store2.get_student(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('김민수');
  });

  it('should generate unique IDs for different students', () => {
    const s1 = store.create_student(make_student({ name: '학생1' }));
    const s2 = store.create_student(make_student({ name: '학생2' }));
    expect(s1.id).not.toBe(s2.id);
  });

  it('should store optional fields', () => {
    const result = store.create_student(make_student({
      school: '서울과학고',
      notes: '의대 목표',
      contact_parent: '010-1234-5678',
      attendance_streak: 10,
    }));
    expect(result.school).toBe('서울과학고');
    expect(result.notes).toBe('의대 목표');
    expect(result.contact_parent).toBe('010-1234-5678');
    expect(result.attendance_streak).toBe(10);
  });
});

// === get_student ===

describe('get_student', () => {
  it('should retrieve an existing student by ID', () => {
    const created = store.create_student(make_student());
    const fetched = store.get_student(created.id);
    expect(fetched).toEqual(created);
  });

  it('should return null for non-existent ID', () => {
    const result = store.get_student('non-existent-id');
    expect(result).toBeNull();
  });
});

// === list_students ===

describe('list_students', () => {
  beforeEach(() => {
    store.create_student(make_student({ name: '학생A', grade: '고2', class_type: 'medical' }));
    store.create_student(make_student({ name: '학생B', grade: '고3', class_type: 'medical' }));
    store.create_student(make_student({ name: '학생C', grade: '고2', class_type: 'regular' }));
    store.create_student(make_student({ name: '학생D', grade: '중3', class_type: 'ogeum', subjects: ['math'] }));
  });

  it('should return all students without filter', () => {
    const all = store.list_students();
    expect(all).toHaveLength(4);
  });

  it('should filter by grade', () => {
    const result = store.list_students({ grade: '고2' });
    expect(result).toHaveLength(2);
    expect(result.every(s => s.grade === '고2')).toBe(true);
  });

  it('should filter by class_type', () => {
    const result = store.list_students({ class_type: 'medical' });
    expect(result).toHaveLength(2);
    expect(result.every(s => s.class_type === 'medical')).toBe(true);
  });

  it('should filter by subject', () => {
    const result = store.list_students({ subject: 'math' });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('학생D');
  });

  it('should combine filters', () => {
    const result = store.list_students({ grade: '고2', class_type: 'medical' });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('학생A');
  });

  it('should return empty array when no match', () => {
    const result = store.list_students({ grade: '고1' });
    expect(result).toHaveLength(0);
  });
});

// === update_student ===

describe('update_student', () => {
  it('should partially update student fields', () => {
    const created = store.create_student(make_student());
    const updated = store.update_student(created.id, { grade: '고3', notes: '성적 향상' });
    expect(updated).not.toBeNull();
    expect(updated!.grade).toBe('고3');
    expect(updated!.notes).toBe('성적 향상');
    // Unchanged fields preserved
    expect(updated!.name).toBe('김민수');
    expect(updated!.class_type).toBe('medical');
  });

  it('should return null for non-existent student', () => {
    const result = store.update_student('no-such-id', { grade: '고1' });
    expect(result).toBeNull();
  });

  it('should persist updates to disk', () => {
    const created = store.create_student(make_student());
    store.update_student(created.id, { school: '한성과학고' });
    const store2 = create_student_store({ state_dir: TEST_STATE_DIR });
    const fetched = store2.get_student(created.id);
    expect(fetched!.school).toBe('한성과학고');
  });
});

// === delete_student ===

describe('delete_student', () => {
  it('should remove a student and return true', () => {
    const created = store.create_student(make_student());
    const result = store.delete_student(created.id);
    expect(result).toBe(true);
    expect(store.get_student(created.id)).toBeNull();
  });

  it('should return false for non-existent student', () => {
    expect(store.delete_student('no-such-id')).toBe(false);
  });
});

// === record_score ===

describe('record_score', () => {
  let student_id: string;

  beforeEach(() => {
    const s = store.create_student(make_student());
    student_id = s.id;
  });

  it('should record a score and compute percentage', () => {
    const score = store.record_score(student_id, {
      subject: 'physics',
      score: 85,
      max_score: 100,
      test_date: '2026-03-15',
      test_type: 'weekly',
    });
    expect(score).not.toBeNull();
    expect(score!.id).toBeDefined();
    expect(score!.student_id).toBe(student_id);
    expect(score!.percentage).toBe(85);
    expect(score!.subject).toBe('physics');
  });

  it('should correctly calculate percentage for non-100 max', () => {
    const score = store.record_score(student_id, {
      subject: 'chemistry',
      score: 42,
      max_score: 50,
      test_date: '2026-03-15',
      test_type: 'monthly',
    });
    expect(score!.percentage).toBe(84);
  });

  it('should return null for non-existent student', () => {
    const score = store.record_score('no-such-id', {
      subject: 'physics',
      score: 90,
      max_score: 100,
      test_date: '2026-03-15',
      test_type: 'weekly',
    });
    expect(score).toBeNull();
  });

  it('should persist scores to disk', () => {
    store.record_score(student_id, {
      subject: 'physics',
      score: 80,
      max_score: 100,
      test_date: '2026-03-10',
      test_type: 'weekly',
    });
    const store2 = create_student_store({ state_dir: TEST_STATE_DIR });
    const history = store2.get_score_history(student_id);
    expect(history).toHaveLength(1);
    expect(history[0].score).toBe(80);
  });
});

// === get_score_history ===

describe('get_score_history', () => {
  let student_id: string;

  beforeEach(() => {
    const s = store.create_student(make_student());
    student_id = s.id;
    store.record_score(student_id, { subject: 'physics', score: 70, max_score: 100, test_date: '2026-01-10', test_type: 'weekly' });
    store.record_score(student_id, { subject: 'physics', score: 80, max_score: 100, test_date: '2026-02-10', test_type: 'monthly' });
    store.record_score(student_id, { subject: 'chemistry', score: 60, max_score: 100, test_date: '2026-01-15', test_type: 'weekly' });
  });

  it('should return all scores for a student', () => {
    const history = store.get_score_history(student_id);
    expect(history).toHaveLength(3);
  });

  it('should filter by subject', () => {
    const physics_scores = store.get_score_history(student_id, 'physics');
    expect(physics_scores).toHaveLength(2);
    expect(physics_scores.every(s => s.subject === 'physics')).toBe(true);
  });

  it('should return empty for student with no scores', () => {
    const s2 = store.create_student(make_student({ name: '새학생' }));
    expect(store.get_score_history(s2.id)).toHaveLength(0);
  });

  it('should return scores sorted by test_date ascending', () => {
    const history = store.get_score_history(student_id, 'physics');
    expect(history[0].test_date).toBe('2026-01-10');
    expect(history[1].test_date).toBe('2026-02-10');
  });
});

// === analyze_trends ===

describe('analyze_trends', () => {
  let student_id: string;

  beforeEach(() => {
    const s = store.create_student(make_student({ subjects: ['physics', 'chemistry', 'biology'] }));
    student_id = s.id;
  });

  const add_scores = (subject: string, scores: number[]) => {
    scores.forEach((score, i) => {
      store.record_score(student_id, {
        subject,
        score,
        max_score: 100,
        test_date: `2026-0${i + 1}-15`,
        test_type: 'monthly',
      });
    });
  };

  it('should return insufficient_data for subjects with < 3 scores', () => {
    add_scores('physics', [70, 80]);
    const trends = store.analyze_trends(student_id);
    const physics = trends.find(t => t.subject === 'physics');
    expect(physics).toBeDefined();
    expect(physics!.trend).toBe('insufficient_data');
    expect(physics!.score_count).toBe(2);
  });

  it('should detect improving trend', () => {
    add_scores('physics', [60, 65, 70, 75, 80]);
    const trends = store.analyze_trends(student_id);
    const physics = trends.find(t => t.subject === 'physics');
    expect(physics!.trend).toBe('improving');
    expect(physics!.change_rate).toBeGreaterThan(0);
    // recent_average should be average of last 3 (70, 75, 80)
    expect(physics!.recent_average).toBeCloseTo(75, 0);
  });

  it('should detect declining trend', () => {
    add_scores('chemistry', [90, 85, 80, 70, 60]);
    const trends = store.analyze_trends(student_id);
    const chem = trends.find(t => t.subject === 'chemistry');
    expect(chem!.trend).toBe('declining');
    expect(chem!.change_rate).toBeLessThan(0);
  });

  it('should detect stable trend', () => {
    add_scores('biology', [75, 76, 74, 75, 76]);
    const trends = store.analyze_trends(student_id);
    const bio = trends.find(t => t.subject === 'biology');
    expect(bio!.trend).toBe('stable');
  });

  it('should calculate overall_average correctly', () => {
    add_scores('physics', [60, 70, 80]);
    const trends = store.analyze_trends(student_id);
    const physics = trends.find(t => t.subject === 'physics');
    expect(physics!.overall_average).toBeCloseTo(70, 0);
  });

  it('should include trends for all subjects with scores', () => {
    add_scores('physics', [60, 70, 80]);
    add_scores('chemistry', [50, 55, 60]);
    const trends = store.analyze_trends(student_id);
    // Should have entries for physics and chemistry (which have scores)
    // biology has no scores, may or may not appear
    expect(trends.filter(t => t.score_count > 0)).toHaveLength(2);
  });
});

// === generate_student_report ===

describe('generate_student_report', () => {
  let student_id: string;

  beforeEach(() => {
    const s = store.create_student(make_student({
      name: '이서연',
      subjects: ['physics', 'chemistry', 'biology'],
    }));
    student_id = s.id;
  });

  const add_scores = (subject: string, scores: number[]) => {
    scores.forEach((score, i) => {
      store.record_score(student_id, {
        subject,
        score,
        max_score: 100,
        test_date: `2026-0${i + 1}-15`,
        test_type: 'monthly',
      });
    });
  };

  it('should return null for non-existent student', () => {
    expect(store.generate_student_report('no-such-id')).toBeNull();
  });

  it('should return a complete report structure', () => {
    add_scores('physics', [85, 88, 90, 92]);
    add_scores('chemistry', [50, 48, 45, 42]);
    add_scores('biology', [70, 72, 71, 70]);

    const report = store.generate_student_report(student_id);
    expect(report).not.toBeNull();
    expect(report!.student.name).toBe('이서연');
    expect(report!.generated_at).toBeDefined();
    expect(report!.subject_trends).toBeDefined();
    expect(report!.strengths).toBeDefined();
    expect(report!.weaknesses).toBeDefined();
    expect(report!.recommendations).toBeDefined();
    expect(report!.overall_summary).toBeDefined();
    expect(typeof report!.overall_summary).toBe('string');
    expect(report!.overall_summary.length).toBeGreaterThan(0);
  });

  it('should identify strengths (improving + high scores)', () => {
    add_scores('physics', [82, 85, 88, 92]); // improving + high
    add_scores('chemistry', [50, 48, 45, 42]); // declining + low
    add_scores('biology', [70, 72, 71, 70]); // stable + mid

    const report = store.generate_student_report(student_id)!;
    expect(report.strengths).toContain('physics');
  });

  it('should identify weaknesses (declining + low scores)', () => {
    add_scores('physics', [85, 88, 90, 92]);
    add_scores('chemistry', [55, 50, 48, 42]); // declining + below 60%

    const report = store.generate_student_report(student_id)!;
    expect(report.weaknesses).toContain('chemistry');
  });

  it('should provide recommendations', () => {
    add_scores('physics', [85, 88, 90, 92]);
    add_scores('chemistry', [55, 50, 48, 42]);

    const report = store.generate_student_report(student_id)!;
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it('should handle student with no scores gracefully', () => {
    const report = store.generate_student_report(student_id);
    expect(report).not.toBeNull();
    expect(report!.strengths).toHaveLength(0);
    expect(report!.weaknesses).toHaveLength(0);
    expect(report!.overall_summary.length).toBeGreaterThan(0);
  });
});
