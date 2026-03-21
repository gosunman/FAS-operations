// Student data management module for EIDOS SCIENCE academy
// Higher-level API for student CRUD, scoring with auto-percentile,
// progress tracking, markdown report generation, and class rankings.
// Uses file-based JSON store (MongoDB-swappable interface).

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

// === Types ===

export type Student = {
  id: string;
  name: string;
  grade: string;              // e.g. "고2", "고3"
  class_type: string;         // e.g. "의대반", "일반반"
  parent_phone: string;
  enrolled_at: string;        // ISO date
  notes: string;
  active: boolean;
};

export type TestScore = {
  student_id: string;
  test_id: string;
  test_name: string;
  test_date: string;          // ISO date
  subject: string;
  score: number;
  total: number;
  percentile: number | null;
  notes: string;
};

export type StudentProgress = {
  student: Student;
  scores: TestScore[];
  average_score: number;
  trend: 'improving' | 'declining' | 'stable';
  last_test_date: string | null;
};

export type StudentFilter = {
  class_type?: string;
  active?: boolean;
};

export type ClassRankingEntry = {
  student: Student;
  score: TestScore;
  rank: number;
};

export type StudentDataConfig = {
  state_dir: string;
};

// === Internal helpers ===

// Minimum number of scores to calculate a meaningful trend
const MIN_SCORES_FOR_TREND = 3;

// Threshold for trend classification (percentage change)
const STABLE_THRESHOLD = 5;

const students_path = (dir: string) => path.join(dir, 'student_data_students.json');
const scores_path = (dir: string) => path.join(dir, 'student_data_scores.json');

const read_json = <T>(file_path: string, fallback: T): T => {
  try {
    const raw = fs.readFileSync(file_path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const write_json = <T>(file_path: string, data: T): void => {
  fs.writeFileSync(file_path, JSON.stringify(data, null, 2), 'utf-8');
};

// Calculate average of an array of numbers
const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
};

// Simple linear regression slope
const compute_slope = (values: number[]): number => {
  const n = values.length;
  if (n < 2) return 0;

  const x_mean = (n - 1) / 2;
  const y_mean = values.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - x_mean) * (values[i] - y_mean);
    denominator += (i - x_mean) ** 2;
  }

  return denominator === 0 ? 0 : numerator / denominator;
};

// Classify trend based on percentage change rate
const classify_trend = (change_rate: number): 'improving' | 'declining' | 'stable' => {
  if (Math.abs(change_rate) < STABLE_THRESHOLD) return 'stable';
  return change_rate > 0 ? 'improving' : 'declining';
};

// Calculate percentile of a score within a set of scores
// Uses the "percentage of values below" method
const calculate_percentile = (score: number, all_scores: number[]): number => {
  if (all_scores.length <= 1) return 100;
  const below = all_scores.filter(s => s < score).length;
  const equal = all_scores.filter(s => s === score).length;
  // Percentile = (below + 0.5 * equal) / total * 100
  return Math.round(((below + 0.5 * equal) / all_scores.length) * 100);
};

// Format date for Korean display (YYYY-MM-DD -> YYYY년 M월 D일)
const format_date_korean = (iso_date: string): string => {
  const parts = iso_date.split('-');
  if (parts.length !== 3) return iso_date;
  const year = parts[0];
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  return `${year}년 ${month}월 ${day}일`;
};

// Map trend to Korean label
const trend_label_korean = (trend: 'improving' | 'declining' | 'stable'): string => {
  switch (trend) {
    case 'improving': return '향상';
    case 'declining': return '하락';
    case 'stable': return '유지';
  }
};

// === Factory ===

export const create_student_data = (config: StudentDataConfig) => {
  const { state_dir } = config;

  // Ensure state directory exists
  fs.mkdirSync(state_dir, { recursive: true });

  // Helper to load/save students
  const load_students = (): Student[] => read_json(students_path(state_dir), []);
  const save_students = (students: Student[]): void => write_json(students_path(state_dir), students);

  // Helper to load/save scores
  const load_scores = (): TestScore[] => read_json(scores_path(state_dir), []);
  const save_scores = (scores: TestScore[]): void => write_json(scores_path(state_dir), scores);

  // --- Student CRUD ---

  const add_student = (data: Omit<Student, 'id'>): Student => {
    const students = load_students();
    const student: Student = {
      ...data,
      id: crypto.randomUUID(),
    };
    students.push(student);
    save_students(students);
    return student;
  };

  const get_student = (id: string): Student | null => {
    const students = load_students();
    return students.find(s => s.id === id) ?? null;
  };

  const list_students = (filter?: StudentFilter): Student[] => {
    let students = load_students();

    if (filter?.class_type !== undefined) {
      students = students.filter(s => s.class_type === filter.class_type);
    }
    if (filter?.active !== undefined) {
      students = students.filter(s => s.active === filter.active);
    }

    return students;
  };

  const update_student = (id: string, updates: Partial<Student>): Student => {
    const students = load_students();
    const index = students.findIndex(s => s.id === id);
    if (index === -1) {
      throw new Error(`Student not found: ${id}`);
    }

    // Merge updates but never overwrite the ID
    const updated: Student = { ...students[index], ...updates, id };
    students[index] = updated;
    save_students(students);
    return updated;
  };

  // --- Score management ---

  const add_test_score = (data: Omit<TestScore, 'percentile'>): TestScore => {
    // Verify student exists
    const student = get_student(data.student_id);
    if (!student) {
      throw new Error(`Student not found: ${data.student_id}`);
    }

    const all_scores = load_scores();

    // Find all scores for the same test_id and class_type to calculate percentile
    const same_test_scores = all_scores.filter(s => s.test_id === data.test_id);
    const same_class_students = load_students().filter(s => s.class_type === student.class_type);
    const same_class_student_ids = new Set(same_class_students.map(s => s.id));

    // Get scores from same class for this test
    const class_scores_for_test = same_test_scores
      .filter(s => same_class_student_ids.has(s.student_id))
      .map(s => (s.score / s.total) * 100);

    // Include the new score in the calculation
    const new_score_percentage = (data.score / data.total) * 100;
    const all_class_scores = [...class_scores_for_test, new_score_percentage];

    // Calculate percentile
    const percentile = calculate_percentile(new_score_percentage, all_class_scores);

    const score_entry: TestScore = {
      ...data,
      percentile,
    };

    all_scores.push(score_entry);
    save_scores(all_scores);
    return score_entry;
  };

  // --- Analysis ---

  const get_student_progress = (student_id: string): StudentProgress => {
    const student = get_student(student_id);
    if (!student) {
      throw new Error(`Student not found: ${student_id}`);
    }

    const all_scores = load_scores().filter(s => s.student_id === student_id);

    // Sort by test_date ascending
    const sorted_scores = [...all_scores].sort((a, b) =>
      a.test_date.localeCompare(b.test_date),
    );

    // Calculate average score as percentage
    const percentages = sorted_scores.map(s => (s.score / s.total) * 100);
    const avg = average(percentages);

    // Calculate trend
    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    if (percentages.length >= MIN_SCORES_FOR_TREND) {
      const slope = compute_slope(percentages);
      const overall_avg = average(percentages);
      const change_rate = overall_avg === 0 ? 0 : (slope / overall_avg) * 100;
      trend = classify_trend(change_rate);
    }

    const last_test_date = sorted_scores.length > 0
      ? sorted_scores[sorted_scores.length - 1].test_date
      : null;

    return {
      student,
      scores: sorted_scores,
      average_score: Math.round(avg * 100) / 100,
      trend,
      last_test_date,
    };
  };

  // --- Report generation ---

  const generate_student_report = (student_id: string): string => {
    const student = get_student(student_id);
    if (!student) {
      throw new Error(`Student not found: ${student_id}`);
    }

    const progress = get_student_progress(student_id);
    const lines: string[] = [];

    // Header
    lines.push(`# ${student.name} 학생 성적 보고서`);
    lines.push('');
    lines.push(`- **학년**: ${student.grade}`);
    lines.push(`- **반**: ${student.class_type}`);
    lines.push(`- **등록일**: ${format_date_korean(student.enrolled_at)}`);
    lines.push(`- **상태**: ${student.active ? '재원' : '퇴원'}`);
    lines.push('');

    // Overall summary
    lines.push('## 종합 요약');
    lines.push('');

    if (progress.scores.length === 0) {
      lines.push('아직 기록된 시험 결과가 없습니다.');
      lines.push('');
    } else {
      lines.push(`- **평균 점수**: ${progress.average_score}%`);
      lines.push(`- **성적 추세**: ${trend_label_korean(progress.trend)}`);
      lines.push(`- **최근 시험일**: ${progress.last_test_date ? format_date_korean(progress.last_test_date) : '-'}`);
      lines.push(`- **총 시험 횟수**: ${progress.scores.length}회`);
      lines.push('');

      // Score history table
      lines.push('## 시험 결과');
      lines.push('');
      lines.push('| 시험명 | 과목 | 날짜 | 점수 | 백분위 |');
      lines.push('|--------|------|------|------|--------|');

      for (const score of progress.scores) {
        const pct = score.percentile !== null ? `${score.percentile}%` : '-';
        const score_display = `${score.score}/${score.total}`;
        lines.push(`| ${score.test_name} | ${score.subject} | ${score.test_date} | ${score_display} | ${pct} |`);
      }
      lines.push('');

      // Subject-level analysis
      const subjects = [...new Set(progress.scores.map(s => s.subject))];
      if (subjects.length > 0) {
        lines.push('## 과목별 분석');
        lines.push('');
        for (const subject of subjects) {
          const subject_scores = progress.scores.filter(s => s.subject === subject);
          const subject_percentages = subject_scores.map(s => (s.score / s.total) * 100);
          const subject_avg = average(subject_percentages);

          lines.push(`### ${subject}`);
          lines.push(`- 평균: ${Math.round(subject_avg * 100) / 100}%`);
          lines.push(`- 시험 횟수: ${subject_scores.length}회`);

          if (subject_percentages.length >= MIN_SCORES_FOR_TREND) {
            const slope = compute_slope(subject_percentages);
            const change_rate = subject_avg === 0 ? 0 : (slope / subject_avg) * 100;
            const subject_trend = classify_trend(change_rate);
            lines.push(`- 추세: ${trend_label_korean(subject_trend)}`);
          }
          lines.push('');
        }
      }
    }

    // Notes
    if (student.notes) {
      lines.push('## 특이사항');
      lines.push('');
      lines.push(student.notes);
      lines.push('');
    }

    // Footer
    const generated_at = new Date().toISOString().split('T')[0];
    lines.push('---');
    lines.push(`*보고서 생성일: ${format_date_korean(generated_at)}*`);

    return lines.join('\n');
  };

  // --- Class rankings ---

  const get_class_rankings = (
    class_type: string,
    test_id: string,
  ): ClassRankingEntry[] => {
    const all_scores = load_scores();
    const class_students = load_students().filter(s => s.class_type === class_type);
    const class_student_ids = new Set(class_students.map(s => s.id));
    const class_student_map = new Map(class_students.map(s => [s.id, s]));

    // Find scores for this test from students in this class
    const test_scores = all_scores
      .filter(s => s.test_id === test_id && class_student_ids.has(s.student_id));

    // Sort by score percentage descending
    const sorted = [...test_scores].sort((a, b) => {
      const pct_a = (a.score / a.total) * 100;
      const pct_b = (b.score / b.total) * 100;
      return pct_b - pct_a;
    });

    // Assign ranks (handle ties with same rank)
    const rankings: ClassRankingEntry[] = [];
    let current_rank = 1;
    let previous_pct: number | null = null;

    for (let i = 0; i < sorted.length; i++) {
      const score = sorted[i];
      const student = class_student_map.get(score.student_id);
      if (!student) continue;

      const pct = (score.score / score.total) * 100;
      if (previous_pct !== null && pct < previous_pct) {
        current_rank = i + 1;
      }
      previous_pct = pct;

      rankings.push({
        student,
        score,
        rank: current_rank,
      });
    }

    return rankings;
  };

  return {
    add_student,
    get_student,
    list_students,
    update_student,
    add_test_score,
    get_student_progress,
    generate_student_report,
    get_class_rankings,
  };
};
