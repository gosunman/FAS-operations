// Idea-to-Business Pipeline — manages the full lifecycle from ideation to growth
// Purpose: track, score, and prioritize business ideas for cashflow generation.
// Stateless: operates on in-memory idea arrays. Persistence delegated to caller.

// === Types ===

export type IdeaStage =
  | 'ideation'     // initial idea, not yet validated
  | 'validation'   // market research / customer interviews
  | 'mvp'          // minimum viable product
  | 'launch'       // product launched, acquiring early users
  | 'growth';      // scaling and optimizing

export const STAGE_ORDER: Record<IdeaStage, number> = {
  ideation: 0,
  validation: 1,
  mvp: 2,
  launch: 3,
  growth: 4,
} as const;

export const STAGE_SEQUENCE: IdeaStage[] = [
  'ideation',
  'validation',
  'mvp',
  'launch',
  'growth',
] as const;

export type IdeaScores = {
  feasibility: number;   // 1-10: how feasible to build with current resources
  revenue: number;       // 1-10: revenue potential
  difficulty: number;    // 1-10: technical/business difficulty (higher = harder)
  brand: number;         // 1-10: brand/reputation value
  automation: number;    // 1-10: how automatable (higher = more passive income potential)
  social: number;        // 1-10: social impact potential
};

export type Idea = {
  id: string;
  name: string;
  description: string;
  stage: IdeaStage;
  scores: IdeaScores;
  next_action: string;
  deadline: string | null;   // YYYY-MM-DD
  notes: string;
  created_at: string;        // ISO date
  updated_at: string;        // ISO date
};

export type PipelineReport = {
  ideas: Idea[];
  summary: string;
  generated_at: string;
};

// === Score weights for ranking (higher = more important) ===
// Revenue and automation weighted highest (passive income goal)
const SCORE_WEIGHTS: Record<keyof IdeaScores, number> = {
  feasibility: 1.5,
  revenue: 2.0,
  difficulty: -1.0,   // negative: higher difficulty = lower weighted score
  brand: 1.0,
  automation: 2.0,
  social: 0.5,
} as const;

// === Pre-populated ideas (from cashflow analysis) ===

export const SEED_IDEAS: Idea[] = [
  {
    id: 'eidos_science',
    name: 'EIDOS SCIENCE 에듀테크',
    description: '과학 교육 플랫폼. AI 기반 문제 생성, 학생 관리, 학부모 소통 자동화.',
    stage: 'mvp',
    scores: {
      feasibility: 9,
      revenue: 7,
      difficulty: 5,
      brand: 6,
      automation: 8,
      social: 8,
    },
    next_action: 'Phase 5 배포 및 베타 테스트',
    deadline: '2026-04-30',
    notes: 'Phase 4 완료. 학원 운영 중이라 실제 사용자 확보 용이.',
    created_at: '2025-06-01T00:00:00Z',
    updated_at: '2026-03-22T00:00:00Z',
  },
  {
    id: 'safely_honest',
    name: 'SafelyHonest NVC 플랫폼',
    description: '비폭력대화(NVC) 기반 소통 훈련 플랫폼. AI 코칭 + 실시간 피드백.',
    stage: 'launch',
    scores: {
      feasibility: 8,
      revenue: 5,
      difficulty: 4,
      brand: 7,
      automation: 7,
      social: 10,
    },
    next_action: '도메인 구매 및 마케팅 시작',
    deadline: null,
    notes: 'v0.2.0 완성, Vercel 배포 완료. 소셜벤처 지원사업 연계 가능.',
    created_at: '2025-09-01T00:00:00Z',
    updated_at: '2026-03-22T00:00:00Z',
  },
  {
    id: 'openclaw',
    name: 'OpenClaw ChatGPT OAuth 프레임워크',
    description: 'ChatGPT Pro 세션을 OAuth 기반으로 공유하는 프레임워크.',
    stage: 'validation',
    scores: {
      feasibility: 7,
      revenue: 6,
      difficulty: 7,
      brand: 5,
      automation: 6,
      social: 3,
    },
    next_action: '보안 검증 및 사용자 테스트',
    deadline: null,
    notes: '헌터 전용 도구로 사용 중. 외부 배포 시 보안 이슈 검토 필요.',
    created_at: '2025-11-01T00:00:00Z',
    updated_at: '2026-03-22T00:00:00Z',
  },
  {
    id: 'ai_tutor_saas',
    name: 'AI 과외 매칭 SaaS',
    description: 'AI 기반 과외/튜터 매칭 및 관리 플랫폼. 수업 자동 스케줄링.',
    stage: 'ideation',
    scores: {
      feasibility: 6,
      revenue: 8,
      difficulty: 6,
      brand: 5,
      automation: 7,
      social: 7,
    },
    next_action: '시장 조사 및 경쟁사 분석',
    deadline: null,
    notes: '학원 운영 경험 활용 가능. 에듀테크 + B2C/B2B.',
    created_at: '2026-01-15T00:00:00Z',
    updated_at: '2026-03-22T00:00:00Z',
  },
  {
    id: 'auto_income_bot',
    name: '자동 수입 텔레그램 봇',
    description: '투자정보, 지원사업, 부업 기회를 자동 수집하여 알림하는 봇.',
    stage: 'ideation',
    scores: {
      feasibility: 9,
      revenue: 4,
      difficulty: 3,
      brand: 3,
      automation: 10,
      social: 4,
    },
    next_action: '프로토타입 개발 (FAS 파이프라인 활용)',
    deadline: null,
    notes: 'FAS 인프라를 거의 그대로 활용 가능. 저비용 고자동화.',
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-03-22T00:00:00Z',
  },
];

// === Calculate weighted score for an idea ===

export const calculate_weighted_score = (scores: IdeaScores): number => {
  let total = 0;
  for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) {
    total += scores[key as keyof IdeaScores] * weight;
  }
  return Math.round(total * 100) / 100;
};

// === Add a new idea to the pipeline ===

export const add_idea = (
  ideas: Idea[],
  idea: Omit<Idea, 'created_at' | 'updated_at'>,
): Idea[] => {
  const now = new Date().toISOString();
  const new_idea: Idea = {
    ...idea,
    created_at: now,
    updated_at: now,
  };
  return [...ideas, new_idea];
};

// === Get ideas with optional stage filter ===

export const get_ideas = (
  ideas: readonly Idea[],
  filter?: { stage?: IdeaStage },
): Idea[] => {
  let result = [...ideas];

  if (filter?.stage) {
    result = result.filter((idea) => idea.stage === filter.stage);
  }

  // Sort by stage (later stages first), then by weighted score descending
  return result.sort((a, b) => {
    const stage_diff = STAGE_ORDER[b.stage] - STAGE_ORDER[a.stage];
    if (stage_diff !== 0) return stage_diff;
    return calculate_weighted_score(b.scores) - calculate_weighted_score(a.scores);
  });
};

// === Advance idea to next stage ===

export const advance_stage = (
  ideas: Idea[],
  id: string,
): { ideas: Idea[]; advanced: boolean; new_stage: IdeaStage | null } => {
  const index = ideas.findIndex((idea) => idea.id === id);
  if (index === -1) {
    return { ideas, advanced: false, new_stage: null };
  }

  const idea = ideas[index];
  const current_order = STAGE_ORDER[idea.stage];

  // Already at the last stage
  if (current_order >= STAGE_SEQUENCE.length - 1) {
    return { ideas, advanced: false, new_stage: idea.stage };
  }

  const new_stage = STAGE_SEQUENCE[current_order + 1];
  const updated = [...ideas];
  updated[index] = {
    ...idea,
    stage: new_stage,
    updated_at: new Date().toISOString(),
  };

  return { ideas: updated, advanced: true, new_stage };
};

// === Update scores for an idea ===

export const score_idea = (
  ideas: Idea[],
  id: string,
  scores: Partial<IdeaScores>,
): { ideas: Idea[]; updated: boolean } => {
  const index = ideas.findIndex((idea) => idea.id === id);
  if (index === -1) {
    return { ideas, updated: false };
  }

  const updated = [...ideas];
  updated[index] = {
    ...ideas[index],
    scores: { ...ideas[index].scores, ...scores },
    updated_at: new Date().toISOString(),
  };

  return { ideas: updated, updated: true };
};

// === Get top N ideas by weighted score ===

export const get_top_ideas = (
  ideas: readonly Idea[],
  n: number,
): Idea[] => {
  return [...ideas]
    .sort((a, b) => calculate_weighted_score(b.scores) - calculate_weighted_score(a.scores))
    .slice(0, n);
};

// === Generate pipeline overview report ===

export const generate_pipeline_report = (
  ideas: readonly Idea[],
  today: Date = new Date(),
): PipelineReport => {
  const now = new Date().toISOString();
  const date_str = now.split('T')[0];
  const sorted = get_ideas(ideas);

  const lines: string[] = [];
  lines.push(`=== Idea-to-Business Pipeline Report (${date_str}) ===`);
  lines.push('Purpose: track and prioritize business ideas for cashflow generation');
  lines.push(`Total: ${sorted.length} ideas in pipeline`);
  lines.push('');

  // Stage summary
  lines.push('--- Stage Summary ---');
  for (const stage of STAGE_SEQUENCE) {
    const count = sorted.filter((i) => i.stage === stage).length;
    const bar = count > 0 ? '█'.repeat(count) : '-';
    lines.push(`  ${stage.padEnd(12)} ${bar} (${count})`);
  }
  lines.push('');

  // Top ideas by weighted score
  const top = get_top_ideas(ideas, 3);
  if (top.length > 0) {
    lines.push('--- Top Ideas (by weighted score) ---');
    lines.push('');
    for (let i = 0; i < top.length; i++) {
      const idea = top[i];
      const ws = calculate_weighted_score(idea.scores);
      lines.push(`  #${i + 1} ${idea.name} (score: ${ws})`);
      lines.push(`    Stage: ${idea.stage} | Next: ${idea.next_action}`);
      if (idea.deadline) {
        const days = Math.round(
          (new Date(idea.deadline).getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        );
        lines.push(`    Deadline: ${idea.deadline} (D-${days})`);
      }
      lines.push('');
    }
  }

  // Detailed listing by stage
  lines.push('--- Detailed Pipeline ---');
  lines.push('');
  for (const stage of STAGE_SEQUENCE) {
    const stage_ideas = sorted.filter((i) => i.stage === stage);
    if (stage_ideas.length === 0) continue;

    lines.push(`[${stage.toUpperCase()}] (${stage_ideas.length})`);
    lines.push('');

    for (const idea of stage_ideas) {
      const ws = calculate_weighted_score(idea.scores);
      lines.push(`  ${idea.name} (weighted: ${ws})`);
      lines.push(`    ${idea.description}`);
      lines.push(`    Scores: F=${idea.scores.feasibility} R=${idea.scores.revenue} D=${idea.scores.difficulty} B=${idea.scores.brand} A=${idea.scores.automation} S=${idea.scores.social}`);
      lines.push(`    Next action: ${idea.next_action}`);
      if (idea.deadline) {
        lines.push(`    Deadline: ${idea.deadline}`);
      }
      if (idea.notes) {
        lines.push(`    Notes: ${idea.notes}`);
      }
      lines.push('');
    }
  }

  return {
    ideas: sorted,
    summary: lines.join('\n'),
    generated_at: now,
  };
};
