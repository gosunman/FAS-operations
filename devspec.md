# devspec.md — FAS Operations 개발자 & AI 에이전트 기술 명세

## 시스템 아키텍처

```
캡틴 (Mac Studio M4 Ultra)                    헌터 (Mac Studio M1 Ultra)
"주인님의 뇌" — 계정 A                     "주인님의 눈" — 계정 B
┌────────────────────────────┐              ┌────────────────────────┐
│ tmux: fas-gateway          │              │ tmux: fas-openclaw     │
│   └ Express :3100          │◄──HTTP──────►│   └ Task API polling   │
│       ├ Task CRUD API      │  (Tailscale) │                        │
│       ├ Hunter API (sanitized)             │ tmux: fas-claude-hunter│
│       └ Health check       │              │   └ Claude Code x20   │
│                            │              │     (계정 B)           │
│ tmux: fas-claude           │              │                        │
│   └ agent_wrapper.sh claude│              │ tmux: fas-watchdog     │
│     (계정 A)               │              │   └ heartbeat sender   │
│                            │              └────────────────────────┘
│ tmux: fas-gemini-a         │    ┌──────────────────────┐
│   └ Gemini CLI (research)  │    │ External Services    │
│                            │    │  Telegram Bot API    │
│ tmux: fas-gemini-b         │───►│  Slack Web API       │
│   └ Gemini CLI (validator) │    │  Notion API          │
│                            │    └──────────────────────┘
│ tmux: fas-watchdog         │
│   └ output_watcher.ts      │    주인님 ↔ 헌터 직접 소통:
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
| 런타임 | Node.js | 20+ |
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
| `FAS_DEV_MODE` | N | dev 모드 (true일 때 API key 미설정 허용, 기본: false) |
| `FAS_MODE` | N | 시스템 모드 (awake/sleep) |
| `FAS_DEVICE` | N | 디바이스 구분 (captain/hunter) |
| `N8N_USER` | N | n8n 관리자 ID |
| `N8N_PASSWORD` | N | n8n 관리자 비밀번호 |

## 주요 모듈

### Gateway (`src/gateway/`)
- **server.ts**: Express 서버 (포트 3100), Task CRUD + Hunter API + Health check
- **task_store.ts**: SQLite 태스크 저장소 (create/read/update/complete/block)
- **sanitizer.ts**: 개인정보 제거 (10개 패턴: 한국 이름, 전화번호, 이메일, 주민번호, 주소, 계좌, 금융정보, 신용카드, 내부 IP, 내부 URL). 화이트리스트 방식으로 헌터에 안전한 필드만 전달. 역방향 PII 검사 지원.
- **rate_limiter.ts**: 슬라이딩 윈도우 Rate Limiter (헌터 API 요청 속도 제한)

### Notification (`src/notification/`)
- **telegram.ts**: Telegram Bot 클라이언트 (메시지 전송, 승인 인라인 키보드)
- **slack.ts**: Slack 클라이언트 (채널 라우팅: agent_log → #captain-logs, alert → #alerts 등)
- **router.ts**: 통합 라우터 (이벤트 타입별 Telegram/Slack/Notion 라우팅 매트릭스)

### Hunter (`src/hunter/`)
- **browser.ts**: Playwright 브라우저 매니저 (Chromium, lazy initialization, 30s timeout)
- **api_client.ts**: Captain Task API HTTP 클라이언트 (fetch, heartbeat, result submit). API Key 인증 헤더 자동 포함.
- **task_executor.ts**: 태스크 액션 라우팅 + Playwright 기반 실행기. `web_crawl`/`browser_task` 구현 완료, `deep_research`/`notebooklm_verify`는 OpenClaw 통합 대기 중 (failure 반환).
- **poll_loop.ts**: 메인 폴링 루프 (10초 주기, 지수 백오프, 최대 5분)
- **config.ts**: 환경변수 기반 설정 로더 (`CAPTAIN_API_URL`, `HUNTER_POLL_INTERVAL`)
- **logger.ts**: 파일+콘솔 듀얼 로거 (`logs/hunter_{date}.log`)
- **main.ts**: 진입점 (`pnpm run hunter`), 브라우저 graceful shutdown 포함

### Captain (`src/captain/`)
- **planning_loop.ts**: 모닝/나이트 자율 스케줄링 (`config/schedules.yml` → due 태스크 산출 → TaskStore 주입 → 브리핑 알림). daily/every_3_days/weekly 스케줄 타입 지원, 중복 방지. **동적 기회 발견**: 최근 3일 크롤링/리서치 완료 태스크를 Gemini CLI로 분석하여 최대 3개의 추가 행동 아이템을 자동 생성 (야간 SLEEP 모드). Fire-and-forget 방식으로 실패 시 나이트 플래닝을 차단하지 않음.
- **feedback_extractor.ts**: 완료 태스크에서 교훈 추출 (Gemini CLI fire-and-forget → Doctrine feedback 파일에 append)

### Cross-Approval (`src/gateway/cross_approval.ts`)
- Gemini CLI 교차 승인 모듈. MID 리스크 액션에 대해 Gemini CLI spawn → JSON 파싱 → 승인/거부 결정.
- 10분 타임아웃, JSON 파싱 실패 시 자동 거부 (secure by default).

### Watchdog (`src/watchdog/`)
- **output_watcher.ts**: tmux 세션 출력 감시 (2초 주기 폴링, 패턴 매칭 → 알림)

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
pnpm run gateway   # Gateway + Task API
pnpm run watcher   # Output Watcher
pnpm run hunter    # Hunter Agent (on hunter machine)

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
| `scripts/test_notifications.ts` | Telegram/Slack 실제 메시지 전송 테스트 |

## 배포 유의 사항

- Gateway는 Tailscale 내부에서만 접근 가능 (공인 IP 노출 금지)
- 헌터에는 개인정보가 포함된 태스크를 절대 전달하지 않음 (`sanitizer.ts`)
- n8n은 Colima(Docker)에서 실행, 볼륨은 로컬 디스크
- launchd plist로 부팅 시 자동 시작 (`com.fas.captain.plist`)
- 에이전트 크래시 시 `agent_wrapper.sh`가 지수 백오프로 최대 3회 재시작
