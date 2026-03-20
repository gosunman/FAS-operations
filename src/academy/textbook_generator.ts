// Textbook chapter content generator for EIDOS SCIENCE
// Generates structured textbook content: concepts, examples, practice problems
// Designed for 하이탑 (high school science reference) level
// Brand: EIDOS SCIENCE (black/gold/white)

import PDFDocument from 'pdfkit';
import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

// ─── Types ───────────────────────────────────────────────────

export type ChapterConfig = {
  subject: 'physics' | 'chemistry' | 'biology' | 'earth_science';
  unit: string;           // e.g. "역학과 에너지"
  chapter: string;        // e.g. "운동의 법칙"
  level: 'basic' | 'standard' | 'advanced';  // 기본/표준/심화
  include_examples: boolean;
  include_practice: boolean;
};

export type ConceptSection = {
  title: string;
  content: string;          // explanation text
  key_formulas?: string[];  // LaTeX-like formula strings
  diagrams?: string[];      // text descriptions for future diagram generation
  important_notes?: string[];
};

export type ExampleProblem = {
  number: number;
  problem: string;
  solution_steps: string[];
  answer: string;
  difficulty: 'basic' | 'standard' | 'advanced';
};

export type PracticeProblem = {
  number: number;
  problem: string;
  choices?: { label: string; text: string }[];  // for multiple choice
  answer: string;
  hint?: string;
};

export type ChapterContent = {
  subject: string;
  unit: string;
  chapter: string;
  level: string;
  sections: ConceptSection[];
  examples: ExampleProblem[];
  practice_problems: PracticeProblem[];
  summary: string;          // chapter summary
  key_terms: { term: string; definition: string }[];
  generated_at: string;
};

// ─── Content Template Registry ───────────────────────────────
// Each subject/chapter combination registers a factory function.
// To add a new chapter: create a factory and register it in CHAPTER_TEMPLATES.

type ChapterTemplateFactory = (config: ChapterConfig) => {
  sections: ConceptSection[];
  examples: ExampleProblem[];
  practice_problems: PracticeProblem[];
  summary: string;
  key_terms: { term: string; definition: string }[];
};

const CHAPTER_TEMPLATES: Record<string, ChapterTemplateFactory> = {};

/** Register a template factory for a subject:unit:chapter key */
function register_template(
  subject: string,
  unit: string,
  chapter: string,
  factory: ChapterTemplateFactory,
): void {
  const key = `${subject}:${unit}:${chapter}`;
  CHAPTER_TEMPLATES[key] = factory;
}

/** Look up a template factory; tries exact match, then subject:*:chapter fallback */
function find_template(subject: string, unit: string, chapter: string): ChapterTemplateFactory | undefined {
  const exact = CHAPTER_TEMPLATES[`${subject}:${unit}:${chapter}`];
  if (exact) return exact;
  // Fallback: match by subject and chapter only (any unit)
  for (const [key, factory] of Object.entries(CHAPTER_TEMPLATES)) {
    const [s, , c] = key.split(':');
    if (s === subject && c === chapter) return factory;
  }
  return undefined;
}

// ─── Physics: 역학과 에너지 / 운동의 법칙 ────────────────────

const CHOICE_LABELS = ['①', '②', '③', '④', '⑤'] as const;

register_template('physics', '역학과 에너지', '운동의 법칙', (config) => {
  // ── Concept Sections ──

  const sections: ConceptSection[] = [
    {
      title: '뉴턴의 운동 제1법칙 (관성의 법칙)',
      content:
        '외부에서 힘이 작용하지 않거나 알짜힘이 0이면, 정지한 물체는 계속 정지하고 운동하는 물체는 등속 직선 운동을 계속한다. ' +
        '이를 관성의 법칙이라 하며, 물체가 현재의 운동 상태를 유지하려는 성질을 관성이라 한다. ' +
        '관성의 크기는 질량에 비례한다. 질량이 클수록 운동 상태를 바꾸기 어렵다.\n\n' +
        '일상생활의 예:\n' +
        '- 버스가 급정거하면 승객이 앞으로 쏠린다 (승객의 몸은 등속 운동을 유지하려 한다)\n' +
        '- 망치 머리를 손잡이에 끼울 때 바닥에 내리치면 관성에 의해 머리가 더 깊이 들어간다\n' +
        '- 테이블보를 빠르게 잡아당기면 그릇은 제자리에 남는다',
      key_formulas: [
        'ΣF = 0 → v = 일정 (등속 직선 운동 또는 정지)',
      ],
      important_notes: [
        '관성은 힘이 아니다. 물체의 성질이다.',
        '알짜힘이 0이면 가속도도 0이다.',
        '관성 기준틀(관성계)에서만 뉴턴의 법칙이 성립한다.',
      ],
    },
    {
      title: '뉴턴의 운동 제2법칙 (가속도의 법칙)',
      content:
        '물체에 알짜힘 F가 작용하면, 물체는 힘의 방향으로 가속도 a를 가지며, 가속도의 크기는 힘에 비례하고 질량에 반비례한다.\n\n' +
        '이 법칙은 운동 방정식 F = ma로 표현되며, 역학 문제 풀이의 핵심이다.\n\n' +
        '중요 포인트:\n' +
        '- F는 물체에 작용하는 모든 힘의 벡터 합(알짜힘)이다\n' +
        '- 질량 m은 관성의 크기를 나타내는 스칼라량이다\n' +
        '- 가속도 a는 벡터량으로, 알짜힘과 같은 방향이다\n' +
        '- SI 단위: 힘(N), 질량(kg), 가속도(m/s²)\n' +
        '- 1 N = 1 kg·m/s² (1 뉴턴은 1 kg의 물체에 1 m/s²의 가속도를 주는 힘)',
      key_formulas: [
        'F = ma',
        'ΣF = ma (벡터 형태)',
        '1 N = 1 kg·m/s²',
        'a = F/m',
      ],
      diagrams: [
        '물체에 작용하는 여러 힘의 벡터 합을 구하는 다이어그램',
        '질량에 따른 가속도 변화 그래프 (F 일정)',
      ],
      important_notes: [
        'F는 반드시 알짜힘(합력)이어야 한다. 개별 힘이 아니다.',
        '질량과 무게를 혼동하지 말 것: 무게 W = mg (힘), 질량 m (물질의 양)',
        '가속도의 방향은 속도의 방향이 아니라 알짜힘의 방향이다.',
      ],
    },
    {
      title: '뉴턴의 운동 제3법칙 (작용-반작용의 법칙)',
      content:
        '물체 A가 물체 B에 힘을 가하면(작용), 물체 B도 물체 A에 크기가 같고 방향이 반대인 힘을 가한다(반작용).\n\n' +
        '핵심 특징:\n' +
        '- 작용과 반작용은 항상 동시에 발생한다\n' +
        '- 크기가 같고 방향이 반대이다\n' +
        '- 서로 다른 두 물체에 각각 작용한다 (같은 물체에 작용하는 두 힘의 평형과 다름!)\n' +
        '- 같은 종류의 힘이다 (중력-중력, 접촉력-접촉력)\n\n' +
        '작용-반작용 vs 힘의 평형:\n' +
        '- 작용-반작용: 두 물체에 작용, 항상 성립\n' +
        '- 힘의 평형: 한 물체에 작용하는 두 힘의 합이 0',
      key_formulas: [
        'F_AB = -F_BA',
        '|F_작용| = |F_반작용|, 방향 반대',
      ],
      important_notes: [
        '작용-반작용 쌍은 절대 같은 물체에 작용하지 않는다.',
        '작용-반작용은 서로 상쇄되지 않는다 (서로 다른 물체에 작용하므로).',
        '책상 위 책의 무게(중력)와 수직항력은 작용-반작용이 아니라 힘의 평형이다.',
      ],
    },
    {
      title: '자유 물체 다이어그램 (Free Body Diagram)',
      content:
        '자유 물체 다이어그램(FBD)은 물체에 작용하는 모든 힘을 화살표로 나타낸 그림이다. ' +
        '역학 문제를 풀 때 가장 먼저 해야 할 일이 FBD를 그리는 것이다.\n\n' +
        'FBD 그리는 순서:\n' +
        '1. 분석할 물체를 선택하고 점 또는 간단한 도형으로 나타낸다\n' +
        '2. 물체에 작용하는 모든 힘을 확인한다\n' +
        '   - 중력 (항상 아래 방향)\n' +
        '   - 수직항력 (접촉면에 수직)\n' +
        '   - 마찰력 (접촉면에 평행, 운동 반대 방향)\n' +
        '   - 장력 (실/줄을 따라 당기는 방향)\n' +
        '   - 외부 힘 (문제에서 주어진 힘)\n' +
        '3. 각 힘을 화살표로 그리되, 방향과 상대적 크기를 표시한다\n' +
        '4. 좌표축을 설정한다 (빗면 문제에서는 빗면 방향이 편리)',
      diagrams: [
        '수평면 위 물체의 FBD: 중력(↓), 수직항력(↑), 마찰력(←), 당기는 힘(→)',
        '빗면 위 물체의 FBD: 중력 성분 분해, 수직항력, 마찰력',
      ],
      important_notes: [
        'FBD에는 분석 대상 물체에 작용하는 힘만 그린다. 물체가 다른 물체에 가하는 힘은 제외.',
        '빗면 문제에서는 중력을 빗면 방향과 수직 방향으로 분해하면 편리하다.',
      ],
    },
    {
      title: '마찰력, 장력, 수직항력',
      content:
        '▣ 마찰력 (Friction)\n' +
        '두 물체의 접촉면에서 운동을 방해하는 방향으로 작용하는 힘이다.\n' +
        '- 정지 마찰력: 물체가 움직이지 않을 때 외부 힘에 맞서는 마찰력 (0 ~ μₛN)\n' +
        '- 최대 정지 마찰력: fₛ,max = μₛN (이 값을 넘는 힘이 가해지면 물체가 움직이기 시작)\n' +
        '- 운동 마찰력: 물체가 움직일 때 작용 f_k = μ_kN (일정한 값)\n' +
        '- 일반적으로 μₛ > μ_k (정지 마찰 계수가 운동 마찰 계수보다 큼)\n\n' +
        '▣ 수직항력 (Normal Force)\n' +
        '접촉면이 물체를 수직으로 떠받치는 힘이다. ' +
        '수평면에서는 N = mg이지만, 빗면이나 추가 힘이 있으면 달라진다.\n' +
        '- 수평면: N = mg\n' +
        '- 빗면(경사각 θ): N = mg cosθ\n' +
        '- 수직 방향 추가 힘 F: N = mg + F (아래 방향) 또는 N = mg - F (위 방향)\n\n' +
        '▣ 장력 (Tension)\n' +
        '실이나 줄이 물체를 당기는 힘이다. 질량이 무시되는 이상적인 실에서는 실 전체의 장력이 동일하다.\n' +
        '- 도르래 문제에서 실의 장력은 양쪽 물체의 운동 방정식을 연립하여 구한다\n' +
        '- 실이 늘어나지 않으면 연결된 물체의 가속도 크기는 동일하다',
      key_formulas: [
        'f_s ≤ μ_s × N (정지 마찰력)',
        'f_k = μ_k × N (운동 마찰력)',
        'N = mg (수평면)',
        'N = mg cosθ (빗면)',
      ],
      important_notes: [
        '수직항력은 항상 mg가 아니다! 상황에 따라 달라진다.',
        '마찰력의 방향은 항상 운동(또는 운동하려는 경향)의 반대 방향이다.',
        '장력은 실을 따라 물체를 당기는 방향으로 작용한다.',
      ],
    },
  ];

  // ── Examples (worked problems) ──

  const all_examples: ExampleProblem[] = [
    {
      number: 1,
      problem:
        '마찰이 없는 수평면 위에 질량 4 kg인 물체가 놓여 있다. 이 물체에 수평 방향으로 20 N의 힘을 가했을 때, 물체의 가속도를 구하시오.',
      solution_steps: [
        '주어진 조건 정리: m = 4 kg, F = 20 N, 마찰 없음',
        '자유 물체 다이어그램: 수평 방향 → 힘 F만 작용 (마찰 없음)',
        '뉴턴 제2법칙 적용: F = ma',
        'a = F/m = 20/4 = 5 m/s²',
      ],
      answer: '5 m/s²',
      difficulty: 'basic',
    },
    {
      number: 2,
      problem:
        '질량 5 kg인 물체가 운동 마찰 계수 μ_k = 0.3인 수평면 위에서 수평 방향으로 30 N의 힘을 받고 있다. 이 물체의 가속도를 구하시오. (g = 10 m/s²)',
      solution_steps: [
        '주어진 조건: m = 5 kg, F = 30 N, μ_k = 0.3, g = 10 m/s²',
        '수직항력: N = mg = 5 × 10 = 50 N',
        '운동 마찰력: f_k = μ_k × N = 0.3 × 50 = 15 N',
        '알짜힘: ΣF = F - f_k = 30 - 15 = 15 N',
        '가속도: a = ΣF/m = 15/5 = 3 m/s²',
      ],
      answer: '3 m/s²',
      difficulty: 'standard',
    },
    {
      number: 3,
      problem:
        '경사각 30°인 마찰 없는 빗면 위에 질량 2 kg인 물체가 놓여 있다. 물체가 빗면을 따라 미끄러져 내려갈 때의 가속도와, 빗면이 물체에 작용하는 수직항력을 구하시오. (g = 10 m/s²)',
      solution_steps: [
        '좌표축 설정: 빗면 방향(x축), 빗면 수직 방향(y축)',
        '중력의 성분 분해: mg sinθ (빗면 방향), mg cosθ (수직 방향)',
        'y축 방향: N = mg cosθ = 2 × 10 × cos30° = 20 × (√3/2) ≈ 17.3 N',
        'x축 방향: ma = mg sinθ',
        'a = g sinθ = 10 × sin30° = 10 × 0.5 = 5 m/s²',
      ],
      answer: 'a = 5 m/s², N ≈ 17.3 N',
      difficulty: 'standard',
    },
    {
      number: 4,
      problem:
        '마찰 없는 수평면 위에서 질량 3 kg인 물체 A와 질량 2 kg인 물체 B가 가벼운 실로 연결되어 있다. A에 수평 방향으로 25 N의 힘을 가할 때, 두 물체의 가속도와 실의 장력을 구하시오.',
      solution_steps: [
        '전체 시스템: 총 질량 = 3 + 2 = 5 kg, 외부 힘 = 25 N',
        '시스템 가속도: a = F/(m_A + m_B) = 25/5 = 5 m/s²',
        '물체 B에 대한 운동 방정식: T = m_B × a = 2 × 5 = 10 N',
        '검산: 물체 A에 대해 F - T = m_A × a → 25 - 10 = 15 = 3 × 5 ✓',
      ],
      answer: 'a = 5 m/s², T = 10 N',
      difficulty: 'advanced',
    },
  ];

  // ── Practice Problems ──

  const all_practice: PracticeProblem[] = [
    {
      number: 1,
      problem: '질량 3 kg인 물체에 알짜힘 12 N이 작용할 때, 물체의 가속도는?',
      choices: [
        { label: '①', text: '2 m/s²' },
        { label: '②', text: '3 m/s²' },
        { label: '③', text: '4 m/s²' },
        { label: '④', text: '6 m/s²' },
        { label: '⑤', text: '36 m/s²' },
      ],
      answer: '③',
      hint: 'F = ma를 변형하여 a = F/m',
    },
    {
      number: 2,
      problem: '뉴턴의 운동 제3법칙(작용-반작용의 법칙)에 대한 설명으로 옳지 않은 것은?',
      choices: [
        { label: '①', text: '작용과 반작용은 동시에 발생한다' },
        { label: '②', text: '작용과 반작용은 크기가 같다' },
        { label: '③', text: '작용과 반작용은 같은 물체에 작용한다' },
        { label: '④', text: '작용과 반작용은 같은 종류의 힘이다' },
        { label: '⑤', text: '작용과 반작용은 방향이 반대이다' },
      ],
      answer: '③',
      hint: '작용-반작용은 서로 다른 두 물체 사이에서 발생한다',
    },
    {
      number: 3,
      problem:
        '운동 마찰 계수가 0.2인 수평면 위에서 질량 10 kg인 물체를 일정한 속력으로 끌려면 수평 방향으로 얼마의 힘이 필요한가? (g = 10 m/s²)',
      choices: [
        { label: '①', text: '10 N' },
        { label: '②', text: '20 N' },
        { label: '③', text: '50 N' },
        { label: '④', text: '100 N' },
        { label: '⑤', text: '200 N' },
      ],
      answer: '②',
      hint: '등속이므로 가하는 힘 = 마찰력, f = μN = μmg',
    },
    {
      number: 4,
      problem:
        '경사각 θ인 마찰 없는 빗면에서 질량 m인 물체가 미끄러져 내려갈 때의 가속도는?',
      choices: [
        { label: '①', text: 'g' },
        { label: '②', text: 'g sinθ' },
        { label: '③', text: 'g cosθ' },
        { label: '④', text: 'g tanθ' },
        { label: '⑤', text: 'mg sinθ' },
      ],
      answer: '②',
      hint: '빗면 방향 성분: ma = mg sinθ → a = g sinθ',
    },
    {
      number: 5,
      problem:
        '질량이 같은 두 물체 A, B가 실로 연결되어 마찰 없는 도르래에 걸려 있다. 이 시스템의 가속도는?',
      choices: [
        { label: '①', text: '0' },
        { label: '②', text: 'g/2' },
        { label: '③', text: 'g' },
        { label: '④', text: '2g' },
        { label: '⑤', text: '알 수 없다' },
      ],
      answer: '①',
      hint: '질량이 같으면 알짜힘이 0이므로 가속도도 0이다 (Atwood machine에서 m₁ = m₂)',
    },
    {
      number: 6,
      problem:
        '수평면 위에서 질량 2 kg인 물체에 수평 방향 10 N과 반대 방향 4 N의 힘이 동시에 작용한다. 물체의 가속도의 크기는?',
      answer: '3 m/s² (ΣF = 10 - 4 = 6 N, a = 6/2 = 3 m/s²)',
    },
    {
      number: 7,
      problem:
        '질량 50 kg인 사람이 엘리베이터 안에서 체중계에 올라서 있다. 엘리베이터가 위로 2 m/s²의 가속도로 올라갈 때 체중계의 눈금은? (g = 10 m/s²)',
      answer: '600 N (N = m(g + a) = 50 × 12 = 600 N)',
      hint: '가속 상승 시 겉보기 무게가 증가한다',
    },
  ];

  // ── Level-based filtering ──
  // basic: first 3 examples, first 5 practice
  // standard: all examples, all practice
  // advanced: all examples (higher difficulty emphasis), all practice + extra depth
  const examples_count = config.level === 'basic' ? 3 : all_examples.length;
  const practice_count = config.level === 'basic' ? 5 : all_practice.length;

  const summary =
    '이 단원에서는 뉴턴의 운동 법칙 세 가지를 학습하였다. ' +
    '제1법칙(관성의 법칙)은 알짜힘이 0이면 운동 상태가 변하지 않음을, ' +
    '제2법칙(가속도의 법칙)은 F = ma 관계를, ' +
    '제3법칙(작용-반작용의 법칙)은 두 물체 사이의 힘이 항상 쌍으로 존재함을 설명한다. ' +
    '이 법칙들을 적용하기 위해 자유 물체 다이어그램(FBD)을 그려 물체에 작용하는 힘을 분석하고, ' +
    '마찰력, 수직항력, 장력 등 다양한 힘의 특성을 이해해야 한다. ' +
    '역학 문제 풀이의 핵심은 올바른 FBD 작성과 뉴턴 제2법칙의 적용이다.';

  const key_terms: { term: string; definition: string }[] = [
    { term: '관성', definition: '물체가 현재의 운동 상태를 유지하려는 성질. 질량에 비례한다.' },
    { term: '알짜힘(합력)', definition: '물체에 작용하는 모든 힘의 벡터 합. ΣF로 표기한다.' },
    { term: '가속도', definition: '단위 시간당 속도의 변화량. 벡터량이며 알짜힘의 방향과 같다. 단위: m/s²' },
    { term: '수직항력', definition: '접촉면이 물체를 수직 방향으로 떠받치는 힘. 항상 mg는 아니다.' },
    { term: '마찰력', definition: '두 물체의 접촉면에서 운동을 방해하는 방향으로 작용하는 힘. 정지 마찰력과 운동 마찰력이 있다.' },
    { term: '장력', definition: '실이나 줄이 물체를 당기는 힘. 이상적인 실에서는 전체 실의 장력이 동일하다.' },
    { term: '작용-반작용', definition: '두 물체 사이에서 크기가 같고 방향이 반대인 힘의 쌍. 항상 서로 다른 물체에 작용한다.' },
    { term: '자유 물체 다이어그램(FBD)', definition: '물체에 작용하는 모든 힘을 화살표로 나타낸 그림. 역학 문제 풀이의 첫 단계.' },
  ];

  return {
    sections,
    examples: all_examples.slice(0, examples_count),
    practice_problems: all_practice.slice(0, practice_count),
    summary,
    key_terms,
  };
});

// ─── Core Functions ──────────────────────────────────────────

/**
 * Generate structured chapter content based on the given configuration.
 * Uses template banks for known subject/chapter combinations.
 */
export function generate_chapter_content(config: ChapterConfig): ChapterContent {
  const factory = find_template(config.subject, config.unit, config.chapter);

  if (!factory) {
    // Return a minimal placeholder for unsupported chapters
    return {
      subject: config.subject,
      unit: config.unit,
      chapter: config.chapter,
      level: config.level,
      sections: [
        {
          title: `${config.chapter} 개요`,
          content: `${config.unit} 단원의 ${config.chapter} 내용은 아직 준비 중입니다.`,
        },
      ],
      examples: [],
      practice_problems: [],
      summary: `${config.chapter}에 대한 요약은 추후 추가됩니다.`,
      key_terms: [{ term: config.chapter, definition: '추후 정의 추가 예정' }],
      generated_at: new Date().toISOString(),
    };
  }

  const template = factory(config);

  return {
    subject: config.subject,
    unit: config.unit,
    chapter: config.chapter,
    level: config.level,
    sections: template.sections,
    examples: config.include_examples ? template.examples : [],
    practice_problems: config.include_practice ? template.practice_problems : [],
    summary: template.summary,
    key_terms: template.key_terms,
    generated_at: new Date().toISOString(),
  };
}

// ─── Format for Print ────────────────────────────────────────

const SUBJECT_NAMES: Record<string, string> = {
  physics: '물리학',
  chemistry: '화학',
  biology: '생명과학',
  earth_science: '지구과학',
};

const LEVEL_NAMES: Record<string, string> = {
  basic: '기본',
  standard: '표준',
  advanced: '심화',
};

/**
 * Format chapter content as a printable text string.
 * Suitable for text preview or plain-text output.
 */
export function format_chapter_for_print(content: ChapterContent): string {
  const lines: string[] = [];
  const subject_name = SUBJECT_NAMES[content.subject] ?? content.subject;
  const level_name = LEVEL_NAMES[content.level] ?? content.level;

  // ── Header ──
  lines.push('═'.repeat(70));
  lines.push('                      EIDOS SCIENCE');
  lines.push('═'.repeat(70));
  lines.push('');
  lines.push(`과목: ${subject_name}    단원: ${content.unit}    난이도: ${level_name}`);
  lines.push(`챕터: ${content.chapter}`);
  lines.push('');
  lines.push('─'.repeat(70));

  // ── Concept Sections ──
  for (let i = 0; i < content.sections.length; i++) {
    const section = content.sections[i];
    lines.push('');
    lines.push(`■ ${i + 1}. ${section.title}`);
    lines.push('');
    lines.push(section.content);

    if (section.key_formulas && section.key_formulas.length > 0) {
      lines.push('');
      lines.push('  [ 주요 공식 ]');
      for (const formula of section.key_formulas) {
        lines.push(`    ${formula}`);
      }
    }

    if (section.important_notes && section.important_notes.length > 0) {
      lines.push('');
      lines.push('  ⚠ 주의사항');
      for (const note of section.important_notes) {
        lines.push(`    • ${note}`);
      }
    }

    lines.push('');
    lines.push('─'.repeat(70));
  }

  // ── Examples ──
  if (content.examples.length > 0) {
    lines.push('');
    lines.push('■ 예제');
    lines.push('─'.repeat(70));
    for (const ex of content.examples) {
      lines.push('');
      lines.push(`  [예제 ${ex.number}] (${LEVEL_NAMES[ex.difficulty] ?? ex.difficulty})`);
      lines.push(`  ${ex.problem}`);
      lines.push('');
      lines.push('  풀이:');
      for (let i = 0; i < ex.solution_steps.length; i++) {
        lines.push(`    ${i + 1}) ${ex.solution_steps[i]}`);
      }
      lines.push(`  답: ${ex.answer}`);
      lines.push('');
    }
    lines.push('─'.repeat(70));
  }

  // ── Practice Problems ──
  if (content.practice_problems.length > 0) {
    lines.push('');
    lines.push('■ 연습문제');
    lines.push('─'.repeat(70));
    for (const pp of content.practice_problems) {
      lines.push('');
      lines.push(`  ${pp.number}. ${pp.problem}`);
      if (pp.choices && pp.choices.length > 0) {
        for (const c of pp.choices) {
          lines.push(`     ${c.label} ${c.text}`);
        }
      }
    }
    lines.push('');
    lines.push('─'.repeat(70));
  }

  // ── Summary ──
  lines.push('');
  lines.push('■ 단원 요약');
  lines.push('─'.repeat(70));
  lines.push('');
  lines.push(content.summary);
  lines.push('');

  // ── Key Terms ──
  lines.push('■ 핵심 용어');
  lines.push('─'.repeat(70));
  lines.push('');
  for (const kt of content.key_terms) {
    lines.push(`  • ${kt.term}: ${kt.definition}`);
  }
  lines.push('');
  lines.push('═'.repeat(70));

  return lines.join('\n');
}

// ─── PDF Generation ──────────────────────────────────────────

// Korean font paths — same as pdf_generator.ts
const KOREAN_FONT_PATHS = [
  `${process.env.HOME}/Library/Fonts/NotoSansKR-VariableFont_wght.ttf`,
  '/Library/Fonts/NotoSansKR-Regular.ttf',
  '/Library/Fonts/NotoSansKR-VariableFont_wght.ttf',
  '/System/Library/Fonts/Supplemental/AppleGothic.ttf',
];

function find_korean_font(): string | null {
  for (const font_path of KOREAN_FONT_PATHS) {
    if (existsSync(font_path)) return font_path;
  }
  return null;
}

function setup_font(doc: InstanceType<typeof PDFDocument>): void {
  const korean_font = find_korean_font();
  if (korean_font) {
    doc.registerFont('Korean', korean_font);
    doc.font('Korean');
  } else {
    doc.font('Helvetica');
  }
}

function ensure_dir(file_path: string): void {
  const dir = dirname(file_path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generate a PDF for a chapter's textbook content.
 * Returns the output file path.
 */
export async function generate_chapter_pdf(
  content: ChapterContent,
  output_path: string,
): Promise<string> {
  ensure_dir(output_path);

  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    bufferPages: true,
    info: {
      Title: `EIDOS SCIENCE - ${content.chapter}`,
      Author: 'EIDOS SCIENCE',
      Creator: 'FAS Textbook Generator',
    },
  });
  setup_font(doc);

  const margin = 50;
  const content_width = doc.page.width - margin * 2;
  const subject_name = SUBJECT_NAMES[content.subject] ?? content.subject;
  const level_name = LEVEL_NAMES[content.level] ?? content.level;

  // ── Header ──
  doc.fontSize(20).fillColor('#1a1a1a').text('EIDOS SCIENCE', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(14).fillColor('#333333').text(
    `${subject_name} — ${content.unit}`,
    { align: 'center' },
  );
  doc.moveDown(0.2);
  doc.fontSize(16).fillColor('#1a1a1a').text(content.chapter, { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor('#888888').text(`난이도: ${level_name}`, { align: 'center' });
  doc.moveDown(0.5);

  // Separator
  doc.moveTo(margin, doc.y).lineTo(doc.page.width - margin, doc.y)
    .strokeColor('#cccccc').lineWidth(1).stroke();
  doc.moveDown(0.8);

  // ── Sections ──
  for (let i = 0; i < content.sections.length; i++) {
    const section = content.sections[i];

    if (doc.y + 60 > doc.page.height - margin - 30) {
      doc.addPage();
    }

    doc.fontSize(13).fillColor('#1a1a1a').text(`${i + 1}. ${section.title}`);
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#333333').text(section.content, {
      width: content_width,
      lineGap: 3,
    });

    if (section.key_formulas && section.key_formulas.length > 0) {
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#555555').text('[주요 공식]');
      for (const formula of section.key_formulas) {
        doc.fontSize(10).fillColor('#000000').text(`  ${formula}`);
      }
    }

    if (section.important_notes && section.important_notes.length > 0) {
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#555555').text('[주의사항]');
      for (const note of section.important_notes) {
        doc.fontSize(9).fillColor('#444444').text(`  - ${note}`, { width: content_width });
      }
    }

    doc.moveDown(0.8);
  }

  // ── Examples ──
  if (content.examples.length > 0) {
    if (doc.y + 40 > doc.page.height - margin - 30) doc.addPage();
    doc.fontSize(13).fillColor('#1a1a1a').text('예제');
    doc.moveDown(0.5);

    for (const ex of content.examples) {
      if (doc.y + 80 > doc.page.height - margin - 30) doc.addPage();

      doc.fontSize(11).fillColor('#000000').text(`[예제 ${ex.number}]`);
      doc.fontSize(10).fillColor('#333333').text(ex.problem, { width: content_width });
      doc.moveDown(0.2);
      doc.fontSize(9).fillColor('#555555').text('풀이:');
      for (let i = 0; i < ex.solution_steps.length; i++) {
        doc.text(`  ${i + 1}) ${ex.solution_steps[i]}`, { width: content_width });
      }
      doc.fontSize(10).fillColor('#000000').text(`답: ${ex.answer}`);
      doc.moveDown(0.5);
    }
  }

  // ── Practice Problems ──
  if (content.practice_problems.length > 0) {
    if (doc.y + 40 > doc.page.height - margin - 30) doc.addPage();
    doc.fontSize(13).fillColor('#1a1a1a').text('연습문제');
    doc.moveDown(0.5);

    for (const pp of content.practice_problems) {
      if (doc.y + 60 > doc.page.height - margin - 30) doc.addPage();

      doc.fontSize(10).fillColor('#000000').text(`${pp.number}. ${pp.problem}`, {
        width: content_width,
      });
      if (pp.choices && pp.choices.length > 0) {
        for (const c of pp.choices) {
          doc.fontSize(10).fillColor('#333333').text(`   ${c.label} ${c.text}`, {
            width: content_width - 15,
          });
        }
      }
      doc.moveDown(0.4);
    }
  }

  // ── Summary ──
  if (doc.y + 60 > doc.page.height - margin - 30) doc.addPage();
  doc.moveDown(0.5);
  doc.fontSize(13).fillColor('#1a1a1a').text('단원 요약');
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#333333').text(content.summary, {
    width: content_width,
    lineGap: 3,
  });

  // ── Key Terms ──
  doc.moveDown(0.5);
  doc.fontSize(13).fillColor('#1a1a1a').text('핵심 용어');
  doc.moveDown(0.3);
  for (const kt of content.key_terms) {
    if (doc.y + 20 > doc.page.height - margin - 30) doc.addPage();
    doc.fontSize(10).fillColor('#000000').text(`${kt.term}`, { continued: true })
      .fillColor('#555555').text(` — ${kt.definition}`, { width: content_width });
  }

  // ── Page Numbers ──
  const page_count = doc.bufferedPageRange().count;
  for (let i = 0; i < page_count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor('#888888').text(
      `${i + 1} / ${page_count}`,
      0,
      doc.page.height - margin + 10,
      { align: 'center', width: doc.page.width },
    );
  }

  // ── Write file ──
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(output_path);
    stream.on('finish', () => resolve(output_path));
    stream.on('error', reject);
    doc.pipe(stream);
    doc.end();
  });
}

// ─── Validation ──────────────────────────────────────────────

/**
 * Validate chapter content structure and completeness.
 * Returns { valid, issues } where issues lists all detected problems.
 */
export function validate_chapter(
  content: ChapterContent,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Required metadata
  if (!content.subject) {
    issues.push('Missing subject field');
  }
  if (!content.unit) {
    issues.push('Missing unit field');
  }
  if (!content.chapter) {
    issues.push('Missing chapter field');
  }

  // Sections
  if (content.sections.length === 0) {
    issues.push('No concept sections found');
  }
  for (let i = 0; i < content.sections.length; i++) {
    const s = content.sections[i];
    if (!s.title) {
      issues.push(`Section ${i + 1}: empty title`);
    }
    if (!s.content) {
      issues.push(`Section ${i + 1}: empty content`);
    }
  }

  // Examples
  for (let i = 0; i < content.examples.length; i++) {
    const ex = content.examples[i];
    if (!ex.problem) {
      issues.push(`Example ${ex.number}: empty problem`);
    }
    if (!ex.solution_steps || ex.solution_steps.length === 0) {
      issues.push(`Example ${ex.number}: empty solution_steps`);
    }
    if (!ex.answer) {
      issues.push(`Example ${ex.number}: empty answer`);
    }
  }

  // Practice problems
  for (let i = 0; i < content.practice_problems.length; i++) {
    const pp = content.practice_problems[i];
    if (!pp.problem) {
      issues.push(`Practice ${pp.number}: empty problem`);
    }
    if (!pp.answer) {
      issues.push(`Practice ${pp.number}: empty answer`);
    }
  }

  // Summary
  if (!content.summary) {
    issues.push('Empty summary');
  }

  // Key terms
  if (!content.key_terms || content.key_terms.length === 0) {
    issues.push('No key_terms defined');
  }

  return { valid: issues.length === 0, issues };
}
