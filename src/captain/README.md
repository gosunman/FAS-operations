# Captain Module (`src/captain/`)

캡틴의 자율 활동 엔진 — 스케줄 기반 태스크 생성, 교훈 추출, 자율 판단 지원.

## 모듈 구성

| 파일 | 역할 |
|------|------|
| `planning_loop.ts` | 모닝/나이트 자율 스케줄링 (schedules.yml 기반 태스크 생성) |
| `feedback_extractor.ts` | 완료된 태스크에서 교훈 추출 (Gemini CLI → Doctrine feedback 파일에 append) |

## planning_loop.ts

`config/schedules.yml`을 읽어 오늘 due인 태스크를 TaskStore에 자동 주입.

**스케줄 타입:**
- `daily` — 매일 실행
- `every_3_days` — epoch(2026-01-01)부터 3일 주기
- `weekly` — 특정 요일에만 실행

**중복 방지:**
- 같은 title의 태스크가 이미 pending/in_progress이면 스킵
- 20시간 이내 완료된 동일 title 태스크가 있으면 스킵

**사용법:**
```typescript
import { create_planning_loop } from './planning_loop.js';

const loop = create_planning_loop({ store, router, schedules_path: 'config/schedules.yml' });
await loop.run_morning();  // 모닝 브리핑 + 태스크 주입
await loop.run_night();    // 나이트 서머리
```

## feedback_extractor.ts

태스크 완료 시 Gemini CLI로 교훈을 1문장 추출하여 Doctrine 피드백 파일에 기록.

**특징:**
- Fire-and-forget: 실패해도 경고 로그만 남기고 계속
- 500자 초과 응답은 무시 (과도한 출력 방지)

**사용법:**
```typescript
import { create_feedback_extractor } from './feedback_extractor.js';

const extractor = create_feedback_extractor({ feedback_path: '/path/to/feedback_dev_lessons.md' });
await extractor.extract('K-Startup 크롤링', 'Found 5 programs');
```
