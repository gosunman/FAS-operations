# Captain Module (`src/captain/`)

캡틴의 자율 활동 엔진 — 스케줄 기반 태스크 생성, 교훈 추출, 자율 판단 지원.

## 모듈 구성

| 파일 | 역할 |
|------|------|
| `main.ts` | 통합 진입점 — Gateway, Watcher, Planning Loop, Hunter Monitor, Telegram Commands 등 전체 기동. 감시 대상 tmux 세션은 실제 존재하는 것만 등록 (현재: `fas-claude`) |
| `planning_loop.ts` | 모닝/나이트 자율 스케줄링 (schedules.yml 기반 태스크 생성) |
| `feedback_extractor.ts` | 완료된 태스크에서 교훈 추출 (Gemini CLI → Doctrine feedback 파일에 append) |
| `persona_injector.ts` | PII-free 사용자 컨텍스트 주입 — Doctrine memory 파일에서 안전한 프로필 정보(직업, 학력, 기술 스택 등)를 추출하여 헌터 태스크 description에 prepend. 24h TTL 캐시, PII 정규식 필터링 |
| `telegram_commands.ts` | Telegram 인바운드 명령 수신 — long polling(`getUpdates`)으로 `/hunter`, `/captain`, `/crawl`, `/research`, `/status`, `/tasks`, `/cancel` 명령 처리. 일반 텍스트는 기본 hunter chatgpt_task로 생성 |

## planning_loop.ts

`config/schedules.yml`을 읽어 오늘 due인 태스크를 TaskStore에 자동 주입. 또한 Gemini CLI를 활용한 동적 태스크 발견(discover_opportunities) 기능 제공.

**스케줄 타입:**
- `daily` — 매일 실행
- `every_3_days` — epoch(2026-01-01)부터 3일 주기
- `weekly` — 특정 요일에만 실행

**중복 방지:**
- 같은 title의 태스크가 이미 pending/in_progress이면 스킵
- 20시간 이내 완료된 동일 title 태스크가 있으면 스킵

**동적 태스크 발견 (discover_opportunities):**
- 최근 3일간 완료된 크롤링/리서치 태스크의 결과를 Gemini CLI로 분석
- 크롤링 관련 키워드: `crawl`, `크롤링`, `scrape`, `research`
- Gemini가 최대 3개의 추가 조사/행동 아이템을 제안
- 허용 에이전트: `gemini_a`, `openclaw`, `claude`
- 기존 pending/in_progress 태스크와 중복 방지
- Fire-and-forget: Gemini 실패 시 경고 로그만 남기고 계속 (나이트 플래닝 차단하지 않음)
- SLEEP 모드(야간)에 `run_night()` 내에서 자동 실행

**사용법:**
```typescript
import { create_planning_loop } from './planning_loop.js';

// 기본 (정적 스케줄링만)
const loop = create_planning_loop({ store, router, schedules_path: 'config/schedules.yml' });
await loop.run_morning();  // 모닝 브리핑 + 태스크 주입
await loop.run_night();    // 나이트 서머리

// 동적 발견 포함
const loop_with_discovery = create_planning_loop({
  store, router,
  schedules_path: 'config/schedules.yml',
  gemini_config: { account: 'a' },
});
await loop_with_discovery.run_night();     // 나이트 서머리 + 기회 발견
await loop_with_discovery.run_discover();  // 수동 발견 실행
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
