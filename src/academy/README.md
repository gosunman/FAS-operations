# Academy Automation Module

EIDOS SCIENCE 학원 업무 자동화 모듈.

## Modules

### parent_message.ts — 학부모 메시지 자동 생성

수업 후 선생님이 키워드를 입력하면, 학부모에게 보낼 SMS 문자를 자동 생성합니다.

**흐름:**
1. 학생 정보 (`StudentContext`) + 수업 키워드 (`ClassKeywords`) 입력
2. 템플릿 기반으로 구조화된 메시지 생성 (외부 AI API 호출 없음)
3. 톤 규칙 적용 (존댓말, 긍정 프레이밍 등)
4. 검증 (글자수 200-500, 필수 섹션, 부적절 표현 필터)

**주요 함수:**

| 함수 | 설명 |
|------|------|
| `generate_parent_message()` | 학생 컨텍스트 + 키워드로 메시지 생성 |
| `apply_tone_rules()` | 톤 변환 규칙 적용 (formal/caring 등) |
| `validate_message()` | 메시지 유효성 검증 |

**타입:**

| 타입 | 설명 |
|------|------|
| `StudentContext` | 학생 이름, 학년, 반 유형, 과목, 성적, 출결, 이전 메모 |
| `ClassKeywords` | 수업 날짜, 다룬 주제, 수행 키워드, 숙제, 다음 수업 안내 |
| `ToneConfig` | 격식(formal/semi_formal), 따뜻함(professional/caring/enthusiastic) |
| `ParentMessage` | greeting + body + closing + full_text + char_count |

**반 유형:**
- `regular` — 일반반
- `ogeum` — 오금고반
- `medical` — 의대반

**사용 예시:**
```typescript
import { generate_parent_message } from './parent_message.js';

const message = generate_parent_message(
  {
    name: '김민수',
    grade: '고1',
    class_type: 'regular',
    subjects: ['수학', '물리'],
  },
  {
    date: '2026-03-21',
    topics_covered: ['이차함수의 그래프', '판별식'],
    performance_keywords: ['집중력 좋음', '질문 많이 함'],
    homework: '교재 p.52~54 풀어오기',
  }
);

console.log(message.full_text);
// 안녕하세요, 김민수 학부모님.
//
// 3월 21일 수업에서 이차함수의 그래프과(와) 판별식을(를) 학습하였습니다. ...
//
// 김민수 학생이 꾸준히 성장할 수 있도록 함께 지도하겠습니다. 감사합니다.
```
