# devspec.md — FAS Operations 개발자 & AI 에이전트 기술 명세

## 시스템 아키텍처

```
캡틴 (Mac Studio M4 Ultra)                    헌터 (Mac Studio M1 Ultra)
"주인님의 뇌" — 계정 A                     "주인님의 눈" — 계정 B
┌────────────────────────────┐              ┌────────────────────────┐
│ tmux: fas-captain          │              │ hunter_watchdog.sh     │
│   └ pnpm captain (통합)    │◄──HTTP──────►│   └ pnpm start         │
│       ├ Gateway :3100      │  (Tailscale) │     └ Task API polling │
│       ├ Output Watcher     │              │     └ Playwright       │
│       ├ Planning Loop      │              │     └ heartbeat sender │
│       ├ Hunter Monitor     │              └────────────────────────┘
│       ├ Activity Logger    │
│       ├ Resource Monitor   │    ┌──────────────────────┐
│       └ Daily Scheduler    │───►│ External Services    │
│ tmux: fas-claude           │    │  Telegram Bot API    │
│   └ Claude Code (계정 A)   │    │  Slack Web API       │
│ tmux: fas-gemini-a         │    │  Notion API          │
│   └ Gemini CLI (계정 A)    │    └──────────────────────┘    주인님 ↔ 헌터 직접 소통:
│                            │    Telegram/Slack (막연한 업무,
│ tmux: fas-n8n              │     크리티컬 이슈 보고)
│   └ docker compose (n8n)   │
└────────────────────────────┘
에이전트 체계 원천 문서: docs/agents-charter.md
```

## 기술 스택

| 카테고리 | 기술 | 버전 |
|---------|------|------|
| 언어 | TypeScript (ESM) | 5.9+ |
| 런타임 | Node.js | 22+ (헌터: OpenClaw 요구사항으로 22 필수) |
| 패키지 매니저 | pnpm | 10+ |
| 웹 프레임워크 | Express | 5.x |
| DB | better-sqlite3 (WAL mode) | 12+ |
| 브라우저 자동화 | Playwright (Chromium) | 1.x |
| 테스트 | vitest + supertest | 4.x |
| 컨테이너 | Colima + Docker | - |
| 오케스트레이션 | n8n (Docker) | latest |
| 프로세스 관리 | tmux + launchd | - |

## 환경 변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `TELEGRAM_BOT_TOKEN` | Y | Telegram Bot API 토큰 |
| `TELEGRAM_CHAT_ID` | Y | 알림 수신 채팅 ID |
| `SLACK_BOT_TOKEN` | Y | Slack Bot OAuth 토큰 |
| `SLACK_SIGNING_SECRET` | N | Slack 이벤트 검증 |
| `NOTION_API_KEY` | N | Notion API 통합 키 |
| `GATEWAY_PORT` | N | Gateway 포트 (기본: 3100) |
| `GATEWAY_HOST` | N | Gateway 호스트 (기본: 0.0.0.0) |
| `HUNTER_API_KEY` | Y | 헌터 API 인증 키 — 캡틴/헌터 공유 시크릿 (Defense in Depth) |
| `CAPTAIN_API_URL` | N* | Captain API URL — 헌터 전용 |
| `HUNTER_POLL_INTERVAL` | N | 폴링 주기 ms — 헌터 전용 (기본: 10000) |
| `HUNTER_LOG_DIR` | N | 헌터 로그 디렉토리 (기본: ./logs) |
| `GOOGLE_PROFILE_DIR` | N | 구글 Chrome 프로필 디렉토리 — 헌터 전용 (기본: ./fas-google-profile-hunter) |
| `DEEP_RESEARCH_TIMEOUT_MS` | N | Deep Research 타임아웃 ms — 헌터 전용 (기본: 300000) |
| `NOTEBOOKLM_TIMEOUT_MS` | N | NotebookLM 타임아웃 ms — 헌터 전용 (기본: 180000) |
| `HUNTER_TELEGRAM_BOT_TOKEN` | N* | 헌터 전용 Telegram Bot 토큰 (`hunter_6239_bot`) — 헌터 .env |
| `HUNTER_TELEGRAM_CHAT_ID` | N* | 주인님 Telegram Chat ID — 헌터 .env |
| `HUNTER_SLACK_WEBHOOK_URL` | N* | 헌터 전용 Slack Incoming Webhook URL — 헌터 .env |
| `NOTION_TASK_RESULTS_DB` | N | Notion 태스크 결과 백업 DB ID (설정 시 태스크 완료마다 Notion에 fire-and-forget 백업) |
| `DOCTRINE_MEMORY_DIR` | N | Doctrine 메모리 디렉토리 경로 — Persona Injector가 사용자 컨텍스트를 읽는 위치 |
| `DOCTRINE_FEEDBACK_PATH` | N | Doctrine 피드백 파일 경로 — Feedback Extractor가 교훈을 기록하는 위치 |
| `FAS_DEV_MODE` | N | dev 모드 (true일 때 API key 미설정 허용, 기본: false). NODE_ENV=production 시 강제 차단 |
| `FAS_MODE` | N | 시스템 모드 (awake/sleep) |
| `FAS_DEVICE` | N | 디바이스 구분 (captain/hunter) |
| `N8N_USER` | N | n8n 관리자 ID |
| `N8N_PASSWORD` | N | n8n 관리자 비밀번호 |

## 주요 모듈

### Gateway (`src/gateway/`)
- **server.ts**: Express 서버 (포트 3100), Task CRUD + Hunter API + Health check. 헌터 pending 태스크 필터는 `assigned_to: 'hunter'`로 조회 (기존 `'openclaw'`에서 변경). **자동 알림**: 헌터 태스크 완료 시 `notification_router`를 통해 `crawl_result` 이벤트를 자동 발송 (Notion 원문 + Slack 요약 링크). OpenClaw JSON 응답의 `payloads[].text`를 자동 추출. **PII 2단계 처리**: critical PII → quarantine, warning PII → auto-sanitize 후 정상 통과.
- **task_store.ts**: SQLite 태스크 저장소 (create/read/update/complete/block). `action` 필드 지원 — `config/schedules.yml`의 `action` 값이 태스크 생성 시 저장되어 헌터 API를 통해 `resolve_action()`에서 사용됨. `get_stale_in_progress(timeout_ms)` — 30분+ 체류 in_progress 태스크 감지.
- **sanitizer.ts**: 개인정보 제거 (10개 패턴: 한국 이름, 전화번호, 이메일, 주민번호, 주소, 계좌, 금융정보, 신용카드, 내부 IP, 내부 URL). 화이트리스트 방식으로 헌터에 안전한 필드만 전달. 역방향 PII 검사 지원. **2단계 severity**: `critical`(주민번호, 전화, 이름, 카드) → quarantine, `warning`(주소, 계좌, 이메일 등) → auto-sanitize. `bank_account` 패턴 마지막 그룹 4자리+ (날짜 오탐 방지), `address` 패턴 동/로/길 필수 (일반 지역명 오탐 방지).
- **rate_limiter.ts**: 슬라이딩 윈도우 Rate Limiter (헌터 API 요청 속도 제한)

### Notification (`src/notification/`)
- **telegram.ts**: Telegram Bot 클라이언트 (메시지 전송, 승인 인라인 키보드)
- **slack.ts**: Slack 클라이언트 (채널 라우팅: agent_log → #captain-logs, crawl_result → #fas-general, alert → #alerts 등)
- **router.ts**: 통합 라우터 (이벤트 타입별 Telegram/Slack/Notion 라우팅 매트릭스). **Telegram: approval_high + discovery only** — 워치 알림 최소화 정책. `crawl_result` 이벤트는 **Notion에 먼저 전송** → 페이지 URL을 받아 → **Slack에 200자 요약 + Notion 원문 링크**로 전달. `briefing`도 Notion에 전송. **폴백 정책**: Telegram 실패 → Slack 폴백, Slack 실패(dual-route) → Telegram 폴백. Slack-only 이벤트(`milestone`, `done`, `error` 등) 실패 시에는 로그만 남기고 Telegram 폴백하지 않음 (비크리티컬 이벤트의 Telegram 폭주 방지).
- **notion.ts**: Notion 클라이언트. **Name (title) 속성만 사용** — Type, Timestamp, Device 등의 커스텀 속성에 의존하지 않아 모든 Notion DB에서 동작. 메시지는 2000자 단위로 분할하여 블록 생성. `send_with_result()`는 페이지 URL을 반환하여 Slack 등 다른 채널에서 링크 가능.

### Hunter (`src/hunter/`)
- **browser.ts**: Playwright 브라우저 매니저 (Chromium, lazy initialization, 30s timeout). `get_page()` — 일반 페이지 (headless), `get_persistent_page(profile_dir)` — 구글 프로필 기반 세션 재사용 (headed, 로그인 유지).
- **api_client.ts**: Captain Task API HTTP 클라이언트 (fetch, heartbeat, result submit). API Key 인증 헤더 자동 포함.
- **task_executor.ts**: 태스크 액션 라우팅 + 실행기. 5개 핸들러 구현 완료: `web_crawl`(URL 크롤링), `browser_task`(스크린샷+텍스트), `deep_research`(Gemini Deep Research 웹 UI 자동화), `notebooklm_verify`(NotebookLM 웹 UI 자동화), `chatgpt_task`(OpenClaw CLI를 통한 추상적 태스크/분석/리서치). 구글 로그인 감지 → `[LOGIN_REQUIRED]` 반환. `resolve_action()`은 Task의 `action` 필드를 우선 사용하고, 없으면 URL 유무로 자동 결정 (URL 없음 → `chatgpt_task`).
- `chatgpt_task` 핸들러는 **OpenClaw** CLI(`openclaw agent --agent main -m "prompt" --json`)를 호출. OpenClaw은 독립 AI 에이전트 프레임워크로, ChatGPT Pro(계정 B) OAuth를 LLM 백엔드로 사용. `OPENCLAW_AGENT` 환경변수로 에이전트 선택 가능 (기본: `main`). 상세: [docs/openclaw.md](docs/openclaw.md)
- **poll_loop.ts**: 메인 폴링 루프 (10초 주기, 지수 백오프, 최대 5분)
- **config.ts**: 환경변수 기반 설정 로더 (`CAPTAIN_API_URL`, `HUNTER_POLL_INTERVAL`, `GOOGLE_PROFILE_DIR`, `DEEP_RESEARCH_TIMEOUT_MS`, `NOTEBOOKLM_TIMEOUT_MS`)
- **notify.ts**: 헌터 전용 Telegram + Slack 알림 (캡틴 봇과 격리된 별도 토큰). `alert()` → 양쪽, `report()` → Slack만. Fire-and-forget.
- **logger.ts**: 파일+콘솔 듀얼 로거 (`logs/hunter_{date}.log`)
- **main.ts**: 진입점 (`pnpm run hunter`), 브라우저 graceful shutdown 포함

### Captain (`src/captain/`)
- **main.ts**: 통합 캡틴 진입점. Gateway API, Output Watcher, Planning Loop, Telegram Commands, Stale Task Cleanup를 한 프로세스에서 기동. 그레이스풀 셧다운 지원. `pnpm captain`으로 실행. Output Watcher 감시 대상은 실제 존재하는 tmux 세션만 지정 (현재: `fas-claude`). 존재하지 않는 세션 감시 시 crash 알림 폭주 위험. 나이트 플래닝 훅에서 Feedback Extractor를 호출하여 완료 태스크의 교훈을 자동 추출. **Gemini discovery 활성화**: `gemini_config` 전달로 나이트 플래닝에서 동적 태스크 발견 기능 가동. **Stale cleanup**: 5분 간격으로 in_progress 30분+ 태스크를 blocked 전환 + alert 알림.
- **planning_loop.ts**: 모닝/나이트 자율 스케줄링 (`config/schedules.yml` → due 태스크 산출 → TaskStore 주입 → 브리핑 알림). daily/every_3_days/weekly 스케줄 타입 지원, 중복 방지. **동적 기회 발견**: 최근 3일 크롤링/리서치 완료 태스크를 Gemini CLI로 분석하여 최대 3개의 추가 행동 아이템을 자동 생성 (야간 SLEEP 모드). Fire-and-forget 방식으로 실패 시 나이트 플래닝을 차단하지 않음.
- **feedback_extractor.ts**: 완료 태스크에서 교훈 추출 (Gemini CLI fire-and-forget → Doctrine feedback 파일에 append). `main.ts`의 나이트 플래닝 훅에서 자동 호출되어 당일 완료 태스크의 교훈을 `DOCTRINE_FEEDBACK_PATH`에 기록.
- **persona_injector.ts**: 동적 페르소나 주입기. Doctrine 메모리 디렉토리(`DOCTRINE_MEMORY_DIR`)에서 사용자 컨텍스트를 읽어 PII를 제거한 배경 정보를 헌터 태스크 description에 주입. 헌터가 맥락 없이 작업하는 것을 방지.
- **telegram_commands.ts**: Telegram 인바운드 명령 핸들러. 주인님이 Telegram에서 `/hunter`, `/crawl`, `/research`, `/status`, `/tasks`, `/cancel` 명령을 보내면 캡틴이 해당 액션을 즉시 수행 (태스크 생성, 상태 조회 등). **일반 텍스트는 기본 `captain` 태스크로 생성** — PII가 포함될 수 있는 일반 텍스트가 헌터로 직행하는 취약점을 방지하기 위해 캡틴이 먼저 수신하고 판단 후 PII 마스킹하여 헌터에 하위 태스크로 하달.

### Cross-Approval (`src/gateway/cross_approval.ts`)
- Gemini CLI 교차 승인 모듈. MID 리스크 액션에 대해 Gemini CLI spawn → JSON 파싱 → 승인/거부 결정.
- 10분 타임아웃, JSON 파싱 실패 시 자동 거부 (secure by default).

### Watchdog (`src/watchdog/`)
- **output_watcher.ts**: tmux 세션 출력 감시 (2초 주기 폴링, 패턴 매칭 → 알림). 감지 패턴: `[APPROVAL_NEEDED]`, `[BLOCKED]`, `[MILESTONE]`, `[DONE]`, `[ERROR]`, `[LOGIN_REQUIRED]`, `[GEMINI_BLOCKED]`. NotificationRouter 연동 완료 — 패턴 감지 시 자동으로 Telegram/Slack 라우팅. `create_routed_watcher()`, `create_watcher_router()` 팩토리 함수 export. **Crash rate limiting**: tmux 세션 unreachable 시 최초 threshold(3회) 도달 시 1회 알림, 이후 ~5분 간격으로만 재알림 (Telegram 폭주 방지).
- **hunter_monitor.ts**: 헌터 heartbeat 모니터. Gateway `/api/agents/health` 주기적 폴링으로 헌터 생존 감시. 2분 경과 → Slack WARNING, 5분 경과 → Telegram ALERT, 복구 시 → RECOVERY 알림. State transition 기반 — 동일 상태 유지 시 재알림하지 않음. `start_hunter_monitor(config)`, `stop_hunter_monitor()` export.

### Mode Switching (`scripts/`)
- **mode_switch.sh**: SLEEP/AWAKE 모드 전환 스크립트. Gateway API 호출 + 로그 기록. `pnpm mode:sleep`, `pnpm mode:awake`로 실행.
- **com.fas.sleep.plist**: 23:00 자동 SLEEP 전환 (launchd)
- **com.fas.awake.plist**: 07:30 자동 AWAKE 전환 (launchd)

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/tasks` | 태스크 생성 |
| GET | `/api/tasks` | 태스크 목록 (?status=pending) |
| GET | `/api/tasks/:id` | 태스크 상세 |
| PATCH | `/api/tasks/:id/status` | 상태 변경 |
| POST | `/api/tasks/:id/complete` | 완료 처리 |
| POST | `/api/tasks/:id/block` | 차단 처리 |
| GET | `/api/hunter/tasks/pending` | 헌터 전용 (PII 제거됨, 인증+속도제한) |
| POST | `/api/hunter/tasks/:id/result` | 헌터 결과 제출 (스키마 검증+PII 격리) |
| POST | `/api/hunter/heartbeat` | 헌터 생존 신호 (인증+속도제한) |
| GET | `/api/health` | 시스템 상태 |
| GET | `/api/stats` | 태스크 통계 |

## 개발 환경 셋업

```bash
# 의존성 설치
pnpm install

# 환경 변수 설정
cp .env.example .env   # 이후 토큰 값 입력

# AI CLI 설치 & 인증 확인
./scripts/setup/setup_ai_cli.sh

# 알림 연동 테스트 (Telegram + Slack)
npx tsx scripts/test_notifications.ts

# 테스트 실행
pnpm test:run      # 단발 실행
pnpm test          # watch 모드

# 서버 실행
pnpm run captain   # Unified captain (Gateway + Watcher + Planning)
pnpm run gateway   # Gateway + Task API (standalone)
pnpm run watcher   # Output Watcher (standalone)
pnpm run hunter    # Hunter Agent (on hunter machine)

# Mode switching
pnpm run mode:sleep   # Switch to SLEEP mode
pnpm run mode:awake   # Switch to AWAKE mode

# tmux 환경
./scripts/setup/setup_tmux.sh      # tmux-resurrect 설치
./scripts/start_captain_sessions.sh # 모든 세션 시작
./scripts/status.sh                # 시스템 상태 확인
./scripts/stop_all.sh              # 모든 세션 중지
```

## 셋업 스크립트

| 스크립트 | 설명 |
|---------|------|
| `scripts/setup/setup_ai_cli.sh` | AI CLI 설치/인증 상태 확인 (Claude Code, Gemini CLI `@google/gemini-cli`, OpenClaw) |
| `scripts/setup/setup_tmux.sh` | tmux + resurrect 설치 |
| `scripts/setup/com.fas.captain.plist` | 캡틴 launchd plist (로그인 시 tmux 자동 시작) |
| `scripts/setup/com.fas.hunter.plist` | 헌터 launchd plist (로그인 시 hunter_watchdog 자동 시작, KeepAlive) |
| `scripts/deploy/deploy_hunter.sh` | 헌터 배포 (소스코드 격리, PII 검사) |
| `scripts/deploy/verify_hunter.sh` | 헌터 배포 후 검증 (연결, heartbeat, 태스크 흐름, PII, 런타임) |
| `scripts/hunter_watchdog.sh` | 헌터 프로세스 감시 (자동 재시작, 지수 백오프, 최대 3회) |
| `scripts/resolve_hunter_login.sh` | VNC 자동 복구 — `[LOGIN_REQUIRED]` 감지 시 헌터 머신의 Screen Sharing을 자동으로 열어 수동 로그인 지원 |
| `scripts/test_notifications.ts` | Telegram/Slack 실제 메시지 전송 테스트 |

## 배포 유의 사항

- Gateway는 Tailscale 내부에서만 접근 가능 (공인 IP 노출 금지)
- 헌터에는 개인정보가 포함된 태스크를 절대 전달하지 않음 (`sanitizer.ts`)
- n8n은 Colima(Docker)에서 실행, 볼륨은 로컬 디스크
- launchd plist로 부팅 시 자동 시작 (`com.fas.captain.plist`)
- 에이전트 크래시 시 `agent_wrapper.sh`가 지수 백오프로 최대 3회 재시작
