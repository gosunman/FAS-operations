# Captain Module (`src/captain/`)

캡틴의 자율 활동 엔진 — 스케줄 기반 태스크 생성, 교훈 추출, 자율 판단 지원.

## 모듈 구성

| 파일 | 역할 |
|------|------|
| `main.ts` | 통합 진입점 — Gateway, Watcher, Planning Loop, Hunter Monitor, Telegram Commands, Stale Task Cleanup 등 전체 기동. Gemini discovery 활성화(gemini_config 전달). 감시 대상 tmux 세션은 실제 존재하는 것만 등록 (현재: `fas-claude`) |
| `planning_loop.ts` | 모닝/나이트 자율 스케줄링 (schedules.yml 기반 태스크 생성) |
| `feedback_extractor.ts` | 완료된 태스크에서 교훈 추출 (Gemini CLI → Doctrine feedback 파일에 append) |
| `persona_injector.ts` | PII-free 사용자 컨텍스트 주입 — Doctrine memory 파일에서 안전한 프로필 정보(직업, 학력, 기술 스택 등)를 추출하여 헌터 태스크 description에 prepend. 24h TTL 캐시, PII 정규식 필터링 |
| `task_executor.ts` | 태스크 실행 전 교차 승인 게이트 — pending 태스크를 폴링하며 risk_level 기반으로 LOW=자동 승인, MID=Gemini 교차 승인, HIGH/CRITICAL=스킵(인간 승인 대기) |
| `telegram_commands.ts` | Telegram 인바운드 명령 수신 — long polling(`getUpdates`)으로 `/hunter`, `/captain`, `/crawl`, `/research`, `/status`, `/tasks`, `/cancel` 명령 처리. 일반 텍스트는 기본 captain으로 생성 (PII 보호) |
| `morning_briefing.ts` | 모닝 브리핑 생성 — 야간 완료 태스크 요약, 오늘 예정 스케줄, 대기/차단 태스크 현황을 수집하여 Telegram+Slack 전송 + Notion 상세 백업 |

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

// 동적 발견 포함 (main.ts에서 기본 활성화)
const loop_with_discovery = create_planning_loop({
  store, router,
  schedules_path: 'config/schedules.yml',
  gemini_config: { account: 'a', gemini_command: 'gemini' },
  persona_injector,
});
await loop_with_discovery.run_night();     // 나이트 서머리 + 기회 발견
await loop_with_discovery.run_discover();  // 수동 발견 실행
```

## Stale Task Cleanup

`main.ts`에서 5분 간격으로 in_progress 태스크를 스캔하여, 30분 이상 결과 미수신 시 자동 blocked 처리.

- `task_store.get_stale_in_progress(timeout_ms)` — 타임아웃 초과 태스크 조회
- blocked 전환 시 `[STALE]` alert를 Slack으로 전송
- 헌터 크래시, Gemini 에이전트 미실행 등으로 인한 영구 in_progress 방지

## morning_briefing.ts

매일 07:30에 실행되는 모닝 브리핑. `config/schedules.yml`의 `morning_briefing` 워크플로우(WF-4)에 대응.

**수집 항목:**
- 야간(전일 22:00 ~ 당일 07:00 UTC) 완료된 태스크 요약
- 오늘 예정된 스케줄 태스크 목록 (`schedules.yml` 기반)
- 대기(pending) / 진행 중(in_progress) / 차단(blocked) 태스크 현황

**전송 채널:**
- **Telegram + Slack**: `NotificationRouter`를 통해 간결한 요약 전송 (routing matrix의 `briefing` 타입)
- **Notion**: `create_daily_briefing()` API로 상세 브리핑 페이지 생성 (섹션별 구조화)

**에러 처리:**
- Fire-and-forget: 개별 채널 실패가 다른 채널이나 전체 시스템을 차단하지 않음
- Router 실패 → Notion은 계속 시도 / Notion 실패 → Router 결과로 성공 판정

**사용법:**
```typescript
import { create_morning_briefing } from './morning_briefing.js';

const briefing = create_morning_briefing({ store, router, notion, schedules_path });
const result = await briefing.run();
// result.success, result.data, result.channels.telegram_slack, result.channels.notion
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
