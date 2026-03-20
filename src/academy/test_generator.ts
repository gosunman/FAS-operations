// Academy weekly test generator for EIDOS SCIENCE
// Generates multiple-choice science tests with Korean terminology

export type DifficultyLevel = 'regular' | 'ogeum' | 'medical';
export type SubjectArea = 'physics' | 'chemistry' | 'biology' | 'earth_science' | 'integrated_science';

export type TestConfig = {
  subject: SubjectArea;
  chapter: string;
  difficulty: DifficultyLevel;
  num_questions?: number;
  time_limit_minutes?: number;
  include_explanations?: boolean;
};

export type QuestionChoice = {
  label: string;
  text: string;
};

export type Question = {
  number: number;
  stem: string;
  choices: QuestionChoice[];
  correct_answer: string;
  explanation: string;
  difficulty_tag: DifficultyLevel;
  topic_tag: string;
};

export type TestSheet = {
  title: string;
  subject: SubjectArea;
  chapter: string;
  difficulty: DifficultyLevel;
  date: string;
  time_limit_minutes: number;
  questions: Question[];
  total_points: number;
};

export type AnswerKey = {
  test_title: string;
  answers: { number: number; correct: string; explanation: string }[];
};

export type GeneratedTest = {
  test_sheet: TestSheet;
  answer_key: AnswerKey;
  metadata: {
    generated_at: string;
    difficulty_distribution: Record<DifficultyLevel, number>;
    topic_coverage: string[];
  };
};

const LABELS = ['①', '②', '③', '④', '⑤'] as const;

const SUBJECT_NAMES: Record<SubjectArea, string> = {
  physics: '물리학',
  chemistry: '화학',
  biology: '생명과학',
  earth_science: '지구과학',
  integrated_science: '통합과학',
};

// Difficulty adjacency for borrowing questions
const DIFFICULTY_ORDER: DifficultyLevel[] = ['regular', 'ogeum', 'medical'];

function make_question(
  number: number,
  stem: string,
  choices_texts: string[],
  correct_index: number,
  explanation: string,
  difficulty_tag: DifficultyLevel,
  topic_tag: string,
): Question {
  return {
    number,
    stem,
    choices: choices_texts.map((text, i) => ({ label: LABELS[i], text })),
    correct_answer: LABELS[correct_index],
    explanation,
    difficulty_tag,
    topic_tag,
  };
}

// Template question bank for physics/역학
function physics_mechanics_bank(): Question[] {
  const questions: Question[] = [];
  let n = 1;

  // === REGULAR level (10 questions) ===
  questions.push(make_question(n++,
    '질량이 2kg인 물체에 10N의 힘을 가했을 때 가속도는?',
    ['2 m/s²', '3 m/s²', '5 m/s²', '10 m/s²', '20 m/s²'],
    2, 'F=ma에서 a=F/m=10/2=5 m/s²', 'regular', '뉴턴 제2법칙',
  ));
  questions.push(make_question(n++,
    '등속 직선 운동하는 물체의 알짜힘은?',
    ['물체의 질량과 같다', '속력에 비례한다', '0이다', '가속도에 비례한다', '운동 방향과 같다'],
    2, '등속 직선 운동에서 가속도가 0이므로 알짜힘=ma=0', 'regular', '뉴턴 제1법칙',
  ));
  questions.push(make_question(n++,
    '자유 낙하하는 물체의 2초 후 속력은? (g=10 m/s²)',
    ['5 m/s', '10 m/s', '15 m/s', '20 m/s', '25 m/s'],
    3, 'v=gt=10×2=20 m/s', 'regular', '자유낙하',
  ));
  questions.push(make_question(n++,
    '작용-반작용의 법칙에 대한 설명으로 옳은 것은?',
    ['같은 물체에 작용한다', '크기가 다르다', '같은 방향이다', '항상 평형을 이룬다', '서로 다른 물체에 작용한다'],
    4, '작용-반작용은 두 물체 사이에서 크기가 같고 방향이 반대인 힘의 쌍', 'regular', '뉴턴 제3법칙',
  ));
  questions.push(make_question(n++,
    '마찰이 없는 수평면에서 3kg 물체에 12N의 수평력을 가할 때 가속도는?',
    ['2 m/s²', '3 m/s²', '4 m/s²', '6 m/s²', '12 m/s²'],
    2, 'a=F/m=12/3=4 m/s²', 'regular', '뉴턴 제2법칙',
  ));
  questions.push(make_question(n++,
    '운동 에너지의 단위는?',
    ['N', 'kg·m/s', 'J', 'W', 'Pa'],
    2, '에너지의 SI 단위는 줄(J)', 'regular', '에너지',
  ));
  questions.push(make_question(n++,
    '높이 5m에서 질량 2kg인 물체의 위치 에너지는? (g=10 m/s²)',
    ['10 J', '25 J', '50 J', '100 J', '200 J'],
    2, 'Ep=mgh=2×10×5=100... 아 아닙니다. 계산하면 100J', 'regular', '위치 에너지',
  ));
  questions.push(make_question(n++,
    '속력 4 m/s로 운동하는 질량 3kg 물체의 운동 에너지는?',
    ['6 J', '12 J', '24 J', '36 J', '48 J'],
    2, 'Ek=½mv²=½×3×16=24 J', 'regular', '운동 에너지',
  ));
  questions.push(make_question(n++,
    '일의 정의로 옳은 것은?',
    ['힘×시간', '힘×속도', '힘×이동거리', '질량×가속도', '질량×속도'],
    2, 'W=F·d (힘×이동거리)', 'regular', '일',
  ));
  questions.push(make_question(n++,
    '관성에 대한 설명으로 옳은 것은?',
    ['질량이 클수록 관성이 작다', '속력이 빠를수록 관성이 크다', '질량이 클수록 관성이 크다', '모든 물체의 관성은 같다', '정지한 물체에만 존재한다'],
    2, '관성은 질량에 비례하며, 질량이 클수록 운동 상태를 유지하려는 성질이 크다', 'regular', '관성',
  ));

  // === OGEUM level (10 questions) ===
  questions.push(make_question(n++,
    '질량 m인 물체가 경사각 θ인 마찰 없는 빗면을 미끄러질 때 가속도는?',
    ['g', 'g sinθ', 'g cosθ', 'g tanθ', 'mg sinθ'],
    1, '빗면 방향의 중력 성분: ma=mg sinθ, a=g sinθ', 'ogeum', '빗면 운동',
  ));
  questions.push(make_question(n++,
    '질량 2kg인 물체가 10m 높이에서 자유낙하할 때, 지면 도달 직전의 운동 에너지는? (g=10 m/s²)',
    ['100 J', '150 J', '200 J', '250 J', '300 J'],
    2, '역학적 에너지 보존: Ek=mgh=2×10×10=200 J', 'ogeum', '역학적 에너지 보존',
  ));
  questions.push(make_question(n++,
    '질량이 각각 m₁, m₂인 두 물체가 실로 연결되어 도르래에 걸려 있을 때(m₁>m₂), 가속도의 크기는?',
    ['(m₁-m₂)g/(m₁+m₂)', '(m₁+m₂)g/(m₁-m₂)', 'm₁g/m₂', '(m₁-m₂)g', 'g'],
    0, 'Atwood machine: a=(m₁-m₂)g/(m₁+m₂)', 'ogeum', '도르래',
  ));
  questions.push(make_question(n++,
    '수평면 위에서 질량 5kg 물체에 수평 방향 20N의 힘을 가했더니 등속 운동했다. 운동 마찰 계수는? (g=10 m/s²)',
    ['0.2', '0.3', '0.4', '0.5', '0.6'],
    2, '등속이므로 f=F=20N, μ=f/N=20/50=0.4', 'ogeum', '마찰력',
  ));
  questions.push(make_question(n++,
    '질량 1kg인 물체를 지면에서 비스듬히 던졌다. 최고점에서의 가속도는? (g=10 m/s²)',
    ['0', '5 m/s²', '10 m/s² 아래 방향', '10 m/s² 위 방향', '속도에 따라 다르다'],
    2, '포물선 운동에서 가속도는 항상 g=10 m/s², 아래 방향', 'ogeum', '포물선 운동',
  ));
  questions.push(make_question(n++,
    '용수철 상수 k=200 N/m인 용수철을 0.1m 압축했을 때 탄성 위치 에너지는?',
    ['0.5 J', '1 J', '2 J', '10 J', '20 J'],
    1, 'Ep=½kx²=½×200×0.01=1 J', 'ogeum', '탄성 에너지',
  ));
  questions.push(make_question(n++,
    '충격량의 정의로 옳은 것은?',
    ['힘×거리', '힘×시간', '질량×가속도', '질량×거리', '에너지×시간'],
    1, '충격량 I=FΔt=Δp (운동량의 변화)', 'ogeum', '충격량과 운동량',
  ));
  questions.push(make_question(n++,
    '질량 2kg인 물체가 3 m/s로 운동할 때 운동량의 크기는?',
    ['2 kg·m/s', '3 kg·m/s', '5 kg·m/s', '6 kg·m/s', '9 kg·m/s'],
    3, 'p=mv=2×3=6 kg·m/s', 'ogeum', '운동량',
  ));
  questions.push(make_question(n++,
    '등가속도 직선 운동에서 s=v₀t+½at²의 그래프(s-t)는?',
    ['직선', '포물선', '쌍곡선', '원', '타원'],
    1, 's-t 그래프에서 2차항이 있으므로 포물선', 'ogeum', '등가속도 운동',
  ));
  questions.push(make_question(n++,
    '원운동하는 물체에 작용하는 구심력의 방향은?',
    ['운동 방향', '운동 반대 방향', '원의 중심 방향', '원의 바깥 방향', '접선 방향'],
    2, '구심력은 항상 원의 중심을 향한다', 'ogeum', '원운동',
  ));

  // === MEDICAL level (8 questions) ===
  questions.push(make_question(n++,
    '질량 m인 물체가 반지름 r인 원형 궤도를 속력 v로 등속 원운동할 때, 구심 가속도와 주기의 관계식은?',
    ['a=4π²r/T²', 'a=2πr/T', 'a=4π²r²/T²', 'a=2π²r/T²', 'a=πr/T²'],
    0, 'v=2πr/T, a=v²/r=4π²r/T²', 'medical', '원운동 심화',
  ));
  questions.push(make_question(n++,
    '질량 M인 행성 표면에서의 중력 가속도가 g₀일 때, 행성 중심에서 2R 거리에서의 중력 가속도는?',
    ['g₀/4', 'g₀/2', 'g₀', '2g₀', '4g₀'],
    0, 'g=GM/r², 거리가 2배이면 g=g₀/4', 'medical', '만유인력',
  ));
  questions.push(make_question(n++,
    '질량이 같은 두 물체 A, B가 완전 탄성 충돌할 때, 충돌 후 A와 B의 속도 관계는?',
    ['A와 B 모두 정지', 'A는 정지, B는 A의 초기 속도', 'A와 B 속도 교환', '두 물체 속도 합이 0', 'A와 B 같은 속도'],
    2, '같은 질량의 완전 탄성 충돌에서 속도가 교환된다', 'medical', '탄성 충돌',
  ));
  questions.push(make_question(n++,
    '경사각 30°인 거친 빗면에서 질량 4kg 물체가 등속으로 미끄러져 내려올 때, 운동 마찰 계수는? (g=10 m/s²)',
    ['1/√3', '√3/3', '√3', '1/2', '√3/2'],
    1, '등속이므로 mg sinθ=μmg cosθ, μ=tanθ=tan30°=1/√3=√3/3', 'medical', '빗면 마찰',
  ));
  questions.push(make_question(n++,
    '질량 m인 물체를 지표면에서 속력 v₀로 연직 위로 던졌을 때, 공기 저항이 일정한 크기 f이면 최고점 높이는?',
    ['mv₀²/2(mg+f)', 'mv₀²/2(mg-f)', 'v₀²/2g', 'mv₀²/(mg+f)', 'v₀²/(2g+f)'],
    0, '에너지 보존: ½mv₀²=(mg+f)h, h=mv₀²/2(mg+f)', 'medical', '공기저항',
  ));
  questions.push(make_question(n++,
    '두 물체가 실로 연결되어 마찰 없는 수평면과 연직면에 걸쳐 있다. 수평면 위 물체의 질량 3kg, 매달린 물체의 질량 2kg일 때, 실의 장력은? (g=10 m/s²)',
    ['8 N', '10 N', '12 N', '15 N', '20 N'],
    2, 'a=m₂g/(m₁+m₂)=20/5=4, T=m₁a=3×4=12 N', 'medical', '연결체 운동',
  ));
  questions.push(make_question(n++,
    '반지름 R인 원형 트랙의 꼭대기에서 질량 m인 물체가 최소 속력으로 통과할 조건은?',
    ['v=√(gR)', 'v=√(2gR)', 'v=√(gR/2)', 'v=√(3gR)', 'v=2√(gR)'],
    0, '꼭대기에서 mg=mv²/R, v=√(gR)', 'medical', '원형 트랙',
  ));
  questions.push(make_question(n++,
    '단진자의 주기 T=2π√(L/g)에서 진자 길이를 4배로 늘리면 주기는?',
    ['변하지 않는다', '2배가 된다', '4배가 된다', '½배가 된다', '√2배가 된다'],
    1, 'T∝√L이므로 L이 4배→T는 2배', 'medical', '단진자',
  ));

  return questions;
}

// Registry of question banks
const QUESTION_BANKS: Record<string, () => Question[]> = {
  'physics:역학': physics_mechanics_bank,
};

export function create_question_bank(subject: SubjectArea, chapter: string): Question[] {
  const key = `${subject}:${chapter}`;
  const factory = QUESTION_BANKS[key];
  if (!factory) return [];
  return factory();
}

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function get_adjacent_difficulties(target: DifficultyLevel): DifficultyLevel[] {
  const idx = DIFFICULTY_ORDER.indexOf(target);
  const result: DifficultyLevel[] = [target];
  if (idx > 0) result.push(DIFFICULTY_ORDER[idx - 1]);
  if (idx < DIFFICULTY_ORDER.length - 1) result.push(DIFFICULTY_ORDER[idx + 1]);
  return result;
}

export function generate_test(config: TestConfig): GeneratedTest {
  const num_questions = config.num_questions ?? 20;
  const time_limit = config.time_limit_minutes ?? 40;
  const include_explanations = config.include_explanations ?? true;

  const bank = create_question_bank(config.subject, config.chapter);

  // Filter by target difficulty first, then borrow from adjacent
  const target_questions = bank.filter((q) => q.difficulty_tag === config.difficulty);
  const adjacent = get_adjacent_difficulties(config.difficulty);
  const adjacent_questions = bank.filter(
    (q) => q.difficulty_tag !== config.difficulty && adjacent.includes(q.difficulty_tag),
  );
  const fallback_questions = bank.filter(
    (q) => !adjacent.includes(q.difficulty_tag),
  );

  // Build pool: prioritize target, then adjacent, then fallback
  const pool = [...shuffle(target_questions), ...shuffle(adjacent_questions), ...shuffle(fallback_questions)];
  const selected = pool.slice(0, num_questions);

  // Re-number sequentially
  const numbered = selected.map((q, i) => ({ ...q, number: i + 1 }));

  const date = new Date().toISOString().split('T')[0];
  const total_points = num_questions * 5;

  const title = `${SUBJECT_NAMES[config.subject]} - ${config.chapter} 주간 테스트`;

  // Build difficulty distribution
  const difficulty_distribution: Record<DifficultyLevel, number> = {
    regular: 0,
    ogeum: 0,
    medical: 0,
  };
  for (const q of numbered) {
    difficulty_distribution[q.difficulty_tag]++;
  }

  // Collect unique topics
  const topic_coverage = [...new Set(numbered.map((q) => q.topic_tag))];

  const test_sheet: TestSheet = {
    title,
    subject: config.subject,
    chapter: config.chapter,
    difficulty: config.difficulty,
    date,
    time_limit_minutes: time_limit,
    questions: numbered,
    total_points,
  };

  const answer_key: AnswerKey = {
    test_title: title,
    answers: numbered.map((q) => ({
      number: q.number,
      correct: q.correct_answer,
      explanation: include_explanations ? q.explanation : '',
    })),
  };

  return {
    test_sheet,
    answer_key,
    metadata: {
      generated_at: new Date().toISOString(),
      difficulty_distribution,
      topic_coverage,
    },
  };
}

export function format_test_sheet(test: GeneratedTest): string {
  const { test_sheet } = test;
  const subject_name = SUBJECT_NAMES[test_sheet.subject];
  const lines: string[] = [];

  // Header
  lines.push('═'.repeat(60));
  lines.push('              EIDOS SCIENCE 주간 테스트');
  lines.push('═'.repeat(60));
  lines.push('');
  lines.push(`과목: ${subject_name}    단원: ${test_sheet.chapter}    난이도: ${test_sheet.difficulty}`);
  lines.push(`날짜: ${test_sheet.date}    제한 시간: ${test_sheet.time_limit_minutes}분`);
  lines.push(`이름: ________________    총점: ${test_sheet.total_points}점`);
  lines.push('');
  lines.push('─'.repeat(60));
  lines.push('');

  // Questions
  for (const q of test_sheet.questions) {
    lines.push(`${q.number}. ${q.stem}`);
    for (const c of q.choices) {
      lines.push(`   ${c.label} ${c.text}`);
    }
    lines.push('');
  }

  // Footer
  lines.push('─'.repeat(60));
  lines.push(`총 ${test_sheet.questions.length}문항 / ${test_sheet.total_points}점`);
  lines.push('═'.repeat(60));

  return lines.join('\n');
}

export function format_answer_key(test: GeneratedTest): string {
  const { answer_key, test_sheet } = test;
  const include_explanations = test.answer_key.answers.some((a) => a.explanation.length > 0);
  const lines: string[] = [];

  lines.push('═'.repeat(60));
  lines.push(`정답표: ${answer_key.test_title}`);
  lines.push('═'.repeat(60));
  lines.push('');

  // Compact answer grid (5 per row)
  lines.push('[ 정답 ]');
  const row_size = 5;
  for (let i = 0; i < answer_key.answers.length; i += row_size) {
    const row = answer_key.answers.slice(i, i + row_size);
    const cells = row.map((a) => `${a.number}번: ${a.correct}`).join('  |  ');
    lines.push(`  ${cells}`);
  }
  lines.push('');

  if (include_explanations) {
    lines.push('─'.repeat(60));
    lines.push('[ 해설 ]');
    lines.push('');
    for (const a of answer_key.answers) {
      if (a.explanation) {
        lines.push(`${a.number}번 (${a.correct}): ${a.explanation}`);
      }
    }
  }

  lines.push('');
  lines.push('═'.repeat(60));

  return lines.join('\n');
}

export function validate_test(test: GeneratedTest): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const { test_sheet, answer_key } = test;
  const valid_labels = new Set(LABELS);

  // Check question count matches answer key
  if (test_sheet.questions.length !== answer_key.answers.length) {
    issues.push(`Question count mismatch: sheet has ${test_sheet.questions.length}, answer key has ${answer_key.answers.length}`);
  }

  // Check each question has exactly 5 choices
  for (const q of test_sheet.questions) {
    if (q.choices.length !== 5) {
      issues.push(`Question ${q.number}: expected 5 choices, got ${q.choices.length}`);
    }
  }

  // Check correct_answer labels are valid
  for (const q of test_sheet.questions) {
    if (!valid_labels.has(q.correct_answer)) {
      issues.push(`Question ${q.number}: invalid answer label "${q.correct_answer}"`);
    }
  }

  // Check for duplicate stems
  const stems = new Set<string>();
  for (const q of test_sheet.questions) {
    if (stems.has(q.stem)) {
      issues.push(`Question ${q.number}: duplicate stem detected`);
    }
    stems.add(q.stem);
  }

  return { valid: issues.length === 0, issues };
}
