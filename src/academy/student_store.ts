// Student data management module for EIDOS SCIENCE academy
// File-based JSON store — designed with MongoDB-swappable interface
// Handles: student CRUD, score recording, trend analysis, report generation

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

// === Types ===

export type StudentProfile = {
  id: string;
  name: string;
  grade: string;              // "중3", "고1", "고2", "고3"
  class_type: 'regular' | 'ogeum' | 'medical';
  school?: string;
  subjects: string[];
  enrollment_date: string;
  notes?: string;
  contact_parent?: string;    // parent phone (for SMS)
  attendance_streak?: number;
};

export type ScoreEntry = {
  id: string;
  student_id: string;
  subject: string;
  chapter?: string;
  score: number;
  max_score: number;
  percentage: number;
  test_date: string;
  test_type: 'weekly' | 'monthly' | 'mock' | 'school_exam';
  notes?: string;
};

export type SubjectTrend = {
  subject: string;
  trend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  recent_average: number;     // last 3 scores average
  overall_average: number;    // all scores average
  change_rate: number;        // percentage change (positive = improving)
  score_count: number;
};

export type StudentReport = {
  student: StudentProfile;
  generated_at: string;
  subject_trends: SubjectTrend[];
  strengths: string[];        // subjects with improving/high scores
  weaknesses: string[];       // subjects with declining/low scores
  recommendations: string[];  // actionable suggestions
  overall_summary: string;    // one paragraph summary
};

export type StudentFilter = {
  grade?: string;
  class_type?: 'regular' | 'ogeum' | 'medical';
  subject?: string;
};

export type StudentStore = {
  create_student(data: Omit<StudentProfile, 'id'>): StudentProfile;
  get_student(id: string): StudentProfile | null;
  list_students(filter?: StudentFilter): StudentProfile[];
  update_student(id: string, updates: Partial<StudentProfile>): StudentProfile | null;
  delete_student(id: string): boolean;
  record_score(student_id: string, entry: Omit<ScoreEntry, 'id' | 'student_id' | 'percentage'>): ScoreEntry | null;
  get_score_history(student_id: string, subject?: string): ScoreEntry[];
  analyze_trends(student_id: string): SubjectTrend[];
  generate_student_report(student_id: string): StudentReport | null;
};

export type StudentStoreConfig = {
  state_dir: string;          // directory to store JSON files
};

// === Internal helpers ===

// Minimum number of scores needed for meaningful trend analysis
const MIN_SCORES_FOR_TREND = 3;

// Threshold for trend classification (percentage change)
// Below this absolute value -> stable
const STABLE_THRESHOLD = 5;

// Threshold for strengths/weaknesses classification
const HIGH_SCORE_THRESHOLD = 80;
const LOW_SCORE_THRESHOLD = 60;

const students_path = (dir: string) => path.join(dir, 'students.json');
const scores_path = (dir: string) => path.join(dir, 'scores.json');

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

// Simple linear regression slope on percentage values
// Returns the slope (change per test index)
const compute_slope = (percentages: number[]): number => {
  const n = percentages.length;
  if (n < 2) return 0;

  // x = 0, 1, 2, ..., n-1
  const x_mean = (n - 1) / 2;
  const y_mean = percentages.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - x_mean) * (percentages[i] - y_mean);
    denominator += (i - x_mean) ** 2;
  }

  return denominator === 0 ? 0 : numerator / denominator;
};

// Calculate average of an array of numbers
const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
};

// Classify trend based on slope and change rate
const classify_trend = (change_rate: number): 'improving' | 'declining' | 'stable' => {
  if (Math.abs(change_rate) < STABLE_THRESHOLD) return 'stable';
  return change_rate > 0 ? 'improving' : 'declining';
};

// === Factory ===

export const create_student_store = (config: StudentStoreConfig): StudentStore => {
  const { state_dir } = config;

  // Ensure state directory exists
  fs.mkdirSync(state_dir, { recursive: true });

  // Helper to load/save students
  const load_students = (): StudentProfile[] => read_json(students_path(state_dir), []);
  const save_students = (students: StudentProfile[]): void => write_json(students_path(state_dir), students);

  // Helper to load/save scores
  const load_scores = (): ScoreEntry[] => read_json(scores_path(state_dir), []);
  const save_scores = (scores: ScoreEntry[]): void => write_json(scores_path(state_dir), scores);

  // --- CRUD ---

  const create_student = (data: Omit<StudentProfile, 'id'>): StudentProfile => {
    const students = load_students();
    const student: StudentProfile = {
      ...data,
      id: crypto.randomUUID(),
    };
    students.push(student);
    save_students(students);
    return student;
  };

  const get_student = (id: string): StudentProfile | null => {
    const students = load_students();
    return students.find(s => s.id === id) ?? null;
  };

  const list_students = (filter?: StudentFilter): StudentProfile[] => {
    let students = load_students();

    if (filter?.grade) {
      students = students.filter(s => s.grade === filter.grade);
    }
    if (filter?.class_type) {
      students = students.filter(s => s.class_type === filter.class_type);
    }
    if (filter?.subject) {
      students = students.filter(s => s.subjects.includes(filter.subject!));
    }

    return students;
  };

  const update_student = (id: string, updates: Partial<StudentProfile>): StudentProfile | null => {
    const students = load_students();
    const index = students.findIndex(s => s.id === id);
    if (index === -1) return null;

    // Merge updates, but never overwrite the ID
    const updated: StudentProfile = { ...students[index], ...updates, id };
    students[index] = updated;
    save_students(students);
    return updated;
  };

  const delete_student = (id: string): boolean => {
    const students = load_students();
    const index = students.findIndex(s => s.id === id);
    if (index === -1) return false;

    students.splice(index, 1);
    save_students(students);
    return true;
  };

  // --- Score management ---

  const record_score = (
    student_id: string,
    entry: Omit<ScoreEntry, 'id' | 'student_id' | 'percentage'>,
  ): ScoreEntry | null => {
    // Verify student exists
    const student = get_student(student_id);
    if (!student) return null;

    const scores = load_scores();
    const percentage = Math.round((entry.score / entry.max_score) * 100);

    const score_entry: ScoreEntry = {
      ...entry,
      id: crypto.randomUUID(),
      student_id,
      percentage,
    };

    scores.push(score_entry);
    save_scores(scores);
    return score_entry;
  };

  const get_score_history = (student_id: string, subject?: string): ScoreEntry[] => {
    const scores = load_scores();
    let filtered = scores.filter(s => s.student_id === student_id);

    if (subject) {
      filtered = filtered.filter(s => s.subject === subject);
    }

    // Sort by test_date ascending
    filtered.sort((a, b) => a.test_date.localeCompare(b.test_date));
    return filtered;
  };

  // --- Analysis ---

  const analyze_trends = (student_id: string): SubjectTrend[] => {
    const all_scores = load_scores().filter(s => s.student_id === student_id);

    // Group scores by subject
    const by_subject = new Map<string, ScoreEntry[]>();
    for (const score of all_scores) {
      const existing = by_subject.get(score.subject) ?? [];
      existing.push(score);
      by_subject.set(score.subject, existing);
    }

    const trends: SubjectTrend[] = [];

    for (const [subject, entries] of by_subject) {
      // Sort by date for trend calculation
      entries.sort((a, b) => a.test_date.localeCompare(b.test_date));
      const percentages = entries.map(e => e.percentage);
      const count = percentages.length;

      if (count < MIN_SCORES_FOR_TREND) {
        trends.push({
          subject,
          trend: 'insufficient_data',
          recent_average: average(percentages.slice(-Math.min(3, count))),
          overall_average: average(percentages),
          change_rate: 0,
          score_count: count,
        });
        continue;
      }

      const recent = percentages.slice(-3);
      const recent_avg = average(recent);
      const overall_avg = average(percentages);

      // Use linear regression slope to determine change rate
      // Normalize slope to percentage change relative to overall average
      const slope = compute_slope(percentages);
      const change_rate = overall_avg === 0 ? 0 : (slope / overall_avg) * 100;

      trends.push({
        subject,
        trend: classify_trend(change_rate),
        recent_average: Math.round(recent_avg * 100) / 100,
        overall_average: Math.round(overall_avg * 100) / 100,
        change_rate: Math.round(change_rate * 100) / 100,
        score_count: count,
      });
    }

    return trends;
  };

  // --- Report generation ---

  const generate_student_report = (student_id: string): StudentReport | null => {
    const student = get_student(student_id);
    if (!student) return null;

    const trends = analyze_trends(student_id);

    // Identify strengths: improving or high recent average (>= 80%)
    const strengths: string[] = trends
      .filter(t =>
        t.score_count >= MIN_SCORES_FOR_TREND &&
        (t.trend === 'improving' || t.recent_average >= HIGH_SCORE_THRESHOLD),
      )
      .map(t => t.subject);

    // Identify weaknesses: declining or low recent average (< 60%)
    const weaknesses: string[] = trends
      .filter(t =>
        t.score_count >= MIN_SCORES_FOR_TREND &&
        (t.trend === 'declining' || t.recent_average < LOW_SCORE_THRESHOLD),
      )
      .map(t => t.subject);

    // Generate recommendations based on analysis
    const recommendations: string[] = [];

    for (const t of trends) {
      if (t.score_count < MIN_SCORES_FOR_TREND) continue;

      if (t.trend === 'declining' && t.recent_average < LOW_SCORE_THRESHOLD) {
        recommendations.push(
          `${t.subject}: 최근 성적이 하락세입니다 (평균 ${t.recent_average}%). 기초 개념 복습과 추가 연습이 필요합니다.`,
        );
      } else if (t.trend === 'declining') {
        recommendations.push(
          `${t.subject}: 성적이 소폭 하락하고 있습니다. 취약 단원을 파악하여 집중 보완하세요.`,
        );
      } else if (t.trend === 'improving' && t.recent_average >= HIGH_SCORE_THRESHOLD) {
        recommendations.push(
          `${t.subject}: 우수한 성적을 유지하고 있습니다. 심화 문제에 도전해보세요.`,
        );
      } else if (t.trend === 'stable' && t.recent_average < LOW_SCORE_THRESHOLD) {
        recommendations.push(
          `${t.subject}: 성적이 정체되어 있습니다 (평균 ${t.recent_average}%). 학습 방법을 변경해보는 것을 권장합니다.`,
        );
      }
    }

    // Generate overall summary
    const overall_summary = generate_summary(student, trends, strengths, weaknesses);

    return {
      student,
      generated_at: new Date().toISOString(),
      subject_trends: trends,
      strengths,
      weaknesses,
      recommendations,
      overall_summary,
    };
  };

  return {
    create_student,
    get_student,
    list_students,
    update_student,
    delete_student,
    record_score,
    get_score_history,
    analyze_trends,
    generate_student_report,
  };
};

// === Summary generator (pure function) ===

const generate_summary = (
  student: StudentProfile,
  trends: SubjectTrend[],
  strengths: string[],
  weaknesses: string[],
): string => {
  const active_trends = trends.filter(t => t.score_count >= MIN_SCORES_FOR_TREND);

  if (active_trends.length === 0) {
    return `${student.name} 학생 (${student.grade}, ${format_class_type(student.class_type)})의 시험 데이터가 아직 충분하지 않습니다. 추가 시험 결과가 누적되면 상세 분석이 가능합니다.`;
  }

  const improving_count = active_trends.filter(t => t.trend === 'improving').length;
  const declining_count = active_trends.filter(t => t.trend === 'declining').length;

  const parts: string[] = [];
  parts.push(`${student.name} 학생 (${student.grade}, ${format_class_type(student.class_type)})`);

  if (strengths.length > 0) {
    parts.push(`강점 과목: ${strengths.join(', ')}`);
  }
  if (weaknesses.length > 0) {
    parts.push(`보완 필요 과목: ${weaknesses.join(', ')}`);
  }

  if (improving_count > declining_count) {
    parts.push('전반적으로 성적이 향상되고 있는 추세입니다.');
  } else if (declining_count > improving_count) {
    parts.push('전반적으로 성적이 하락하고 있어 주의가 필요합니다.');
  } else {
    parts.push('전반적으로 안정적인 성적을 유지하고 있습니다.');
  }

  return parts.join('. ') + '.';
};

const format_class_type = (ct: 'regular' | 'ogeum' | 'medical'): string => {
  switch (ct) {
    case 'regular': return '일반반';
    case 'ogeum': return '오금고반';
    case 'medical': return '의대반';
  }
};
