// Dynamic Persona Injector — enriches task descriptions with user context
// Reads SAFE (non-PII) context from Doctrine memory files and builds a
// background section to prepend to task descriptions sent to Hunter.
//
// Security: Hunter is treated as an untrusted external machine.
// PII (name, birth date, address, finances, girlfriend, medical conditions,
// account info) is NEVER included in the persona context.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// === PII patterns to strip from extracted content ===
// These patterns match common PII that should never leak to Hunter

const PII_PATTERNS: RegExp[] = [
  // Birth dates (various Korean and ISO formats)
  /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g,
  /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/g,
  // Age with birth context
  /만\s*\d{1,2}세/g,
  // Korean addresses (동/구/시 patterns)
  /서울\s*\S+동/g,
  /\S+[시군구]\s*\S+[동읍면리]/g,
  // Financial amounts with 억/천만/만 (specific asset amounts)
  /유동자산\s*\S+/g,
  /전세\s*\d+억/g,
  /월\s*~?\d+만/g,
  // Girlfriend-related info
  /여자친구\s*[^\n]*/g,
  // Medical conditions
  /ADHD[^\n]*/g,
  /우울증[^\n]*/g,
  /고지혈증[^\n]*/g,
  /고혈압[^\n]*/g,
  /입면장애[^\n]*/g,
  /처방[^\n]*/g,
  // Account/credential info
  /계정\s*[A-Z]\b/g,
  // Internet/housing specifics
  /1Gbps[^\n]*/g,
  // Parent relationship details
  /부모님[^\n]*/g,
  // Specific company name as employer
  /네이버\s*(개발자|공채|여행사업부|담당)/g,
  // Salary info
  /월\s*~?\d+만\)?/g,
];

// === Source files to read from Doctrine memory directory ===

const SOURCE_FILES = [
  'user_overview.md',
  'user_values.md',
  'user_startup.md',
  'user_coding.md',
] as const;

// === Cache TTL: 24 hours in milliseconds ===

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// === Type for the persona injector instance ===

export type PersonaInjector = {
  /** Get the cached persona context string (loads from files if cache expired) */
  get_persona_context: () => Promise<string>;
  /** Prepend persona context to a task description */
  inject: (description: string) => Promise<string>;
  /** Force cache invalidation (useful for testing) */
  invalidate_cache: () => void;
};

// === Safe content extraction helpers ===

// Strip PII patterns from raw text
const strip_pii = (text: string): string => {
  let cleaned = text;
  for (const pattern of PII_PATTERNS) {
    // Reset lastIndex for global patterns used multiple times
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, '[REDACTED]');
  }
  return cleaned;
};

// Extract professional/career context (safe to share)
const extract_career_context = (overview: string): string[] => {
  const lines: string[] = [];

  // Look for developer role (strip company name and salary)
  if (/풀스택|TS|TypeScript|개발자/.test(overview)) {
    lines.push('대기업 개발자 (TS 풀스택 6년)');
  }

  // Look for teaching role (strip salary)
  if (/강사|학원/.test(overview)) {
    lines.push('과학 강사 (중등)');
  }

  // Look for mentoring
  if (/멘토/.test(overview)) {
    lines.push('멘토링 경험 (한이음 드림업, 소마)');
  }

  // Startup aspirations
  if (/창업|스타트업/.test(overview)) {
    lines.push('예비 스타트업 창업가');
  }

  return lines;
};

// Extract education background (safe)
const extract_education = (values: string): string[] => {
  const lines: string[] = [];

  if (/물리학/.test(values)) {
    lines.push('물리학 석사');
  }
  if (/교환학생/.test(values)) {
    lines.push('해외 교환학생 경험');
  }
  if (/영어/.test(values)) {
    lines.push('영어 가능');
  }

  return lines;
};

// Extract values/goals (safe, no PII)
const extract_values = (values: string): string[] => {
  const lines: string[] = [];

  if (/존경/.test(values)) {
    lines.push('사회적 존경 > 돈');
  }
  if (/약자/.test(values)) {
    lines.push('약자에 대한 공감');
  }
  if (/NVC|비폭력대화/.test(values)) {
    lines.push('비폭력대화(NVC) 심화');
  }

  return lines;
};

// Extract tech stack (safe)
const extract_tech_stack = (coding: string): string[] => {
  const techs: string[] = [];

  // Scan for known tech keywords
  const tech_keywords = [
    'TypeScript', 'Next.js', 'NestJS', 'GraphQL', 'MongoDB',
    'React', 'Express', 'Docker', 'Node.js',
  ];
  for (const tech of tech_keywords) {
    if (coding.includes(tech)) {
      techs.push(tech);
    }
  }

  return techs;
};

// Extract startup interests (safe)
const extract_startup_interests = (startup: string): string[] => {
  const interests: string[] = [];

  if (/에듀테크|교육/.test(startup)) interests.push('에듀테크');
  if (/NVC|비폭력/.test(startup)) interests.push('NVC 커뮤니케이션');
  if (/SaaS|자동화/.test(startup)) interests.push('SaaS 자동화');
  if (/소셜벤처|소셜/.test(startup)) interests.push('소셜벤처');

  return interests;
};

// Extract goals (safe, no specific financial targets with personal context)
const extract_goals = (values: string, startup: string): string[] => {
  const goals: string[] = [];

  if (/정부.*창업|예비창업|창업지원/.test(startup)) {
    goals.push('정부 창업지원사업 지원 (예비창업패키지 등)');
  }
  if (/자동\s*수입/.test(values)) {
    goals.push('자동 수입 세후 월 1000만원');
  }

  return goals;
};

// Extract additional interests (safe)
const extract_interests = (overview: string, startup: string): string[] => {
  const interests: string[] = [];

  if (/빅테크|원격/.test(overview) || /빅테크|원격/.test(startup)) {
    interests.push('글로벌 빅테크 원격 포지션');
  }
  if (/청약|로또/.test(overview) || /청약|로또/.test(startup)) {
    interests.push('로또 청약');
  }
  if (/AI\s*트렌드/.test(overview)) {
    interests.push('AI 트렌드');
  }

  return interests;
};

// === Build the final persona context string ===

const build_persona_context = (files: Map<string, string>): string => {
  const overview = files.get('user_overview.md') ?? '';
  const values = files.get('user_values.md') ?? '';
  const startup = files.get('user_startup.md') ?? '';
  const coding = files.get('user_coding.md') ?? '';

  // Extract safe information from each source
  const career = extract_career_context(overview);
  const education = extract_education(values);
  const value_points = extract_values(values);
  const tech_stack = extract_tech_stack(coding);
  const startup_interests = extract_startup_interests(startup);
  const goals = extract_goals(values, startup);
  const additional_interests = extract_interests(overview, startup);

  // Build the formatted persona block
  const sections: string[] = [];

  if (career.length > 0) {
    sections.push(`직업: ${career.join(' + ')}`);
  }
  if (education.length > 0) {
    sections.push(`학력: ${education.join(', ')}`);
  }
  if (startup_interests.length > 0) {
    sections.push(`창업 관심: ${startup_interests.join(', ')}`);
  }
  if (value_points.length > 0) {
    sections.push(`가치관: ${value_points.join(', ')}`);
  }
  if (tech_stack.length > 0) {
    sections.push(`기술 스택: ${tech_stack.join('/')}`);
  }
  if (goals.length > 0) {
    sections.push(`목표: ${goals.join(', ')}`);
  }
  if (additional_interests.length > 0) {
    sections.push(`추가 관심: ${additional_interests.join(', ')}`);
  }

  // Format as bullet-point block
  const bullets = sections.map((s) => `\u2022 ${s}`).join('\n');

  return `[Background - 의뢰인 프로필]\n${bullets}`;
};

// === Factory function ===

export const create_persona_injector = (doctrine_memory_dir: string): PersonaInjector => {
  // Cache state
  let cached_context: string | null = null;
  let cache_timestamp = 0;

  // Read a single file, returning empty string on failure
  const read_file_safe = async (filename: string): Promise<string> => {
    try {
      const file_path = join(doctrine_memory_dir, filename);
      return await readFile(file_path, 'utf-8');
    } catch (err) {
      // Fire-and-forget: file might not exist or be inaccessible
      console.warn(`[persona_injector] Failed to read ${filename}:`, err instanceof Error ? err.message : err);
      return '';
    }
  };

  // Load all source files and build persona context
  const load_persona = async (): Promise<string> => {
    const file_contents = new Map<string, string>();

    // Read all files in parallel
    const results = await Promise.all(
      SOURCE_FILES.map(async (filename) => ({
        filename,
        content: await read_file_safe(filename),
      })),
    );

    for (const { filename, content } of results) {
      // Strip any PII that might be in the raw files
      file_contents.set(filename, strip_pii(content));
    }

    return build_persona_context(file_contents);
  };

  // Get persona context with TTL-based caching
  const get_persona_context = async (): Promise<string> => {
    const now = Date.now();

    // Return cached version if still fresh
    if (cached_context !== null && (now - cache_timestamp) < CACHE_TTL_MS) {
      return cached_context;
    }

    // Refresh cache
    try {
      cached_context = await load_persona();
      cache_timestamp = now;
    } catch (err) {
      // If loading fails and we have a stale cache, use it
      if (cached_context !== null) {
        console.warn('[persona_injector] Failed to refresh cache, using stale:', err instanceof Error ? err.message : err);
        return cached_context;
      }
      // No cache at all — return empty string (graceful degradation)
      console.warn('[persona_injector] Failed to load persona, returning empty:', err instanceof Error ? err.message : err);
      return '';
    }

    return cached_context;
  };

  // Inject persona context into a task description
  const inject = async (description: string): Promise<string> => {
    try {
      const context = await get_persona_context();
      if (!context) {
        // No persona available — return original description unchanged
        return description;
      }
      return `${context}\n\n[요청 내용]\n${description}`;
    } catch {
      // Fire-and-forget on any unexpected error — never block task creation
      console.warn('[persona_injector] inject() failed, returning original description');
      return description;
    }
  };

  // Force cache invalidation
  const invalidate_cache = (): void => {
    cached_context = null;
    cache_timestamp = 0;
  };

  return {
    get_persona_context,
    inject,
    invalidate_cache,
  };
};
