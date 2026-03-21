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

// ─── Chemistry: 물질의 구성 / 주기율표와 원소 ─────────────────

register_template('chemistry', '물질의 구성', '주기율표와 원소', (config) => {
  // ── Concept Sections ──

  const sections: ConceptSection[] = [
    {
      title: '원자의 구조 (Atomic Structure)',
      content:
        '원자는 물질을 구성하는 기본 입자이다. 원자의 중심에는 (+)전하를 띠는 원자핵이 있고, ' +
        '원자핵 주위를 (-)전하를 띠는 전자가 돌고 있다.\n\n' +
        '▣ 원자핵의 구성\n' +
        '- 양성자(proton): (+)전하, 질량 약 1 amu\n' +
        '- 중성자(neutron): 전하 없음, 질량 약 1 amu\n' +
        '- 원자핵 = 양성자 + 중성자 (핵자, nucleon)\n\n' +
        '▣ 전자\n' +
        '- (-)전하, 질량은 양성자의 약 1/1836\n' +
        '- 전자 수 = 양성자 수 (중성 원자)\n\n' +
        '▣ 원자번호와 질량수\n' +
        '- 원자번호(Z) = 양성자 수 → 원소의 종류를 결정\n' +
        '- 질량수(A) = 양성자 수 + 중성자 수\n' +
        '- 중성자 수(N) = A - Z\n' +
        '- 같은 원소에서 중성자 수가 다른 원자를 동위 원소(isotope)라 한다\n\n' +
        '예시: ¹²C (탄소-12) → Z=6, A=12, N=6 / ¹⁴C (탄소-14) → Z=6, A=14, N=8',
      key_formulas: [
        'A = Z + N (질량수 = 원자번호 + 중성자 수)',
        'Z = 양성자 수 = 전자 수 (중성 원자)',
        'N = A - Z (중성자 수)',
      ],
      important_notes: [
        '원자번호가 같으면 같은 원소이다. 중성자 수가 달라도 화학적 성질은 같다.',
        '원자의 질량은 거의 대부분 원자핵(양성자 + 중성자)에 집중되어 있다.',
        '전자의 질량은 매우 작으므로 질량수 계산에 포함하지 않는다.',
      ],
    },
    {
      title: '주기율표 (Periodic Table)',
      content:
        '주기율표는 원소를 원자번호 순서로 배열하되, 화학적 성질이 비슷한 원소가 같은 세로줄(족)에 오도록 정리한 표이다.\n\n' +
        '▣ 주기 (Period) — 가로줄\n' +
        '- 1~7주기: 같은 주기의 원소는 전자 껍질 수가 같다\n' +
        '- 주기 번호 = 전자 껍질 수\n' +
        '- 같은 주기에서 왼쪽→오른쪽으로 갈수록 원자번호 증가\n\n' +
        '▣ 족 (Group) — 세로줄\n' +
        '- 1~18족: 같은 족의 원소는 원자가 전자 수가 같아 화학적 성질이 비슷\n' +
        '- 1족: 알칼리 금속 (Li, Na, K 등) — 반응성 큼, 물과 반응\n' +
        '- 2족: 알칼리 토금속 (Be, Mg, Ca 등)\n' +
        '- 17족: 할로겐 (F, Cl, Br, I 등) — 비금속, 반응성 큼\n' +
        '- 18족: 비활성 기체 (He, Ne, Ar 등) — 안정, 반응 거의 안 함\n\n' +
        '▣ 원소의 분류\n' +
        '- 금속 원소: 주기율표 왼쪽/중앙, 광택, 전기/열 전도성, 양이온 형성\n' +
        '- 비금속 원소: 주기율표 오른쪽, 음이온 형성, 공유 결합\n' +
        '- 준금속(메탈로이드): 금속과 비금속의 중간 성질 (Si, Ge 등)',
      key_formulas: [
        '주기 번호 = 전자 껍질 수',
        '같은 족 → 원자가 전자 수 동일 → 화학적 성질 유사',
        '1족: 원자가 전자 1개, 17족: 원자가 전자 7개, 18족: 원자가 전자 8개(He은 2개)',
      ],
      important_notes: [
        '주기율표에서 원소의 위치만으로 많은 화학적 성질을 예측할 수 있다.',
        '같은 족 원소는 원자가 전자 수가 같으므로 화학적 성질이 비슷하다.',
        '비활성 기체(18족)는 전자 배치가 안정하여 화학 반응을 거의 하지 않는다.',
      ],
    },
    {
      title: '원소와 화합물 (Elements and Compounds)',
      content:
        '▣ 원소 (Element)\n' +
        '- 한 종류의 원자로만 이루어진 순수한 물질\n' +
        '- 화학적 방법으로 더 간단한 물질로 분해할 수 없다\n' +
        '- 원소 기호: 라틴어 이름의 첫 글자(대문자) 또는 첫 두 글자\n' +
        '  예) H(수소), O(산소), C(탄소), Fe(철), Na(나트륨), Au(금)\n\n' +
        '▣ 화합물 (Compound)\n' +
        '- 두 종류 이상의 원소가 일정한 비율로 화학적으로 결합한 물질\n' +
        '- 성분 원소와는 전혀 다른 성질을 가진다\n' +
        '- 화학식: 원소 기호와 숫자로 화합물의 조성을 나타냄\n' +
        '  예) H₂O(물), NaCl(염화나트륨), CO₂(이산화탄소), CaCO₃(탄산칼슘)\n\n' +
        '▣ 화학식 읽기\n' +
        '- 아래 첨자 숫자 = 해당 원소의 원자 수\n' +
        '- H₂O: 수소 원자 2개 + 산소 원자 1개\n' +
        '- CO₂: 탄소 원자 1개 + 산소 원자 2개\n' +
        '- 계수(coefficient): 화학식 앞의 숫자, 분자 수를 나타냄\n' +
        '  예) 2H₂O = 물 분자 2개',
      key_formulas: [
        '원소 기호: 첫 글자 대문자 + (필요 시) 둘째 글자 소문자',
        '화학식의 아래 첨자 = 원자 수, 화학식 앞 계수 = 분자 수',
      ],
      important_notes: [
        '원소와 원자는 다른 개념이다. 원소는 물질의 종류, 원자는 물질을 이루는 입자이다.',
        '화합물의 성질은 성분 원소의 성질과 다르다 (예: Na는 폭발적 금속이고 Cl₂는 유독 기체지만, NaCl은 안전한 소금).',
        '혼합물은 화합물과 다르다. 혼합물은 물리적 혼합이고, 화합물은 화학적 결합이다.',
      ],
    },
    {
      title: '분자와 이온 (Molecules and Ions)',
      content:
        '▣ 분자 (Molecule)\n' +
        '- 두 개 이상의 원자가 공유 결합으로 결합한 입자\n' +
        '- 공유 결합: 비금속 원자끼리 전자쌍을 공유하여 형성\n' +
        '- 분자식: 분자를 구성하는 원자의 종류와 수를 나타냄\n' +
        '  예) H₂(수소 분자), O₂(산소 분자), H₂O(물), NH₃(암모니아)\n\n' +
        '▣ 이온 (Ion)\n' +
        '- 원자가 전자를 잃거나 얻어서 전하를 띠게 된 입자\n' +
        '- 양이온(cation): 전자를 잃어 (+)전하를 띠는 이온\n' +
        '  예) Na⁺, Ca²⁺, Fe³⁺, NH₄⁺\n' +
        '- 음이온(anion): 전자를 얻어 (-)전하를 띠는 이온\n' +
        '  예) Cl⁻, O²⁻, SO₄²⁻, NO₃⁻\n\n' +
        '▣ 이온 결합 (Ionic Bond)\n' +
        '- 양이온과 음이온 사이의 정전기적 인력으로 형성\n' +
        '- 주로 금속 + 비금속 사이에서 형성\n' +
        '- 이온 결합 화합물: 높은 녹는점, 물에 녹으면 전기 전도\n' +
        '  예) NaCl, MgO, CaCl₂\n\n' +
        '▣ 공유 결합 (Covalent Bond)\n' +
        '- 비금속 원자끼리 전자쌍을 공유하여 형성\n' +
        '- 단일 결합(H₂), 이중 결합(O₂), 삼중 결합(N₂)\n' +
        '- 공유 결합 화합물: 상대적으로 낮은 녹는점/끓는점',
      key_formulas: [
        '양이온: 원자 → 전자 잃음 → (+) 전하 (예: Na → Na⁺ + e⁻)',
        '음이온: 원자 → 전자 얻음 → (-) 전하 (예: Cl + e⁻ → Cl⁻)',
        '이온 결합: 양이온 + 음이온 → 정전기적 인력',
        '공유 결합: 비금속 + 비금속 → 전자쌍 공유',
      ],
      important_notes: [
        '양이온은 원자보다 크기가 작고, 음이온은 원자보다 크기가 크다.',
        '이온 결합과 공유 결합을 구별할 때, 금속+비금속=이온 결합, 비금속+비금속=공유 결합으로 판단한다.',
        '다원자 이온(NH₄⁺, SO₄²⁻ 등)은 여러 원자가 공유 결합으로 묶인 뒤 전체가 전하를 띠는 이온이다.',
      ],
    },
    {
      title: '화학 반응식 (Chemical Equations)',
      content:
        '화학 반응식은 화학 반응에서 반응물과 생성물을 화학식으로 나타낸 식이다.\n\n' +
        '▣ 화학 반응식의 구성\n' +
        '- 반응물(reactant): 화살표 왼쪽, 반응 전 물질\n' +
        '- 생성물(product): 화살표 오른쪽, 반응 후 물질\n' +
        '- 화살표(→): 반응 방향\n' +
        '- 계수(coefficient): 화학식 앞의 숫자, 각 물질의 분자 수 비\n\n' +
        '▣ 계수 맞추기 (Balancing)\n' +
        '화학 반응에서 원자는 새로 생기거나 없어지지 않으므로(질량 보존 법칙), ' +
        '반응물과 생성물의 각 원자 수가 같아야 한다.\n\n' +
        '계수 맞추기 방법:\n' +
        '1. 반응식의 반응물과 생성물을 화학식으로 쓴다\n' +
        '2. 각 원소의 원자 수를 비교한다\n' +
        '3. 계수를 조절하여 양쪽의 원자 수를 같게 맞춘다\n' +
        '4. 최소 정수비로 계수를 정리한다\n\n' +
        '예시:\n' +
        '- H₂ + O₂ → H₂O (미완성) → 2H₂ + O₂ → 2H₂O (완성)\n' +
        '- C₃H₈ + O₂ → CO₂ + H₂O → C₃H₈ + 5O₂ → 3CO₂ + 4H₂O\n' +
        '- Fe + O₂ → Fe₂O₃ → 4Fe + 3O₂ → 2Fe₂O₃',
      key_formulas: [
        '반응물 → 생성물 (화학 반응식의 기본 형태)',
        '질량 보존 법칙: 반응 전후 각 원소의 원자 수가 같다',
        '2H₂ + O₂ → 2H₂O (수소의 연소)',
        'C₃H₈ + 5O₂ → 3CO₂ + 4H₂O (프로판의 연소)',
      ],
      important_notes: [
        '화학식의 아래 첨자는 절대 바꾸지 않는다! 계수만 조절한다.',
        '계수 맞추기는 가장 복잡한 화학식(원자 종류가 많은 것)부터 시작하면 편리하다.',
        '계수가 1인 경우 생략한다.',
      ],
    },
  ];

  // ── Examples (worked problems) ──

  const all_examples: ExampleProblem[] = [
    {
      number: 1,
      problem:
        '탄소(C)의 원자번호는 6이고 질량수는 12이다. 탄소 원자의 양성자 수, 중성자 수, 전자 수를 각각 구하시오.',
      solution_steps: [
        '주어진 조건 정리: Z = 6, A = 12',
        '양성자 수 = 원자번호 = Z = 6',
        '중성자 수 = 질량수 - 원자번호 = A - Z = 12 - 6 = 6',
        '전자 수 = 양성자 수 = 6 (중성 원자)',
      ],
      answer: '양성자 6개, 중성자 6개, 전자 6개',
      difficulty: 'basic',
    },
    {
      number: 2,
      problem:
        '다음 이온의 양성자 수와 전자 수를 구하시오: (1) Na⁺ (원자번호 11), (2) Cl⁻ (원자번호 17)',
      solution_steps: [
        '(1) Na⁺: 원자번호 11 → 양성자 11개',
        'Na⁺는 전자 1개를 잃은 양이온 → 전자 수 = 11 - 1 = 10개',
        '(2) Cl⁻: 원자번호 17 → 양성자 17개',
        'Cl⁻는 전자 1개를 얻은 음이온 → 전자 수 = 17 + 1 = 18개',
      ],
      answer: '(1) Na⁺: 양성자 11개, 전자 10개 / (2) Cl⁻: 양성자 17개, 전자 18개',
      difficulty: 'standard',
    },
    {
      number: 3,
      problem:
        '다음 화학 반응식의 계수를 맞추시오: Al + O₂ → Al₂O₃',
      solution_steps: [
        '미완성 반응식: Al + O₂ → Al₂O₃',
        'Al: 왼쪽 1개, 오른쪽 2개 → Al₂O₃의 Al을 기준으로 왼쪽 Al에 계수 조정 필요',
        'O: 왼쪽 2개(O₂), 오른쪽 3개(Al₂O₃) → 최소공배수 이용',
        'O의 최소공배수: 6 → 3O₂(왼쪽), 2Al₂O₃(오른쪽)',
        'Al: 오른쪽 2×2 = 4개 → 왼쪽 4Al',
        '최종: 4Al + 3O₂ → 2Al₂O₃',
        '검산: Al 4=4, O 6=6',
      ],
      answer: '4Al + 3O₂ → 2Al₂O₃',
      difficulty: 'standard',
    },
    {
      number: 4,
      problem:
        '메탄(CH₄)의 완전 연소 반응식을 완성하고, 각 물질의 계수를 구하시오. (연소 생성물: CO₂, H₂O)',
      solution_steps: [
        '미완성: CH₄ + O₂ → CO₂ + H₂O',
        'C: 왼쪽 1개, 오른쪽 1개(CO₂) → C는 맞음',
        'H: 왼쪽 4개(CH₄), 오른쪽 2개(H₂O) → H₂O에 계수 2',
        'CH₄ + O₂ → CO₂ + 2H₂O',
        'O: 오른쪽 = 2(CO₂) + 2(2H₂O) = 4개 → 왼쪽 O₂에 계수 2',
        '최종: CH₄ + 2O₂ → CO₂ + 2H₂O',
        '검산: C 1=1, H 4=4, O 4=4',
      ],
      answer: 'CH₄ + 2O₂ → CO₂ + 2H₂O',
      difficulty: 'advanced',
    },
  ];

  // ── Practice Problems ──

  const all_practice: PracticeProblem[] = [
    {
      number: 1,
      problem: '원자번호 17, 질량수 35인 염소(Cl) 원자의 중성자 수는?',
      choices: [
        { label: CHOICE_LABELS[0], text: '17' },
        { label: CHOICE_LABELS[1], text: '18' },
        { label: CHOICE_LABELS[2], text: '35' },
        { label: CHOICE_LABELS[3], text: '52' },
        { label: CHOICE_LABELS[4], text: '8' },
      ],
      answer: CHOICE_LABELS[1],
      hint: 'N = A - Z = 35 - 17 = 18',
    },
    {
      number: 2,
      problem: '주기율표에서 같은 족(세로줄)에 있는 원소들의 공통점으로 옳은 것은?',
      choices: [
        { label: CHOICE_LABELS[0], text: '전자 껍질 수가 같다' },
        { label: CHOICE_LABELS[1], text: '질량수가 같다' },
        { label: CHOICE_LABELS[2], text: '원자가 전자 수가 같다' },
        { label: CHOICE_LABELS[3], text: '중성자 수가 같다' },
        { label: CHOICE_LABELS[4], text: '원자번호가 같다' },
      ],
      answer: CHOICE_LABELS[2],
      hint: '같은 족 원소는 원자가 전자 수가 같아서 화학적 성질이 유사하다',
    },
    {
      number: 3,
      problem: '다음 중 이온 결합 화합물에 해당하는 것은?',
      choices: [
        { label: CHOICE_LABELS[0], text: 'H₂O' },
        { label: CHOICE_LABELS[1], text: 'CO₂' },
        { label: CHOICE_LABELS[2], text: 'NaCl' },
        { label: CHOICE_LABELS[3], text: 'NH₃' },
        { label: CHOICE_LABELS[4], text: 'CH₄' },
      ],
      answer: CHOICE_LABELS[2],
      hint: '금속(Na) + 비금속(Cl)의 결합은 이온 결합이다',
    },
    {
      number: 4,
      problem: '산소 원자(O, 원자번호 8)가 안정한 이온이 될 때의 이온식과 전자 수는?',
      choices: [
        { label: CHOICE_LABELS[0], text: 'O⁺, 전자 7개' },
        { label: CHOICE_LABELS[1], text: 'O²⁺, 전자 6개' },
        { label: CHOICE_LABELS[2], text: 'O⁻, 전자 9개' },
        { label: CHOICE_LABELS[3], text: 'O²⁻, 전자 10개' },
        { label: CHOICE_LABELS[4], text: 'O²⁻, 전자 8개' },
      ],
      answer: CHOICE_LABELS[3],
      hint: '산소는 비금속으로 전자 2개를 얻어 O²⁻가 되어 안정(전자 8+2=10개)',
    },
    {
      number: 5,
      problem: '다음 화학 반응식에서 a의 값은? aH₂ + O₂ → 2H₂O',
      choices: [
        { label: CHOICE_LABELS[0], text: '1' },
        { label: CHOICE_LABELS[1], text: '2' },
        { label: CHOICE_LABELS[2], text: '3' },
        { label: CHOICE_LABELS[3], text: '4' },
        { label: CHOICE_LABELS[4], text: '6' },
      ],
      answer: CHOICE_LABELS[1],
      hint: 'H: 왼쪽 2a개, 오른쪽 4개 → 2a = 4 → a = 2',
    },
    {
      number: 6,
      problem:
        '¹⁶O와 ¹⁸O는 서로 동위 원소이다. 두 원소에 대한 설명으로 옳은 것을 모두 고르시오. ' +
        '(가) 양성자 수가 같다. (나) 중성자 수가 같다. (다) 화학적 성질이 같다.',
      answer: '(가), (다) — 동위 원소는 양성자 수(원자번호)가 같고, 중성자 수만 다르며, 화학적 성질은 같다.',
    },
    {
      number: 7,
      problem:
        '다음 중 공유 결합으로 이루어진 분자를 모두 고르시오: NaCl, H₂O, MgO, CO₂, KBr',
      answer: 'H₂O, CO₂ — 비금속 원자끼리 결합한 것이 공유 결합이다.',
      hint: '금속+비금속은 이온 결합, 비금속+비금속은 공유 결합',
    },
  ];

  // ── Level-based filtering ──
  // basic: first 3 examples, first 5 practice
  // standard: all examples, all practice
  // advanced: all examples, all practice
  const examples_count = config.level === 'basic' ? 3 : all_examples.length;
  const practice_count = config.level === 'basic' ? 5 : all_practice.length;

  const summary =
    '이 단원에서는 물질을 구성하는 기본 입자인 원자의 구조를 학습하였다. ' +
    '원자는 양성자와 중성자로 이루어진 원자핵과 그 주위의 전자로 구성되며, ' +
    '원자번호(양성자 수)가 원소의 종류를 결정한다. ' +
    '주기율표는 원소를 체계적으로 분류한 표로, 같은 족 원소는 원자가 전자 수가 같아 화학적 성질이 유사하다. ' +
    '원자가 전자를 잃거나 얻으면 이온이 되며, ' +
    '금속과 비금속은 이온 결합을, 비금속끼리는 공유 결합을 형성한다. ' +
    '화학 반응식에서는 질량 보존 법칙에 따라 양쪽의 원자 수를 맞추는 계수 맞추기가 핵심이다.';

  const key_terms: { term: string; definition: string }[] = [
    { term: '원자번호(Z)', definition: '원자핵 속 양성자의 수. 원소의 종류를 결정한다.' },
    { term: '질량수(A)', definition: '양성자 수와 중성자 수의 합. A = Z + N' },
    { term: '동위 원소', definition: '같은 원소(양성자 수 동일)에서 중성자 수가 다른 원자. 화학적 성질은 같다.' },
    { term: '주기', definition: '주기율표의 가로줄. 같은 주기의 원소는 전자 껍질 수가 같다.' },
    { term: '족', definition: '주기율표의 세로줄. 같은 족의 원소는 원자가 전자 수가 같아 화학적 성질이 유사하다.' },
    { term: '이온', definition: '원자가 전자를 잃거나 얻어서 전하를 띠게 된 입자. 양이온(+)과 음이온(-)이 있다.' },
    { term: '공유 결합', definition: '비금속 원자끼리 전자쌍을 공유하여 형성하는 화학 결합.' },
    { term: '이온 결합', definition: '양이온과 음이온 사이의 정전기적 인력으로 형성되는 화학 결합.' },
    { term: '화학 반응식', definition: '화학 반응의 반응물과 생성물을 화학식으로 나타낸 식. 계수를 맞추어야 한다.' },
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
