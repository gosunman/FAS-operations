// Personal information sanitizer for FAS
// Removes PII before sending tasks to Hunter (isolated device)
// Stage 1: Regex-based pattern matching (fast, deterministic)
// Stage 2: LLM-based contextual filtering (TODO: future)

import type { Task } from '../shared/types.js';

// === PII patterns (Korean-focused) ===

// Severity levels for PII detection:
// - critical: Must quarantine for human review (identity-revealing data)
// - warning: Auto-sanitize and pass through with a log warning (contextual/low-risk data)
type PiiSeverity = 'critical' | 'warning';

type SanitizePattern = {
  name: string;
  regex: RegExp;
  replacement: string;
  severity: PiiSeverity;
};

const PII_PATTERNS: SanitizePattern[] = [
  // Korean names with label (e.g., "이름: 홍길동")
  {
    name: 'labeled_korean_name',
    regex: /(이름|성명|본명)[:：]\s*[가-힣]{2,4}/gi,
    replacement: '$1: [이름 제거됨]',
    severity: 'critical',
  },
  // Korean resident registration numbers (주민번호) — must be before phone numbers
  // Format: YYMMDD-[1-4]XXXXXX (with hyphen) or YYMMDD[1-4]XXXXXX (13 digits, no hyphen)
  // Lookbehind/lookahead prevents matching inside longer numeric strings (UUIDs, hashes, etc.)
  {
    name: 'resident_id',
    regex: /(?<![0-9a-fA-F-])\d{6}-[1-4]\d{6}(?!\d)|(?<!\d)\d{6}[1-4]\d{6}(?!\d)/g,
    replacement: '[주민번호 제거됨]',
    severity: 'critical',
  },
  // Phone numbers (010-xxxx-xxxx variants, with optional spaces around hyphens)
  {
    name: 'phone_number',
    regex: /01[016789]\s*-?\s*\d{3,4}\s*-?\s*\d{4}/g,
    replacement: '[전화번호 제거됨]',
    severity: 'critical',
  },
  // Email addresses
  {
    name: 'email',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[이메일 제거됨]',
    severity: 'warning',
  },
  // Korean addresses (시/도 + 시/군/구 + 동/로/길/읍/면/리)
  // Requires sub-district or road name to avoid false positives on general area mentions
  // e.g., "서울시 강남구" alone won't match, but "서울시 강남구 역삼동" will
  {
    name: 'address',
    regex: /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[시도]?\s+[가-힣]+[시군구]\s+[가-힣]+[동로길읍면리]/g,
    replacement: '[주소 제거됨]',
    severity: 'warning',
  },
  // Credit card numbers (4 groups of 4 digits, with optional spaces) — must be before bank_account
  {
    name: 'credit_card',
    regex: /\b\d{4}\s*[- ]\s*\d{4}\s*[- ]\s*\d{4}\s*[- ]\s*\d{4}\b/g,
    replacement: '[카드번호 제거됨]',
    severity: 'critical',
  },
  // IP addresses (private/Tailscale ranges) — must be before bank_account
  {
    name: 'ip_address',
    regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[0-2]\d)\.\d{1,3}\.\d{1,3})\b/g,
    replacement: '[IP 제거됨]',
    severity: 'warning',
  },
  // Bank account numbers (3-4 digit groups with hyphens, with optional spaces)
  // Last group requires 4+ digits to avoid matching date patterns like YYYY-MM-DD (4-2-2)
  {
    name: 'bank_account',
    regex: /\d{3,4}\s*-\s*\d{2,6}\s*-\s*\d{4,6}/g,
    replacement: '[계좌 제거됨]',
    severity: 'warning',
  },
  // Financial amounts with labels
  {
    name: 'financial_amount',
    regex: /(자산|현금|예금|보증금|연봉|월급)[:：]?\s*[약~]?\s*\d+[만억천]/g,
    replacement: '[금융정보 제거됨]',
    severity: 'warning',
  },
  // Internal/private URLs and hostnames (*.local, *.internal, *.ts.net, localhost)
  {
    name: 'internal_url',
    regex: /https?:\/\/(?:localhost|[\w.-]+\.(?:local|internal|tailnet|ts\.net))(?::\d+)?(?:\/[^\s]*)?/gi,
    replacement: '[내부URL 제거됨]',
    severity: 'warning',
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
  return PII_PATTERNS.some((pattern) => {
    // Reset lastIndex for global regex to avoid stateful matching bugs
    pattern.regex.lastIndex = 0;
    return pattern.regex.test(text);
  });
};

// === Check if text contains critical-severity PII (quarantine-worthy) ===

export const contains_critical_pii = (text: string): boolean => {
  return PII_PATTERNS
    .filter((p) => p.severity === 'critical')
    .some((pattern) => {
      pattern.regex.lastIndex = 0;
      return pattern.regex.test(text);
    });
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

// === Get detected PII types with severity ===

export type PiiDetection = {
  name: string;
  severity: PiiSeverity;
};

export const detect_pii_with_severity = (text: string): PiiDetection[] => {
  return PII_PATTERNS
    .filter((pattern) => {
      pattern.regex.lastIndex = 0;
      return pattern.regex.test(text);
    })
    .map((pattern) => ({ name: pattern.name, severity: pattern.severity }));
};

// ============================================================
// Stage 2: LLM-based contextual PII filtering (Phase 2)
// ============================================================
// Regex can't catch contextual PII like "서울대 91년생 물리 석사 출신".
// This stage uses Gemini CLI to detect and mask such patterns.
// Design principles:
//   - Graceful fallback: if Gemini is unavailable, return text as-is
//   - No shell injection: uses execFile (not exec) with args array
//   - Timeout protection: AbortController with configurable timeout
//   - Chaining: sanitize_full() = regex first, then LLM second

import { execFile } from 'node:child_process';

// === Constants for contextual sanitization ===

const CONTEXTUAL_TIMEOUT_MS = 30_000; // 30 seconds — LLM calls shouldn't take longer
const GEMINI_COMMAND = 'gemini';

// === Build the prompt for Gemini contextual PII detection ===
// The prompt instructs Gemini to return ONLY the sanitized text, nothing else.
// This makes parsing trivial — the entire stdout IS the result.

const build_contextual_pii_prompt = (text: string): string => {
  return [
    'You are a PII (Personal Identifiable Information) sanitizer.',
    'Your job is to detect and mask contextual PII that regex cannot catch.',
    '',
    'Contextual PII includes:',
    '- Specific university/school names combined with degree info (e.g., "서울대 물리학과 석사")',
    '- Birth year or age indicators (e.g., "91년생", "30대")',
    '- Workplace descriptions specific enough to identify someone (e.g., "강남 N사 개발자")',
    '- Combinations of traits that narrow down identity (school + major + birth year)',
    '- Neighborhood-level location + profession combos',
    '',
    'Masking format: Replace each PII fragment with a Korean tag in square brackets:',
    '- University/school → [학력정보 제거됨]',
    '- Age/birth year → [나이정보 제거됨]',
    '- Workplace → [직장정보 제거됨]',
    '- Location (when identifying) → [지역정보 제거됨]',
    '- Other identifying context → [개인정보 제거됨]',
    '',
    'Rules:',
    '1. Return ONLY the sanitized text. No explanations, no JSON, no markdown.',
    '2. If no contextual PII is found, return the text exactly as-is.',
    '3. Preserve all non-PII text, punctuation, and formatting exactly.',
    '4. Do NOT mask general/public information (e.g., "한국", "개발자", "IT 업계").',
    '5. Already-masked tokens like [이름 제거됨] should be left untouched.',
    '',
    'Text to sanitize:',
    text,
  ].join('\n');
};

// === Strip ANSI escape codes from CLI output ===

const strip_ansi = (text: string): string => {
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
};

// === Call Gemini CLI via execFile (no shell injection) ===
// Returns sanitized text on success, or null on any failure.

const call_gemini_for_pii = (text: string): Promise<string | null> => {
  return new Promise((resolve) => {
    const prompt = build_contextual_pii_prompt(text);

    // Use execFile with args array — safe from shell injection
    // Gemini CLI accepts prompt as positional argument
    execFile(
      GEMINI_COMMAND,
      [prompt],
      {
        timeout: CONTEXTUAL_TIMEOUT_MS,
        maxBuffer: 1024 * 1024, // 1MB — generous for text sanitization
        encoding: 'utf-8',
      },
      (error, stdout, _stderr) => {
        if (error) {
          // Any error (timeout, crash, not found) → return null for fallback
          resolve(null);
          return;
        }

        const cleaned = strip_ansi(stdout).trim();

        // Empty output is unreliable — treat as failure
        if (!cleaned) {
          resolve(null);
          return;
        }

        resolve(cleaned);
      },
    );
  });
};

// === Public API: Contextual PII sanitization via LLM ===
// Falls back gracefully to returning original text on any failure.

export const sanitize_contextual_pii = async (text: string): Promise<string> => {
  // Skip empty/whitespace-only text — no point calling LLM
  if (!text.trim()) {
    return text;
  }

  const result = await call_gemini_for_pii(text);

  // null means Gemini failed — fall back to original text
  // This ensures the pipeline never crashes due to LLM unavailability
  return result ?? text;
};

// === Public API: Full sanitization pipeline (regex + LLM) ===
// Chains Stage 1 (regex, fast/deterministic) then Stage 2 (LLM, contextual).
// If Stage 2 fails, Stage 1 result is still applied — partial protection > none.

export const sanitize_full = async (text: string): Promise<string> => {
  // Stage 1: Regex-based sanitization (always runs, never fails)
  const regex_sanitized = sanitize_text(text);

  // Skip LLM for empty text
  if (!regex_sanitized.trim()) {
    return regex_sanitized;
  }

  // Stage 2: LLM-based contextual sanitization
  // Input is already regex-sanitized, so LLM only needs to handle contextual PII
  const fully_sanitized = await sanitize_contextual_pii(regex_sanitized);

  return fully_sanitized;
};
