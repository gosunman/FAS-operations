// Investment Tracker — tracks government grants, startup competitions, angel/VC opportunities
// Purpose: proactively discover and monitor investment/grant opportunities for developer/startup founder.
// Stateless config + filtering logic. Actual crawling delegated to hunter or gemini.

// === Types ===

export type InvestmentCategory =
  | 'government_grant'    // 정부지원사업
  | 'startup_competition' // 창업 경진대회
  | 'angel_investment'    // 엔젤 투자
  | 'vc_round'            // VC 투자 라운드
  | 'accelerator'         // 액셀러레이터
  | 'incubator';          // 인큐베이터

export type EligibilityCriteria = {
  max_age: number | null;             // null = no age limit
  required_experience_years: number | null; // null = no requirement
  requires_incorporation: boolean;    // whether a registered business is required
  team_size_min: number | null;       // null = no minimum
  team_size_max: number | null;       // null = no maximum
  allowed_sectors: string[];          // empty = all sectors
  regional_restriction: string | null; // null = nationwide
  notes: string;                      // additional eligibility notes
};

export type InvestmentOpportunity = {
  id: string;
  name: string;
  organization: string;             // 주관기관
  deadline: string | null;          // YYYY-MM-DD, null = rolling or TBD
  amount_range: {
    min: number;                    // in 만원 (10,000 KRW)
    max: number;
  };
  eligibility: EligibilityCriteria;
  url: string;
  category: InvestmentCategory;
  description: string;
  notes: string;
};

export type InvestmentReport = {
  opportunities: InvestmentOpportunity[];
  summary: string;
  generated_at: string;
};

export type UserProfile = {
  age: number;
  experience_years: number;
  has_incorporation: boolean;
  team_size: number;
  sectors: string[];
  region: string;
};

// === Known Investment Programs (Korean startup ecosystem) ===

export const TRACKED_INVESTMENTS: InvestmentOpportunity[] = [
  {
    id: 'kised_preliminary',
    name: '예비창업패키지',
    organization: 'KISED (창업진흥원)',
    deadline: '2026-03-24',
    amount_range: { min: 1000, max: 5000 },   // 1천만~5천만원
    eligibility: {
      max_age: null,
      required_experience_years: null,
      requires_incorporation: false,          // 예비창업자 대상 (미등록 가능)
      team_size_min: null,
      team_size_max: null,
      allowed_sectors: [],                    // all sectors
      regional_restriction: null,
      notes: '사업자등록 없는 예비창업자 대상. 선정 후 3개월 내 사업자등록 필요.',
    },
    url: 'https://www.k-startup.go.kr/',
    category: 'government_grant',
    description: '예비창업자를 위한 사업화 자금 지원. 시제품 제작, 마케팅, 지재권 등.',
    notes: '매년 3-4월 공고. 매우 경쟁적 (약 10:1). 서류+발표 평가.',
  },
  {
    id: 'kised_early_stage',
    name: '초기창업패키지',
    organization: 'KISED (창업진흥원)',
    deadline: '2026-04-15',
    amount_range: { min: 3000, max: 10000 },  // 3천만~1억원
    eligibility: {
      max_age: null,
      required_experience_years: null,
      requires_incorporation: true,           // 3년 이내 사업자
      team_size_min: null,
      team_size_max: null,
      allowed_sectors: [],
      regional_restriction: null,
      notes: '창업 3년 이내 기업 대상. 사업자등록 필수.',
    },
    url: 'https://www.k-startup.go.kr/',
    category: 'government_grant',
    description: '초기 창업기업 사업화 자금 지원. BM 검증, 시제품 고도화, 마케팅.',
    notes: '예비창업패키지보다 지원 규모가 크고 요구 수준도 높음.',
  },
  {
    id: 'kised_growth',
    name: '창업도약패키지',
    organization: 'KISED (창업진흥원)',
    deadline: '2026-05-30',
    amount_range: { min: 10000, max: 30000 }, // 1억~3억원
    eligibility: {
      max_age: null,
      required_experience_years: null,
      requires_incorporation: true,           // 3-7년차 기업
      team_size_min: null,
      team_size_max: null,
      allowed_sectors: [],
      regional_restriction: null,
      notes: '창업 3-7년차 기업 대상. 매출 실적 보유 기업 우대.',
    },
    url: 'https://www.k-startup.go.kr/',
    category: 'government_grant',
    description: '성장단계 창업기업의 스케일업 지원. 사업 고도화, 해외 진출 등.',
    notes: '최대 3억원. 경쟁률 높음. 매출/성장성 중심 평가.',
  },
  {
    id: 'social_venture',
    name: '소셜벤처 육성사업',
    organization: '중소벤처기업부 / 한국사회적기업진흥원',
    deadline: '2026-04-30',
    amount_range: { min: 1000, max: 5000 },   // 1천만~5천만원
    eligibility: {
      max_age: null,
      required_experience_years: null,
      requires_incorporation: false,
      team_size_min: null,
      team_size_max: null,
      allowed_sectors: ['social_impact', 'education', 'environment', 'health', 'culture'],
      regional_restriction: null,
      notes: '사회문제 해결을 목적으로 하는 소셜벤처 대상. 소셜 임팩트 측정 필요.',
    },
    url: 'https://www.socialenterprise.or.kr/',
    category: 'government_grant',
    description: '사회적 가치 창출 목적의 소셜벤처 육성. 사업화 자금+멘토링.',
    notes: '소셜 임팩트 중심 사업. NVC/교육 관련 아이디어에 적합.',
  },
  {
    id: 'youth_startup_academy',
    name: '청년창업사관학교',
    organization: '중소벤처기업부 / 창업진흥원',
    deadline: '2026-02-28',
    amount_range: { min: 5000, max: 10000 },  // 5천만~1억원
    eligibility: {
      max_age: 39,
      required_experience_years: null,
      requires_incorporation: false,
      team_size_min: null,
      team_size_max: null,
      allowed_sectors: [],
      regional_restriction: null,
      notes: '만 39세 이하 청년 창업자. 입주형 프로그램 (공간 제공). 1년 과정.',
    },
    url: 'https://start.kosmes.or.kr/',
    category: 'accelerator',
    description: '청년 창업자 대상 1년 입주형 프로그램. 자금+공간+멘토링 통합 지원.',
    notes: '입주형이므로 해당 지역 출퇴근 필요. 전국 17개 센터.',
  },
];

// === Utility: calculate days until deadline ===

export const calculate_days_until = (deadline: string, today: Date = new Date()): number => {
  const [year, month, day] = deadline.split('-').map(Number);
  const deadline_date = new Date(year, month - 1, day);
  const today_midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff_ms = deadline_date.getTime() - today_midnight.getTime();
  return Math.round(diff_ms / (1000 * 60 * 60 * 24));
};

// === Get all tracked investments ===

export const get_tracked_investments = (
  investments: readonly InvestmentOpportunity[] = TRACKED_INVESTMENTS,
): InvestmentOpportunity[] => {
  // Return a mutable copy sorted by category, then by deadline ascending
  return [...investments].sort((a, b) => {
    // Category grouping
    const cat_diff = a.category.localeCompare(b.category);
    if (cat_diff !== 0) return cat_diff;

    // Programs with deadlines come before those without
    if (a.deadline && !b.deadline) return -1;
    if (!a.deadline && b.deadline) return 1;
    if (!a.deadline && !b.deadline) return 0;

    // Earlier deadline first
    return a.deadline!.localeCompare(b.deadline!);
  });
};

// === Get investments with deadlines within N days ===

export const get_upcoming_deadlines = (
  days: number,
  today: Date = new Date(),
  investments: readonly InvestmentOpportunity[] = TRACKED_INVESTMENTS,
): InvestmentOpportunity[] => {
  return [...investments]
    .filter((inv) => {
      if (!inv.deadline) return false;
      const remaining = calculate_days_until(inv.deadline, today);
      return remaining >= 0 && remaining <= days;
    })
    .sort((a, b) => {
      // Sort by urgency: fewer days remaining first
      const days_a = calculate_days_until(a.deadline!, today);
      const days_b = calculate_days_until(b.deadline!, today);
      return days_a - days_b;
    });
};

// === Check eligibility against user profile ===

export const check_eligibility = (
  profile: UserProfile,
  investments: readonly InvestmentOpportunity[] = TRACKED_INVESTMENTS,
): InvestmentOpportunity[] => {
  return [...investments].filter((inv) => {
    const elig = inv.eligibility;

    // Age check
    if (elig.max_age !== null && profile.age > elig.max_age) return false;

    // Experience check
    if (
      elig.required_experience_years !== null &&
      profile.experience_years < elig.required_experience_years
    ) {
      return false;
    }

    // Incorporation check
    if (elig.requires_incorporation && !profile.has_incorporation) return false;

    // Team size check
    if (elig.team_size_min !== null && profile.team_size < elig.team_size_min) return false;
    if (elig.team_size_max !== null && profile.team_size > elig.team_size_max) return false;

    // Sector check (empty allowed_sectors = all sectors allowed)
    if (elig.allowed_sectors.length > 0) {
      const has_match = profile.sectors.some((s) => elig.allowed_sectors.includes(s));
      if (!has_match) return false;
    }

    // Regional check
    if (elig.regional_restriction !== null && profile.region !== elig.regional_restriction) {
      return false;
    }

    return true;
  });
};

// === Generate formatted markdown investment report ===

export const generate_investment_report = (
  today: Date = new Date(),
  investments: readonly InvestmentOpportunity[] = TRACKED_INVESTMENTS,
): InvestmentReport => {
  const now = new Date().toISOString();
  const date_str = now.split('T')[0];
  const sorted = get_tracked_investments(investments);

  const lines: string[] = [];
  lines.push(`=== Investment Opportunity Report (${date_str}) ===`);
  lines.push('Purpose: track government grants, competitions, and investment opportunities');
  lines.push(`Total: ${sorted.length} opportunities tracked`);
  lines.push('');

  // Section 1: Upcoming deadlines (within 30 days)
  const upcoming = get_upcoming_deadlines(30, today, investments);
  if (upcoming.length > 0) {
    lines.push('--- Upcoming Deadlines (30 days) ---');
    lines.push('');
    for (const inv of upcoming) {
      const days = calculate_days_until(inv.deadline!, today);
      const urgency = days <= 3 ? '🚨' : days <= 7 ? '⚠️' : 'ℹ️';
      lines.push(`  ${urgency} [${inv.organization}] ${inv.name}`);
      lines.push(`    Deadline: ${inv.deadline} (D-${days})`);
      lines.push(`    Amount: ${inv.amount_range.min.toLocaleString()}만 ~ ${inv.amount_range.max.toLocaleString()}만원`);
      lines.push(`    Category: ${inv.category}`);
      lines.push(`    URL: ${inv.url}`);
      lines.push('');
    }
  } else {
    lines.push('--- No upcoming deadlines within 30 days ---');
    lines.push('');
  }

  // Section 2: All opportunities overview
  lines.push('--- All Tracked Opportunities ---');
  lines.push('');

  // Group by category
  const categories = [...new Set(sorted.map((inv) => inv.category))];
  for (const cat of categories) {
    const group = sorted.filter((inv) => inv.category === cat);
    lines.push(`[${cat}] (${group.length})`);
    lines.push('');

    for (const inv of group) {
      const deadline_info = inv.deadline
        ? `Deadline: ${inv.deadline} (D-${calculate_days_until(inv.deadline, today)})`
        : 'Deadline: Rolling / TBD';
      lines.push(`  [${inv.organization}] ${inv.name}`);
      lines.push(`    ${deadline_info}`);
      lines.push(`    Amount: ${inv.amount_range.min.toLocaleString()}만 ~ ${inv.amount_range.max.toLocaleString()}만원`);
      lines.push(`    Eligibility: ${inv.eligibility.notes}`);
      if (inv.notes) {
        lines.push(`    Notes: ${inv.notes}`);
      }
      lines.push(`    URL: ${inv.url}`);
      lines.push('');
    }
  }

  return {
    opportunities: sorted,
    summary: lines.join('\n'),
    generated_at: now,
  };
};
