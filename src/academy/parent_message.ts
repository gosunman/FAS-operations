// Parent message auto-generation module for EIDOS SCIENCE academy
// Generates structured SMS-friendly messages to parents after each class
// Template-based — no external AI API calls

// === Types ===

export type StudentContext = {
  name: string;
  grade: string; // e.g. "고1", "고2", "중3"
  class_type: 'regular' | 'ogeum' | 'medical'; // 일반반/오금고반/의대반
  subjects: string[];
  recent_scores?: { subject: string; score: number; max_score: number }[];
  attendance_note?: string;
  previous_memo?: string; // last class memo
};

export type ClassKeywords = {
  date: string; // ISO date
  topics_covered: string[];
  performance_keywords: string[]; // e.g. ["집중력 좋음", "미적분 약함", "질문 많이 함"]
  homework?: string;
  next_class_note?: string;
};

export type ToneConfig = {
  formality: 'formal' | 'semi_formal';
  warmth: 'professional' | 'caring' | 'enthusiastic';
  language: 'ko';
};

export type ParentMessage = {
  greeting: string;
  body: string;
  closing: string;
  full_text: string;
  char_count: number;
};

// === Constants ===

const DEFAULT_TONE: ToneConfig = {
  formality: 'formal',
  warmth: 'caring',
  language: 'ko',
};

// Words considered inappropriate in parent communication
const INAPPROPRIATE_PATTERNS: RegExp[] = [
  /멍청/,
  /바보/,
  /못난/,
  /한심/,
  /최악/,
  /게으[르른]/,
  /짜증/,
  /싫[어은]/,
  /못하[는겠]/,
  /무능/,
  /쓸모없/,
  /꼴불견/,
  /답답/,
  /어이없/,
  /기가 막[히혀]/,
];

// Slang/casual patterns to filter in formal mode
const SLANG_PATTERNS: RegExp[] = [
  /ㅋㅋ+/g,
  /ㅎㅎ+/g,
  /대박/g,
  /완전/g,
  /진짜/g,
  /개[좋나쩔웃]/g,
  /ㄹㅇ/g,
  /ㅇㅇ/g,
];

// === Internal helpers ===

// Format the date for display (YYYY-MM-DD -> M월 D일)
const format_date_korean = (iso_date: string): string => {
  const date = new Date(iso_date);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
};

// Join items in Korean natural listing format
const join_korean_list = (items: string[]): string => {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]}과(와) ${items[1]}`;
  // For 3+ items, limit to first 4 to keep message short
  const display_items = items.slice(0, 4);
  const last = display_items.pop()!;
  const rest = display_items.join(', ');
  const suffix = items.length > 4 ? ' 등' : '';
  return `${rest}, ${last}${suffix}`;
};

// Build the greeting section
const build_greeting = (student: StudentContext): string => {
  return `안녕하세요, ${student.name} 학부모님.`;
};

// Build the body section from student context and class keywords
const build_body = (student: StudentContext, keywords: ClassKeywords): string => {
  const parts: string[] = [];

  // Topic coverage
  const date_str = format_date_korean(keywords.date);
  const topics_str = join_korean_list(keywords.topics_covered);
  parts.push(`${date_str} 수업에서 ${topics_str}을(를) 학습하였습니다.`);

  // Performance keywords
  if (keywords.performance_keywords.length > 0) {
    const perf_str = keywords.performance_keywords.join(', ');
    parts.push(`${student.name} 학생은 ${perf_str} 등의 모습을 보여주었습니다.`);
  }

  // Recent scores
  if (student.recent_scores && student.recent_scores.length > 0) {
    const score_parts = student.recent_scores.map(
      (s) => `${s.subject} ${s.score}/${s.max_score}점`
    );
    parts.push(`최근 성적: ${score_parts.join(', ')}.`);
  }

  // Attendance note
  if (student.attendance_note) {
    parts.push(`출결 참고: ${student.attendance_note}.`);
  }

  // Homework
  if (keywords.homework) {
    parts.push(`과제: ${keywords.homework}.`);
  }

  // Next class note
  if (keywords.next_class_note) {
    parts.push(`안내: ${keywords.next_class_note}.`);
  }

  return parts.join(' ');
};

// Build the closing section
const build_closing = (student: StudentContext, tone: ToneConfig): string => {
  const name = student.name;

  if (tone.warmth === 'enthusiastic') {
    return `${name} 학생의 성장이 정말 기대됩니다! 항상 응원하겠습니다. 감사합니다.`;
  }
  if (tone.warmth === 'caring') {
    return `${name} 학생이 꾸준히 성장할 수 있도록 함께 지도하겠습니다. 감사합니다.`;
  }
  // professional
  return `다음 수업에서도 충실히 지도하겠습니다. 감사합니다.`;
};

// Truncate body to keep full message within char limit
const truncate_to_limit = (
  greeting: string,
  body: string,
  closing: string,
  max_chars: number
): string => {
  const separator = '\n\n';
  const overhead = greeting.length + closing.length + separator.length * 2;
  const max_body_len = max_chars - overhead;

  if (max_body_len <= 0) return body.slice(0, 50);

  if (body.length > max_body_len) {
    // Truncate at last sentence boundary within limit
    const truncated = body.slice(0, max_body_len);
    const last_period = truncated.lastIndexOf('.');
    if (last_period > max_body_len * 0.5) {
      return truncated.slice(0, last_period + 1);
    }
    return truncated;
  }

  return body;
};

// Pad body to meet minimum char count
const pad_to_minimum = (
  student: StudentContext,
  body: string,
  greeting: string,
  closing: string,
  min_chars: number
): string => {
  const separator = '\n\n';
  const current_total = greeting.length + body.length + closing.length + separator.length * 2;

  if (current_total >= min_chars) return body;

  // Add contextual filler based on available info
  const fillers: string[] = [];

  if (student.previous_memo) {
    fillers.push(`지난 수업에서 ${student.previous_memo}에 대해 참고하여 지도하였습니다.`);
  }

  if (student.class_type === 'medical') {
    fillers.push('의대 진학을 목표로 체계적인 학습을 진행하고 있습니다.');
  } else if (student.class_type === 'ogeum') {
    fillers.push('오금고 맞춤형 커리큘럼에 따라 수업을 진행하고 있습니다.');
  }

  fillers.push('앞으로도 학생의 학습 진도와 이해도를 세심하게 관리하겠습니다.');
  fillers.push(`${student.name} 학생의 수업 참여도가 전반적으로 양호합니다.`);

  let padded = body;
  for (const filler of fillers) {
    const new_total =
      greeting.length + padded.length + filler.length + 1 + closing.length + separator.length * 2;
    if (new_total >= min_chars) {
      padded = `${padded} ${filler}`;
      break;
    }
    padded = `${padded} ${filler}`;
  }

  return padded;
};

// === Exported functions ===

/**
 * Generate a structured parent message from student context and class keywords.
 * Default tone: formal + caring + ko.
 * Target: 200-500 chars (SMS-friendly).
 */
export const generate_parent_message = (
  student: StudentContext,
  keywords: ClassKeywords,
  tone: ToneConfig = DEFAULT_TONE
): ParentMessage => {
  const greeting = build_greeting(student);
  let body = build_body(student, keywords);
  const closing = build_closing(student, tone);

  // Apply tone rules to body
  body = apply_tone_rules(body, tone);

  // Ensure within char limits
  const separator = '\n\n';

  // First truncate if too long
  body = truncate_to_limit(greeting, body, closing, 500);

  // Then pad if too short
  body = pad_to_minimum(student, body, greeting, closing, 200);

  const full_text = [greeting, body, closing].join(separator);

  return {
    greeting,
    body,
    closing,
    full_text,
    char_count: full_text.length,
  };
};

/**
 * Apply tone transformation rules to a draft message.
 * - formal: 존댓말, no slang, proper honorifics
 * - caring: mention student effort/growth, positive framing
 */
export const apply_tone_rules = (draft: string, tone: ToneConfig): string => {
  if (!draft) return draft;

  let result = draft;

  // Remove slang in formal mode
  if (tone.formality === 'formal') {
    for (const pattern of SLANG_PATTERNS) {
      result = result.replace(pattern, '');
    }
    // Clean up double spaces from removals
    result = result.replace(/\s{2,}/g, ' ').trim();
  }

  return result;
};

/**
 * Validate a ParentMessage for completeness, char count, and content appropriateness.
 * Returns { valid, issues[] }.
 */
export const validate_message = (
  message: ParentMessage
): { valid: boolean; issues: string[] } => {
  const issues: string[] = [];

  // Check char count range
  if (message.char_count < 200) {
    issues.push('Message too short: must be at least 200 characters.');
  }
  if (message.char_count > 500) {
    issues.push('Message too long: must not exceed 500 characters.');
  }

  // Check char_count matches full_text length
  if (message.char_count !== message.full_text.length) {
    issues.push('char_count does not match full_text length.');
  }

  // Check required sections
  if (!message.greeting || message.greeting.trim().length === 0) {
    issues.push('Missing required section: greeting.');
  }
  if (!message.body || message.body.trim().length === 0) {
    issues.push('Missing required section: body.');
  }
  if (!message.closing || message.closing.trim().length === 0) {
    issues.push('Missing required section: closing.');
  }

  // Check for inappropriate content
  const full_text = message.full_text;
  for (const pattern of INAPPROPRIATE_PATTERNS) {
    if (pattern.test(full_text)) {
      issues.push(`부적절(inappropriate) content detected: ${pattern.source}`);
      break; // One inappropriate match is enough
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
};
