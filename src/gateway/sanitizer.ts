// Personal information sanitizer for FAS
// Removes PII before sending tasks to Hunter (isolated device)
// Stage 1: Regex-based pattern matching (fast, deterministic)
// Stage 2: LLM-based contextual filtering (TODO: future)

import type { Task } from '../shared/types.js';

// === PII patterns (Korean-focused) ===

type SanitizePattern = {
  name: string;
  regex: RegExp;
  replacement: string;
};

const PII_PATTERNS: SanitizePattern[] = [
  // Korean names with label (e.g., "이름: 홍길동")
  {
    name: 'labeled_korean_name',
    regex: /(이름|성명|본명)[:：]\s*[가-힣]{2,4}/gi,
    replacement: '$1: [이름 제거됨]',
  },
  // Korean resident registration numbers (주민번호) — must be before phone numbers
  // to avoid partial match (13 digits without hyphen)
  {
    name: 'resident_id',
    regex: /\d{6}-?[1-4]\d{6}/g,
    replacement: '[주민번호 제거됨]',
  },
  // Phone numbers (010-xxxx-xxxx variants)
  {
    name: 'phone_number',
    regex: /01[016789]-?\d{3,4}-?\d{4}/g,
    replacement: '[전화번호 제거됨]',
  },
  // Email addresses
  {
    name: 'email',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[이메일 제거됨]',
  },
  // Korean addresses (시/도 + 시/군/구)
  {
    name: 'address',
    regex: /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[시도]?\s+[가-힣]+[시군구]/g,
    replacement: '[주소 제거됨]',
  },
  // Credit card numbers (4 groups of 4 digits) — must be before bank_account
  {
    name: 'credit_card',
    regex: /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/g,
    replacement: '[카드번호 제거됨]',
  },
  // IP addresses (private/Tailscale ranges) — must be before bank_account
  {
    name: 'ip_address',
    regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[0-2]\d)\.\d{1,3}\.\d{1,3})\b/g,
    replacement: '[IP 제거됨]',
  },
  // Bank account numbers (3-4 digit groups with hyphens)
  {
    name: 'bank_account',
    regex: /\d{3,4}-\d{2,6}-\d{2,6}/g,
    replacement: '[계좌 제거됨]',
  },
  // Financial amounts with labels
  {
    name: 'financial_amount',
    regex: /(자산|현금|예금|보증금|연봉|월급)[:：]?\s*[약~]?\s*\d+[만억천]/g,
    replacement: '[금융정보 제거됨]',
  },
  // Internal/private URLs and hostnames (*.local, *.internal, *.ts.net, localhost)
  {
    name: 'internal_url',
    regex: /https?:\/\/(?:localhost|[\w.-]+\.(?:local|internal|tailnet|ts\.net))(?::\d+)?(?:\/[^\s]*)?/gi,
    replacement: '[내부URL 제거됨]',
  },
];

// === Sanitize text ===

export const sanitize_text = (text: string): string => {
  let result = text;
  for (const pattern of PII_PATTERNS) {
    result = result.replace(pattern.regex, pattern.replacement);
  }
  return result;
};

// === Sanitize a task for Hunter (whitelist approach) ===
// Only explicitly safe fields are included. New fields are excluded by default.

export type HunterSafeTask = {
  id: string;
  title: string;
  description?: string;
  priority: Task['priority'];
  mode: Task['mode'];
  risk_level: Task['risk_level'];
  status: Task['status'];
  deadline: string | null;
};

export const sanitize_task = (task: Task): HunterSafeTask => ({
  id: task.id,
  title: sanitize_text(task.title),
  description: task.description ? sanitize_text(task.description) : undefined,
  priority: task.priority,
  mode: task.mode,
  risk_level: task.risk_level,
  status: task.status,
  deadline: task.deadline,
});

// === Check if text contains PII ===

export const contains_pii = (text: string): boolean => {
  return PII_PATTERNS.some((pattern) => pattern.regex.test(text));
};

// === Get detected PII types in text ===

export const detect_pii_types = (text: string): string[] => {
  return PII_PATTERNS
    .filter((pattern) => {
      // Reset lastIndex for global regex
      pattern.regex.lastIndex = 0;
      return pattern.regex.test(text);
    })
    .map((pattern) => pattern.name);
};
