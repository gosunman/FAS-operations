# devspec.md — FAS 개발자 & AI 에이전트 기술 명세

## 시스템 아키텍처

```
캡틴 (Mac Studio M4 Ultra)                    헌터 (Mac Studio M1 Ultra)
┌────────────────────────────┐              ┌────────────────────────┐
│ tmux: fas-gateway          │              │ tmux: fas-openclaw     │
│   └ Express :3100          │◄──HTTP──────►│   └ Task API polling   │
│       ├ Task CRUD API      │  (Tailscale) │                        │
│       ├ Hunter API (sanitized)             │ tmux: fas-watchdog     │
│       └ Health check       │              │   └ heartbeat sender   │
│                            │              └────────────────────────┘
│ tmux: fas-claude           │
│   └ agent_wrapper.sh claude│
│                            │
│ tmux: fas-gemini-a         │    ┌──────────────────────┐
│   └ Gemini CLI (research)  │    │ External Services    │
│                            │    │  Telegram Bot API    │
│ tmux: fas-gemini-b         │───►│  Slack Web API       │
│   └ Gemini CLI (validator) │    │  Notion API          │
│                            │    └──────────────────────┘
│ tmux: fas-watchdog         │
│   └ output_watcher.ts      │
│                            │
│ tmux: fas-n8n              │
│   └ docker compose (n8n)   │
└────────────────────────────┘
```

## 기술 스택

| 카테고리 | 기술 | 버전 |
|---------|------|------|
| 언어 | TypeScript (ESM) | 5.9+ |
| 런타임 | Node.js | 20+ |
| 패키지 매니저 | pnpm | 10+ |
| 웹 프레임워크 | Express | 5.x |
| DB | better-sqlite3 (WAL mode) | 12+ |
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
| `FAS_MODE` | N | 시스템 모드 (awake/sleep) |
| `FAS_DEVICE` | N | 디바이스 구분 (captain/hunter) |
| `N8N_USER` | N | n8n 관리자 ID |
| `N8N_PASSWORD` | N | n8n 관리자 비밀번호 |

## 주요 모듈

### Gateway (`src/gateway/`)
- **server.ts**: Express 서버 (포트 3100), Task CRUD + Hunter API + Health check
- **task_store.ts**: SQLite 태스크 저장소 (create/read/update/complete/block)
- **sanitizer.ts**: 개인정보 제거 (한국 이름, 전화번호, 이메일, 주민번호, 주소, 계좌, 금융정보)

### Notification (`src/notification/`)
- **telegram.ts**: Telegram Bot 클라이언트 (메시지 전송, 승인 인라인 키보드)
- **slack.ts**: Slack 클라이언트 (채널 라우팅: agent_log → #captain-logs, alert → #alerts 등)
- **router.ts**: 통합 라우터 (이벤트 타입별 Telegram/Slack/Notion 라우팅 매트릭스)

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
| GET | `/api/hunter/tasks/pending` | 헌터 전용 (PII 제거됨) |
| POST | `/api/hunter/tasks/:id/result` | 헌터 결과 제출 |
| POST | `/api/hunter/heartbeat` | 헌터 생존 신호 |
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
