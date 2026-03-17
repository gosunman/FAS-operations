# 학원 업무 자동화

## 개요

EIDOS SCIENCE (가디언 과학전문학원) 운영 자동화.
주인님이 수업에만 집중할 수 있도록 반복 업무를 AI가 처리.

## 학생 데이터 관리

### 데이터 저장

파일 기반 (JSON). 추후 필요 시 DB 마이그레이션.

```text
data/academy/
├── students/
│   ├── student_001.json
│   ├── student_002.json
│   └── ...
├── tests/
│   ├── weekly/
│   │   └── 2026-03-17_med_physics_ch3.json
│   └── templates/
├── messages/
│   ├── drafts/
│   └── sent/
└── textbook/
    └── common_science/
```

### 학생 스키마

```typescript
interface student {
  id: string                       // student_001
  name: string
  grade: string                    // "중1" | "중2" | "중3" | "고1"
  class_group: 'general' | 'ogeum' | 'med'
  school: string
  enrollment_date: string
  active: boolean

  attendance: attendance_record[]
  weekly_tests: test_result[]
  school_exams: school_exam[]
  daily_notes: dated_note[]
  parent_notes: dated_note[]

  // AI 자동 분석
  analysis?: {
    strengths: string[]            // "전류 개념 이해도 높음"
    weaknesses: string[]           // "화학반응식 균형 맞추기 어려워함"
    trend: 'improving' | 'stable' | 'declining'
    recommendations: string[]      // "이온식 반복 연습 필요"
    last_updated: string
  }
}

interface attendance_record {
  date: string
  status: 'present' | 'absent' | 'late'
  note?: string                    // "감기로 30분 늦음"
}

interface test_result {
  date: string
  test_id: string                  // 시험지 ID 참조
  subject: string
  unit: string
  score: number
  total: number
  weak_points: string[]            // AI가 분석한 취약 문항/개념
}

interface school_exam {
  semester: string                 // "2026-1학기-중간"
  subject: string
  score: number
  grade?: string
  rank?: string
  class_avg?: number
}

interface dated_note {
  date: string
  content: string
}
```

### 학생 데이터 입력 방식

주인님이 수업 후 간단히 입력할 수 있는 인터페이스 필요.

**옵션 A: Telegram Bot 커맨드** (최소 MVP)
```text
/student 김민수 출석
/student 김민수 특이 "오늘 전류 개념 잘 이해함. 화학은 여전히 약함"
/student 김민수 시험 85/100 "이온식 2문항 틀림"
/parent 김민수 "다음 주 시험 범위 변경됨"
```

**옵션 B: 간단한 웹 폼** (Phase 5에서)
- MacBook Pro에서 접근 가능한 간단한 폼
- 학생 선택 → 출석/점수/메모 입력

## 학부모 문자 자동 생성

### 프로세스

```text
1. 주인님이 수업 후 학생별 키워드 입력
   (Telegram: /parent_msg 김민수 "전류 잘함, 화학 복습 필요, 숙제 안 해옴")

2. AI가 키워드 + 학생 데이터 기반 문자 초안 생성
   - 톤: 정중 + 전문가 + 학생 애정
   - 학생의 최근 성적 추이 반영
   - 구체적 칭찬/개선점 포함

3. Slack #academy 채널에 초안 게시
   - 주인님 확인 후 "승인" 또는 수정 요청

4. 승인 시 발송
   - 1순위: 문자 발송 API (구매 시)
   - 2순위: 학원 관리자 페이지 연동
   - 3순위: Google Messages 웹 (수동 복붙 가이드)
```

### 문자 생성 프롬프트

```typescript
function build_parent_message_prompt(
  student: student,
  keywords: string[],
  daily_note?: string,
): string {
  const recent_tests = student.weekly_tests.slice(-3)
  const trend = student.analysis?.trend ?? 'stable'

  return `
학부모 문자 메시지를 작성해주세요.

학생 정보:
- 이름: ${student.name}
- 학년: ${student.grade}
- 반: ${student.class_group}

오늘 수업 키워드: ${keywords.join(', ')}
${daily_note ? `특이사항: ${daily_note}` : ''}

최근 시험 성적:
${recent_tests.map(t => `- ${t.date}: ${t.score}/${t.total} (${t.subject} ${t.unit})`).join('\n')}
성적 추이: ${trend === 'improving' ? '상승' : trend === 'declining' ? '하락' : '유지'}

취약점: ${student.analysis?.weaknesses?.join(', ') ?? '없음'}

작성 규칙:
1. 정중하고 전문가적이면서 학생을 애정하는 톤
2. 구체적 칭찬이나 개선점 포함
3. 다음 수업 준비사항 안내
4. 200자 내외
5. 이모지 사용하지 않기
`
}
```

### 문자 발송 구현

```typescript
// src/academy/parent_message.ts

// 옵션 1: 문자 발송 API (알리고, 네이버 클라우드 SMS 등)
async function send_sms_api(phone: string, message: string): Promise<void> {
  // 알리고 API 예시
  await fetch('https://apis.aligo.in/send/', {
    method: 'POST',
    body: new URLSearchParams({
      key: process.env.SMS_API_KEY!,
      user_id: process.env.SMS_USER_ID!,
      sender: process.env.SMS_SENDER_NUMBER!,
      receiver: phone,
      msg: message,
    }),
  })
}

// 옵션 2: Google Messages 웹 (가이드 제공)
// 자동화 어려움 → Slack에 메시지 + "Google Messages에서 복붙하세요" 안내
```

## 주간 테스트 생성

### 프로세스

```text
1. 주인님 또는 스케줄이 테스트 생성 요청
   - 과목, 단원, 난이도, 문항 수 지정
   - Telegram: /test 공통과학 "3단원 힘과 운동" med 20

2. Claude Code가 시험지 생성
   - 객관식 위주 (5지선다)
   - 난이도 반영: general < ogeum < med
   - 정답지 + 해설 별도 생성

3. PDF 생성 → Slack #academy에 파일 공유

4. 채점 결과는 학생 데이터에 자동 기록
```

### 시험지 생성 프롬프트

```typescript
function build_test_prompt(request: TestRequest): string {
  return `
과학 시험지를 생성해주세요.

과목: ${request.subject}
단원: ${request.units.join(', ')}
난이도: ${request.difficulty === 'med' ? '의대반 (상)' : request.difficulty === 'ogeum' ? '오금고반 (중상)' : '일반반 (중)'}
문항 수: ${request.question_count}
형식: 객관식 5지선다

요구사항:
1. 각 문항에 보기 5개
2. 정답은 고르게 분포 (특정 번호에 치우치지 않게)
3. 함정 보기 포함 (흔한 오개념 활용)
4. 난이도 순서: 쉬운 것 → 어려운 것
5. 마지막 2~3문항은 서술형 가능

출력 형식:
## 시험지
(문제들)

## 정답지
(정답 + 간단 해설)
`
}
```

## 교재 제작 (EIDOS SCIENCE)

### 교재 구조

```text
공통과학 교재/
├── 표지 (검정/골드/화이트, EIDOS SCIENCE 로고)
├── 목차
├── 단원별:
│   ├── 개념 설명 (상세, 모든 자잘한 개념 포함)
│   ├── 핵심 정리 박스
│   ├── 예제 (풀이 과정 포함)
│   ├── 연습 문제 (객관식 + 서술형)
│   └── 정답 및 해설
└── 부록 (주기율표, 공식 정리 등)
```

### 제작 프로세스

```text
1. 단원 목차 확정 (주인님 승인)
2. Claude Code가 단원별 콘텐츠 생성
   - 하이탑 레벨 기준
   - 주인님 교육 철학 반영 (자잘한 개념까지 모두 설명)
3. 주인님 검수 (Notion 페이지로 공유)
4. 수정 반영
5. PDF/LaTeX 포매팅
6. 인쇄
```
