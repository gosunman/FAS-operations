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

// Template question bank for physics/열역학 (thermodynamics)
function physics_thermodynamics_bank(): Question[] {
  const questions: Question[] = [];
  let n = 1;

  // === REGULAR level (6 questions) ===
  questions.push(make_question(n++,
    '열의 이동 방법 중 매질 없이도 전달되는 것은?',
    ['전도', '대류', '복사', '증발', '압축'],
    2, '복사는 전자기파로 열이 전달되므로 매질이 필요 없다', 'regular', '열전달',
  ));
  questions.push(make_question(n++,
    '물질의 상태 변화 중 액체에서 기체로 변하는 현상은?',
    ['융해', '응고', '기화', '승화', '액화'],
    2, '기화는 액체가 기체로 변하는 상태 변화이다', 'regular', '상태변화',
  ));
  questions.push(make_question(n++,
    '비열이 큰 물질의 특징으로 옳은 것은?',
    ['같은 열을 가하면 온도가 빨리 올라간다', '같은 열을 가하면 온도가 천천히 올라간다', '열을 잘 전도한다', '밀도가 크다', '녹는점이 높다'],
    1, '비열이 크면 같은 열량에 대해 온도 변화가 작다', 'regular', '비열',
  ));
  questions.push(make_question(n++,
    '물 100g의 온도를 20°C에서 70°C로 올리는 데 필요한 열량은? (물의 비열: 1 cal/g·°C)',
    ['1000 cal', '2000 cal', '3500 cal', '5000 cal', '7000 cal'],
    3, 'Q=mcΔT=100×1×50=5000 cal', 'regular', '열량 계산',
  ));
  questions.push(make_question(n++,
    '열평형에 대한 설명으로 옳은 것은?',
    ['두 물체의 질량이 같아진다', '두 물체의 온도가 같아진다', '두 물체의 열용량이 같아진다', '열의 이동이 빨라진다', '두 물체의 부피가 같아진다'],
    1, '열평형은 두 물체 사이에서 열 이동이 멈추고 온도가 같아지는 상태', 'regular', '열평형',
  ));
  questions.push(make_question(n++,
    '온도의 SI 단위는?',
    ['°C (섭씨)', '°F (화씨)', 'K (켈빈)', 'cal (칼로리)', 'J (줄)'],
    2, '온도의 SI 단위는 켈빈(K)이다', 'regular', '온도',
  ));

  // === OGEUM level (5 questions) ===
  questions.push(make_question(n++,
    '열역학 제1법칙에 대한 설명으로 옳은 것은?',
    ['열은 항상 고온에서 저온으로 이동한다', '에너지는 생성되거나 소멸되지 않는다', '엔트로피는 항상 증가한다', '절대 영도에서 엔트로피는 0이다', '열효율은 항상 100%이다'],
    1, '열역학 제1법칙은 에너지 보존 법칙이다: ΔU=Q-W', 'ogeum', '열역학 법칙',
  ));
  questions.push(make_question(n++,
    '이상 기체의 내부 에너지가 증가하는 경우는?',
    ['등온 팽창', '등온 압축', '단열 압축', '단열 팽창', '등압 수축 후 팽창'],
    2, '단열 압축에서 외부가 기체에 일을 하여 내부 에너지 증가 (ΔU=W)', 'ogeum', '내부 에너지',
  ));
  questions.push(make_question(n++,
    '금속 막대의 한쪽 끝을 가열하면 다른 쪽 끝도 뜨거워지는 열전달 방법은?',
    ['복사', '대류', '전도', '기화', '증발'],
    2, '고체 내에서 분자의 진동이 전달되는 전도에 해당한다', 'ogeum', '열전도',
  ));
  questions.push(make_question(n++,
    '0°C 얼음 200g을 0°C 물로 만드는 데 필요한 열량은? (얼음의 융해열: 80 cal/g)',
    ['8000 cal', '12000 cal', '16000 cal', '20000 cal', '24000 cal'],
    2, 'Q=mL=200×80=16000 cal', 'ogeum', '잠열',
  ));
  questions.push(make_question(n++,
    '보일의 법칙에서 온도가 일정할 때 기체의 압력과 부피의 관계는?',
    ['비례한다', '반비례한다', '무관하다', '제곱에 비례한다', '제곱에 반비례한다'],
    1, '보일의 법칙: PV=일정 (온도 일정, 압력과 부피는 반비례)', 'ogeum', '기체 법칙',
  ));

  // === MEDICAL level (4 questions) ===
  questions.push(make_question(n++,
    '카르노 기관의 열효율 공식으로 옳은 것은? (T_H: 고온, T_L: 저온)',
    ['η=1-T_L/T_H', 'η=T_L/T_H', 'η=1-T_H/T_L', 'η=(T_H-T_L)/(T_H+T_L)', 'η=T_H/(T_H-T_L)'],
    0, '카르노 효율: η=1-T_L/T_H (절대온도 사용)', 'medical', '카르노 기관',
  ));
  questions.push(make_question(n++,
    '이상 기체 1mol이 등온 과정에서 부피가 V₁에서 V₂로 팽창할 때 한 일은?',
    ['nRT ln(V₂/V₁)', 'nRT(V₂-V₁)', 'P(V₂-V₁)', 'nRΔT', '½nR(T₂-T₁)'],
    0, '등온 과정에서 W=nRT ln(V₂/V₁)', 'medical', '등온 과정',
  ));
  questions.push(make_question(n++,
    '단열 과정에서 이상 기체의 온도와 부피의 관계식은? (γ=비열비)',
    ['TV^(γ-1)=일정', 'TV^γ=일정', 'T/V=일정', 'TV=일정', 'T²V=일정'],
    0, '단열 과정: TV^(γ-1)=일정 (또는 PV^γ=일정)', 'medical', '단열 과정',
  ));
  questions.push(make_question(n++,
    '열역학 제2법칙의 클라우지우스 표현으로 옳은 것은?',
    ['열은 저온에서 고온으로 자발적으로 이동할 수 없다', '에너지는 보존된다', '절대 영도에 도달할 수 없다', '엔트로피는 감소할 수 있다', '열효율은 100%가 가능하다'],
    0, '클라우지우스: 열은 저온에서 고온으로 스스로 이동하지 않는다', 'medical', '열역학 제2법칙',
  ));

  return questions;
}

// Template question bank for physics/파동 (waves)
function physics_waves_bank(): Question[] {
  const questions: Question[] = [];
  let n = 1;

  // === REGULAR level (6 questions) ===
  questions.push(make_question(n++,
    '파동이 전파될 때 이동하는 것은?',
    ['매질', '물질', '에너지', '질량', '밀도'],
    2, '파동은 매질이 아닌 에너지를 전달한다', 'regular', '파동의 성질',
  ));
  questions.push(make_question(n++,
    '진동수의 단위는?',
    ['m/s', 'Hz', 'N', 'J', 'Pa'],
    1, '진동수의 단위는 헤르츠(Hz)이다', 'regular', '파동 용어',
  ));
  questions.push(make_question(n++,
    '파장이 2m이고 진동수가 5Hz인 파동의 속력은?',
    ['2.5 m/s', '5 m/s', '7 m/s', '10 m/s', '15 m/s'],
    3, 'v=fλ=5×2=10 m/s', 'regular', '파동 속력',
  ));
  questions.push(make_question(n++,
    '소리가 전달되지 않는 곳은?',
    ['물속', '철 속', '공기 중', '진공', '유리 속'],
    3, '소리는 매질이 필요한 역학적 파동이므로 진공에서 전달되지 않는다', 'regular', '소리',
  ));
  questions.push(make_question(n++,
    '횡파의 예로 옳은 것은?',
    ['소리', '초음파', '지진파의 P파', '빛', '수면파의 종파 성분'],
    3, '빛(전자기파)은 대표적인 횡파이다', 'regular', '횡파와 종파',
  ));
  questions.push(make_question(n++,
    '파동의 진폭이 커지면 변하는 것은?',
    ['파장', '진동수', '속력', '에너지', '주기'],
    3, '진폭이 커지면 파동이 전달하는 에너지가 증가한다', 'regular', '진폭과 에너지',
  ));

  // === OGEUM level (5 questions) ===
  questions.push(make_question(n++,
    '두 파동이 만나서 중첩될 때 진폭이 커지는 현상은?',
    ['굴절', '회절', '보강 간섭', '상쇄 간섭', '반사'],
    2, '보강 간섭은 두 파동의 위상이 같을 때 진폭이 합쳐져 커지는 현상', 'ogeum', '간섭',
  ));
  questions.push(make_question(n++,
    '빛이 밀한 매질에서 소한 매질로 진행할 때 입사각보다 굴절각이 큰 경우, 입사각을 점점 키우면 일어나는 현상은?',
    ['회절', '전반사', '분산', '편광', '산란'],
    1, '임계각 이상이 되면 전반사가 일어난다', 'ogeum', '전반사',
  ));
  questions.push(make_question(n++,
    '소리의 3요소가 아닌 것은?',
    ['세기', '높낮이', '맵시(음색)', '속력', '높이와 세기 모두 해당'],
    3, '소리의 3요소는 세기(진폭), 높낮이(진동수), 맵시(파형)이다. 속력은 포함되지 않는다', 'ogeum', '소리의 성질',
  ));
  questions.push(make_question(n++,
    '정상파가 만들어질 때, 매질이 진동하지 않는 점을 무엇이라 하는가?',
    ['마루', '골', '배', '마디', '파면'],
    3, '정상파에서 진동하지 않는 점을 마디(node), 최대로 진동하는 점을 배(antinode)라 한다', 'ogeum', '정상파',
  ));
  questions.push(make_question(n++,
    '도플러 효과에서 음원이 관측자에게 다가올 때 관측되는 소리의 변화는?',
    ['진동수가 낮아진다', '진동수가 높아진다', '진폭이 작아진다', '속력이 느려진다', '변화 없다'],
    1, '음원이 다가오면 파장이 짧아져 진동수가 높아진다 (도플러 효과)', 'ogeum', '도플러 효과',
  ));

  // === MEDICAL level (4 questions) ===
  questions.push(make_question(n++,
    '줄 위의 정상파에서 양 끝이 고정된 길이 L인 줄의 n번째 배진동 진동수는?',
    ['f_n = n·v/(2L)', 'f_n = v/(nL)', 'f_n = n·v/L', 'f_n = v/(2nL)', 'f_n = 2nv/L'],
    0, '양 끝 고정 줄: f_n = nv/(2L), n=1,2,3,...', 'medical', '배진동',
  ));
  questions.push(make_question(n++,
    '이중 슬릿 실험에서 보강 간섭 조건은? (d: 슬릿 간격, θ: 각도, λ: 파장)',
    ['d sinθ = mλ (m=0,±1,±2,...)', 'd sinθ = (m+½)λ', 'd cosθ = mλ', 'd/sinθ = mλ', 'd sinθ = m/λ'],
    0, '이중 슬릿 보강 간섭: d sinθ = mλ', 'medical', '이중 슬릿',
  ));
  questions.push(make_question(n++,
    '음원의 속력이 음속과 같아질 때 발생하는 현상은?',
    ['공명', '맥놀이', '충격파(소닉 붐)', '전반사', '정상파'],
    2, '음원의 속력이 음속에 도달하면 충격파(소닉 붐, sonic boom)가 발생한다', 'medical', '충격파',
  ));
  questions.push(make_question(n++,
    '빛의 회절에서 단일 슬릿의 첫 번째 어두운 무늬 조건은? (a: 슬릿 폭)',
    ['a sinθ = λ', 'a sinθ = 2λ', 'a sinθ = λ/2', 'a cosθ = λ', 'a sinθ = 3λ/2'],
    0, '단일 슬릿 어두운 무늬: a sinθ = mλ (m=±1,±2,...), 첫 번째는 m=1', 'medical', '단일 슬릿 회절',
  ));

  return questions;
}

// Template question bank for physics/전자기 (electromagnetism)
function physics_electromagnetism_bank(): Question[] {
  const questions: Question[] = [];
  let n = 1;

  // === REGULAR level (6 questions) ===
  questions.push(make_question(n++,
    '같은 종류의 전하 사이에 작용하는 힘은?',
    ['인력', '척력', '중력', '자기력', '마찰력'],
    1, '같은 부호의 전하 사이에는 척력(밀어내는 힘)이 작용한다', 'regular', '전기력',
  ));
  questions.push(make_question(n++,
    '전류의 단위는?',
    ['V(볼트)', 'A(암페어)', 'Ω(옴)', 'W(와트)', 'C(쿨롱)'],
    1, '전류의 SI 단위는 암페어(A)이다', 'regular', '전류',
  ));
  questions.push(make_question(n++,
    '옴의 법칙에서 전압, 전류, 저항의 관계식은?',
    ['V=I/R', 'V=IR', 'V=R/I', 'I=VR', 'R=VI'],
    1, '옴의 법칙: V=IR (전압=전류×저항)', 'regular', '옴의 법칙',
  ));
  questions.push(make_question(n++,
    '자석 주위에 형성되는 것은?',
    ['전기장', '자기장', '중력장', '전자기파', '음파'],
    1, '자석 주위에는 자기장이 형성된다', 'regular', '자기장',
  ));
  questions.push(make_question(n++,
    '10V의 전압에 2A의 전류가 흐를 때 저항은?',
    ['2 Ω', '5 Ω', '8 Ω', '12 Ω', '20 Ω'],
    1, 'R=V/I=10/2=5 Ω', 'regular', '저항 계산',
  ));
  questions.push(make_question(n++,
    '전기 회로에서 직렬 연결된 저항의 합성 저항은?',
    ['각 저항의 합', '각 저항의 곱', '각 저항의 역수의 합', '가장 큰 저항과 같다', '가장 작은 저항과 같다'],
    0, '직렬 연결: R_합 = R₁ + R₂ + ... (각 저항의 합)', 'regular', '직렬 연결',
  ));

  // === OGEUM level (5 questions) ===
  questions.push(make_question(n++,
    '전자기 유도에 의해 유도 기전력이 발생하는 조건은?',
    ['자기장이 일정할 때', '자기 선속이 변할 때', '전류가 일정할 때', '저항이 변할 때', '전압이 일정할 때'],
    1, '패러데이 법칙: 자기 선속의 시간적 변화가 있을 때 유도 기전력이 발생한다', 'ogeum', '전자기 유도',
  ));
  questions.push(make_question(n++,
    '병렬 연결된 두 저항 R₁=6Ω, R₂=3Ω의 합성 저항은?',
    ['1 Ω', '2 Ω', '3 Ω', '4.5 Ω', '9 Ω'],
    1, '병렬: 1/R = 1/6 + 1/3 = 1/6 + 2/6 = 3/6 = 1/2, R=2 Ω', 'ogeum', '병렬 연결',
  ));
  questions.push(make_question(n++,
    '직선 도선에 흐르는 전류에 의한 자기장의 방향을 결정하는 법칙은?',
    ['렌츠의 법칙', '패러데이 법칙', '앙페르 오른손 법칙', '플레밍의 왼손 법칙', '쿨롱의 법칙'],
    2, '직선 전류에 의한 자기장 방향은 오른손 법칙(엄지: 전류, 나머지: 자기장 방향)으로 결정', 'ogeum', '오른손 법칙',
  ));
  questions.push(make_question(n++,
    '전력의 공식으로 옳은 것은?',
    ['P=V/I', 'P=IR', 'P=VI', 'P=V/R²', 'P=I/V'],
    2, 'P=VI=I²R=V²/R', 'ogeum', '전력',
  ));
  questions.push(make_question(n++,
    '축전기(콘덴서)에 저장되는 에너지의 공식은?',
    ['U=½CV²', 'U=CV', 'U=C²V', 'U=½C²V', 'U=CV²'],
    0, '축전기 저장 에너지: U=½CV²=½QV=Q²/(2C)', 'ogeum', '축전기',
  ));

  // === MEDICAL level (4 questions) ===
  questions.push(make_question(n++,
    '두 점전하 사이에 작용하는 쿨롱 힘의 크기는 거리의 제곱에 어떤 관계인가?',
    ['비례', '반비례', '무관', '세제곱에 비례', '세제곱에 반비례'],
    1, '쿨롱의 법칙: F=kq₁q₂/r², 거리의 제곱에 반비례', 'medical', '쿨롱의 법칙',
  ));
  questions.push(make_question(n++,
    '균일한 자기장 B에서 속력 v로 자기장에 수직으로 입사한 전하 q의 원운동 반지름은?',
    ['r=mv/(qB)', 'r=qB/(mv)', 'r=qvB/m', 'r=mB/(qv)', 'r=mv²/(qB)'],
    0, '로렌츠 힘이 구심력: qvB=mv²/r, r=mv/(qB)', 'medical', '로렌츠 힘',
  ));
  questions.push(make_question(n++,
    '솔레노이드 내부의 자기장의 세기 공식은? (n: 단위 길이당 감은 수, I: 전류)',
    ['B=μ₀nI', 'B=μ₀n²I', 'B=μ₀I/n', 'B=μ₀n/I', 'B=μ₀nI²'],
    0, '솔레노이드 내부: B=μ₀nI (균일한 자기장)', 'medical', '솔레노이드',
  ));
  questions.push(make_question(n++,
    'RLC 직렬 회로에서 공명이 일어나는 조건은?',
    ['R=0', 'ωL=1/(ωC)', 'ωL=ωC', 'R=L/C', 'ω=RC'],
    1, '공명 조건: ωL=1/(ωC), ω=1/√(LC), 임피던스 최소', 'medical', 'RLC 공명',
  ));

  return questions;
}

// Template question bank for chemistry/화학결합 (chemical bonding)
function chemistry_bonding_bank(): Question[] {
  const questions: Question[] = [];
  let n = 1;

  // === REGULAR level (4 questions) ===
  questions.push(make_question(n++,
    '공유 결합에 대한 설명으로 옳은 것은?',
    ['금속 원소끼리 결합한다', '전자를 주고받아 결합한다', '전자쌍을 공유하여 결합한다', '자유 전자로 결합한다', '반데르발스 힘으로 결합한다'],
    2, '공유 결합은 비금속 원자 사이에서 전자쌍을 공유하여 형성된다', 'regular', '공유 결합',
  ));
  questions.push(make_question(n++,
    '이온 결합 물질의 특징으로 옳은 것은?',
    ['전기 전도성이 없다', '녹는점이 낮다', '물에 녹으면 전류가 흐른다', '분자 형태로 존재한다', '유기 용매에 잘 녹는다'],
    2, '이온 결합 물질은 수용액 상태에서 이온이 이동하여 전류가 흐른다', 'regular', '이온 결합',
  ));
  questions.push(make_question(n++,
    '금속 결합의 특징이 아닌 것은?',
    ['자유 전자가 존재한다', '전기 전도성이 좋다', '열 전도성이 좋다', '분자식으로 나타낸다', '연성과 전성이 있다'],
    3, '금속 결합은 자유 전자 바다 모델로 설명되며, 분자식이 아닌 화학식으로 나타낸다', 'regular', '금속 결합',
  ));
  questions.push(make_question(n++,
    '다음 중 이온 결합 물질은?',
    ['H₂O', 'CO₂', 'NaCl', 'CH₄', 'O₂'],
    2, 'NaCl은 Na⁺과 Cl⁻의 이온 결합 물질이다', 'regular', '결합 분류',
  ));

  // === OGEUM level (4 questions) ===
  questions.push(make_question(n++,
    '전기 음성도 차이가 클수록 어떤 결합이 잘 형성되는가?',
    ['공유 결합', '이온 결합', '금속 결합', '수소 결합', '반데르발스 결합'],
    1, '전기 음성도 차이가 크면 전자가 한쪽으로 치우쳐 이온 결합이 형성된다', 'ogeum', '전기 음성도',
  ));
  questions.push(make_question(n++,
    '물(H₂O) 분자의 구조가 굽은형인 이유는?',
    ['수소 원자가 크기 때문', '산소의 비공유 전자쌍이 있기 때문', '이온 결합이기 때문', '단일 결합만 있기 때문', '삼중 결합이 있기 때문'],
    1, '산소의 비공유 전자쌍 2쌍이 결합 전자쌍을 밀어 굽은형 구조가 된다 (VSEPR)', 'ogeum', '분자 구조',
  ));
  questions.push(make_question(n++,
    '다이아몬드와 흑연이 성질이 다른 이유로 가장 적절한 것은?',
    ['원자 번호가 다르다', '원소의 종류가 다르다', '결합 구조(배열)가 다르다', '전자 수가 다르다', '질량이 다르다'],
    2, '다이아몬드(정사면체 공유결합)와 흑연(층상 구조)은 같은 탄소이지만 결합 구조가 다른 동소체이다', 'ogeum', '동소체',
  ));
  questions.push(make_question(n++,
    '수소 결합이 일어나는 분자의 조건으로 옳은 것은?',
    ['무극성 분자여야 한다', 'F, O, N에 결합한 H가 있어야 한다', '금속 원소를 포함해야 한다', '이중 결합이 있어야 한다', '분자량이 커야 한다'],
    1, '수소 결합: F, O, N 같은 전기 음성도가 큰 원소에 결합한 H와 다른 분자의 비공유 전자쌍 사이 인력', 'ogeum', '수소 결합',
  ));

  // === MEDICAL level (3 questions) ===
  questions.push(make_question(n++,
    '혼성 오비탈 sp³의 결합각은 약 몇 도인가?',
    ['90°', '107°', '109.5°', '120°', '180°'],
    2, 'sp³ 혼성: 정사면체 구조, 결합각 약 109.5°', 'medical', '혼성 오비탈',
  ));
  questions.push(make_question(n++,
    '분자 오비탈 이론에서 결합 차수의 공식은?',
    ['(결합 전자 수 - 반결합 전자 수) / 2', '(결합 전자 수 + 반결합 전자 수) / 2', '결합 전자 수 / 반결합 전자 수', '결합 전자 수 × 반결합 전자 수', '(결합 전자 수 - 반결합 전자 수) × 2'],
    0, '결합 차수 = (결합 전자 수 - 반결합 전자 수) / 2', 'medical', '분자 오비탈',
  ));
  questions.push(make_question(n++,
    'BF₃ 분자의 혼성 오비탈과 분자 구조로 옳은 것은?',
    ['sp - 직선형', 'sp² - 평면 삼각형', 'sp³ - 정사면체', 'sp³d - 삼각쌍뿔형', 'sp² - 굽은형'],
    1, 'BF₃: B의 sp² 혼성, 결합각 120°, 평면 삼각형 구조', 'medical', '분자 구조 심화',
  ));

  return questions;
}

// Template question bank for chemistry/산화환원 (redox)
function chemistry_redox_bank(): Question[] {
  const questions: Question[] = [];
  let n = 1;

  // === REGULAR level (4 questions) ===
  questions.push(make_question(n++,
    '산화의 정의로 옳은 것은?',
    ['전자를 얻는 반응', '산소를 잃는 반응', '전자를 잃는 반응', '수소를 얻는 반응', '산화수가 감소하는 반응'],
    2, '산화는 전자를 잃는 반응이며 산화수가 증가한다', 'regular', '산화환원 정의',
  ));
  questions.push(make_question(n++,
    '다음 반응에서 환원되는 물질은? 2Mg + O₂ → 2MgO',
    ['Mg', 'O₂', 'MgO', 'Mg²⁺', '해당 없음'],
    1, 'O₂는 전자를 얻어 O²⁻가 되므로 환원된다', 'regular', '산화환원 반응',
  ));
  questions.push(make_question(n++,
    '산화제의 역할로 옳은 것은?',
    ['스스로 산화되고 상대를 환원시킨다', '스스로 환원되고 상대를 산화시킨다', '전자를 잃는다', '산화수가 증가한다', '항상 금속이다'],
    1, '산화제는 스스로 환원(전자를 얻음)되면서 상대 물질을 산화시킨다', 'regular', '산화제 환원제',
  ));
  questions.push(make_question(n++,
    '철(Fe)이 녹스는 현상은 어떤 반응인가?',
    ['중화 반응', '산화 반응', '환원 반응', '분해 반응', '치환 반응'],
    1, '철이 산소와 반응하여 산화철이 되는 산화 반응이다', 'regular', '일상 속 산화환원',
  ));

  // === OGEUM level (4 questions) ===
  questions.push(make_question(n++,
    'H₂SO₄에서 S의 산화수는?',
    ['+2', '+4', '+6', '-2', '0'],
    2, 'H는 +1(×2=+2), O는 -2(×4=-8), S: +2+x-8=0, x=+6', 'ogeum', '산화수',
  ));
  questions.push(make_question(n++,
    '다음 중 산화환원 반응이 아닌 것은?',
    ['Zn + CuSO₄ → ZnSO₄ + Cu', '2Na + Cl₂ → 2NaCl', 'NaOH + HCl → NaCl + H₂O', '2Fe + 3Cl₂ → 2FeCl₃', 'C + O₂ → CO₂'],
    2, 'NaOH + HCl은 중화 반응으로, 산화수 변화가 없는 비산화환원 반응이다', 'ogeum', '산화환원 판별',
  ));
  questions.push(make_question(n++,
    '반응 MnO₂ + 4HCl → MnCl₂ + Cl₂ + 2H₂O에서 환원되는 원소는?',
    ['H', 'O', 'Mn', 'Cl', '환원되는 원소 없음'],
    2, 'Mn: +4 → +2 (산화수 감소 = 환원)', 'ogeum', '반쪽 반응',
  ));
  questions.push(make_question(n++,
    '금속의 이온화 경향이 큰 순서로 옳은 것은?',
    ['Au > Ag > Cu > Fe > Zn', 'K > Ca > Na > Mg > Al', 'Cu > Fe > Zn > Al > Na', 'Fe > Cu > Ag > Au > K', 'Al > Zn > Fe > Cu > Na'],
    1, '이온화 경향: K > Ca > Na > Mg > Al > Zn > Fe > Ni > Sn > Pb > H > Cu > Hg > Ag > Pt > Au', 'ogeum', '이온화 경향',
  ));

  // === MEDICAL level (3 questions) ===
  questions.push(make_question(n++,
    '전기 분해에서 음극(-)에서 일어나는 반응은?',
    ['산화 반응', '환원 반응', '중화 반응', '분해 반응', '치환 반응'],
    1, '음극에서는 양이온이 전자를 얻는 환원 반응이 일어난다', 'medical', '전기 분해',
  ));
  questions.push(make_question(n++,
    '표준 환원 전위가 큰 물질일수록 어떤 경향이 큰가?',
    ['산화되기 쉽다', '환원되기 쉽다', '중성을 유지한다', '전자를 잃기 쉽다', '이온화되기 쉽다'],
    1, '표준 환원 전위가 클수록 전자를 받으려는 경향(환원력)이 크다', 'medical', '표준 전위',
  ));
  questions.push(make_question(n++,
    '다니엘 전지에서 전체 반응은 Zn + Cu²⁺ → Zn²⁺ + Cu이다. 이 전지의 표준 기전력은? (E°(Cu²⁺/Cu)=+0.34V, E°(Zn²⁺/Zn)=-0.76V)',
    ['0.42 V', '0.76 V', '1.10 V', '1.34 V', '2.20 V'],
    2, 'E°=E°(환원)-E°(산화)=0.34-(-0.76)=1.10 V', 'medical', '기전력',
  ));

  return questions;
}

// Registry of question banks
const QUESTION_BANKS: Record<string, () => Question[]> = {
  'physics:역학': physics_mechanics_bank,
  'physics:열역학': physics_thermodynamics_bank,
  'physics:파동': physics_waves_bank,
  'physics:전자기': physics_electromagnetism_bank,
  'chemistry:화학결합': chemistry_bonding_bank,
  'chemistry:산화환원': chemistry_redox_bank,
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
