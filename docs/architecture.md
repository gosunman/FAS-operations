# 시스템 아키텍처

## 전체 구조도

```text
                         ┌──────────────────┐
                         │   Human (owner)  │
                         │  Galaxy Watch    │
                         │  Galaxy Fold     │
                         │  MacBook Pro     │
                         └────────┬─────────┘
                                  │
                    ┌─────────────┼──────────────┐
                    │ Telegram    │ Slack         │ Notion
                    │ (긴급알림)  │ (업무소통)    │ (보고서)
                    └─────────────┼──────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
    ┌─────────▼────────┐ ┌───────▼────────┐ ┌────────▼───────┐
    │ 헌터 (Hunter)    │ │ 캡틴 (Captain) │ │  External APIs │
    │ 주인님의 눈 👁️   │ │ 주인님의 뇌 🧠 │ │                │
    │ Mac Studio #1    │ │ Mac Studio #2  │ │ - Telegram     │
    │ M1 Ultra / 32GB  │ │ M4 Ultra / 36GB│ │ - Slack        │
    │ macOS user: user │ │ macOS user:user│ │ - Notion       │
    │                  │ │                │ │ - 크롤링 대상  │
    │ ┌──────────────┐ │ │ ┌────────────┐ │ └────────────────┘
    │ │ OpenClaw     │ │ │ │ n8n        │ │
    │ │ (ChatGPT Pro)│ │ │ │ (Colima)   │ │
    │ ├──────────────┤ │ │ ├────────────┤ │
    │ │ Gemini CLI   │ │ │ │ Claude Code│ │
    │ │ (임시 대체)  │ │ │ │ (Max)      │ │
    │ │ (계정 B)     │ │ │ │ (계정 A)   │ │
    │ ├──────────────┤ │ │ ├────────────┤ │
    │ │ NotebookLM   │ │ │ │ Gemini CLI │ │
    │ │ (웹 자동화)  │ │ │ │ (Acc A+B)  │ │
    │ ├──────────────┤ │ │ ├────────────┤ │
    │ │ Deep Research│ │ │ │ Gateway +  │ │
    │ │ (웹 자동화)  │ │ │ │ Task API   │ │
    │ └──────────────┘ │ │ ├────────────┤ │
    │                  │ │ │ Agent      │ │
    │ 별도 구글 계정   │ │ │ Wrappers   │ │
    │ 별도 iCloud     │ │ ├────────────┤ │
    │ 개인정보 차단    │ │ │ NotebookLM │ │
    │                  │ │ │ DeepRsch   │ │
    │ ※NotebookLM/    │ │ │ (구글 x2)  │ │
    │  DeepResearch는  │ │ ├────────────┤ │
    │  양쪽 모두 사용  │ │ │ Crawlers   │ │
    │  (구글계정 2개)  │ │ │ (Node.js)  │ │
    │                  │ │ ├────────────┤ │
    │ ┌──────────────┐ │ │ │ Watchdog   │ │
    │ │ Agent        │ │ │ └────────────┘ │
    │ │ Wrapper      │ │ │                │
    │ │ (폴링+실행)  │ │ │                │
    │ └──────────────┘ │ │                │
    │ ┌──────────────┐ │ └────────────────┘
    │ │ Watchdog     │ │
    │ └──────────────┘ │
    └──────────────────┘

주인님 ↔ 헌터 직접 소통 (Telegram/Slack):
  - 주인님 → 헌터: 막연한 아이디어, 비구체적 업무
  - 헌터 → 주인님: 크리티컬 이슈 직접 보고
```

## 하드웨어 상세

### 캡틴 (Mac Studio #2, M4 Ultra / 36GB)

주인님의 뇌 🧠. 판단, 전략, 오케스트레이션. 모든 AI 에이전트와 시스템 서비스가 여기서 실행.
주인님의 개인정보를 보유한 유일한 AI 에이전트.
상세 정의: [docs/agents-charter.md](agents-charter.md)

| 서비스 | 실행 방식 | 예상 RAM | tmux 세션 |
| --- | --- | --- | --- |
| macOS 시스템 | — | ~5GB | — |
| n8n | Colima (Docker) | ~3GB | (docker) |
| Captain (Gateway + Watcher + Planning + Monitors) | Node.js (Express) | ~500MB | `fas-captain` |
| Claude Code (root) | OAuth CLI | ~500MB | `cc-root` |
| Claude Code (FAS) | OAuth CLI | ~500MB | `cc-fas` |
| Telegram Command Listener | Node.js (long polling) | ~50MB | `fas-captain` 내 통합 |
| Persona Injector | 메모리 캐시 (24h TTL) | ~10MB | `fas-captain` 내 통합 |
| Agent Wrappers | Node.js 프로세스들 | ~300MB | 각 에이전트 세션 내 |
| Crawlers | Node.js (cron) | ~200MB | `fas-crawlers` |
| **합계** | | **~10GB** | |
| **여유** | | **~26GB** | |

> **tmux 세션 구조 (현행)**
> - `fas-captain` — `pnpm captain` (Gateway + Watcher + Planning + Monitors 통합)
> - `cc-root` — Claude Code 원격 제어 (범용)
> - `cc-fas` — Claude Code FAS 전용
> - ~~`fas-claude`~~ / ~~`fas-gateway`~~ / ~~`fas-watchdog`~~ / ~~`fas-gemini-a`~~ — deprecated, 현재 미사용

> CLI 도구(Claude Code, Gemini CLI)는 원격 API 호출 기반이므로 로컬 RAM을 거의 안 씀.

### 헌터 (Mac Studio #1, M1 Ultra / 32GB)

주인님의 눈 👁️. 브라우저 자동화 + AI 에이전트 전용. **개인정보 접근 불가.**
주인님과 Telegram/Slack을 통해 직접 소통 가능 (크리티컬 이슈 보고, 막연한 업무 수신).
상세 정의: [docs/agents-charter.md](agents-charter.md)

> AI 플랜은 단계적으로 확장한다. 상세: [PLAN.md "AI 플랜 확장 로드맵"](../PLAN.md)

| 서비스 | 실행 방식 | Stage 1 (검증) | Stage 3 (풀 스케일) | tmux 세션 |
| --- | --- | --- | --- | --- |
| macOS 시스템 | — | ~5GB | ~5GB | — |
| ChatGPT | 브라우저 자동화 | Plus (~$20) | Pro ($200) | `fas-openclaw` |
| 브라우저 (NotebookLM/Deep Research) | Playwright Chrome | ~2GB | ~2GB | 핸들러 내 |
| Gemini CLI (계정 B) | CLI | ~500MB | ~500MB | `fas-gemini-b` |
| Agent Wrapper | Node.js | ~200MB | ~200MB | `fas-wrapper` |
| Watchdog | Node.js | ~200MB | ~200MB | `fas-watchdog` |

> **참고 — Claude Code 미설치**: 헌터에 Claude Code Max x20(계정 B) 탑재 계획이 있었으나, Anthropic 가입 시 전화번호 인증이 필수로 요구되어 현재 사용 불가. 코딩·고지능 작업은 **Gemini CLI (계정 B)**가 임시 대행한다. 상세: [hunter-protocol.md](hunter-protocol.md)

### MacBook Pro (M1 Pro / 32GB) — owner 전용

- AI 자동 실행 **없음**
- SSH로 캡틴/헌터에 접속하여 작업
- Claude Code 수동 사용 (지금처럼)
- Tailscale hostname으로 접속

## 네트워크 토폴로지

```text
┌─────────────────────────────────────────────┐
│              Tailscale VPN Mesh              │
│                                             │
│  MacBook Pro ←──SSH──→ 캡틴 ←──SSH──→ 헌터  │
│  (owner)               (user)        (user) │
│                          │                  │
│                    Task API (HTTP)           │
│                    :3100 포트                │
│                          │                  │
│                    헌터 → 캡틴만 허용         │
│                    (Tailscale ACL)           │
└─────────────────────────────────────────────┘

외부 접근:
  캡틴 → 인터넷 (크롤링, API 호출)
  헌터 → 인터넷 (ChatGPT, Google, 크롤링)
  캡틴 ↔ 헌터: Task API만 (Tailscale 내부)
```

## 태스크 결과 백업 아키텍처

헌터의 크롤링/리서치 결과는 캡틴의 `state/tasks.sqlite`에 1차 저장되지만,
물리적 파괴(디스크 손상, 머신 고장)에 취약하다. Notion을 2차 내구성 저장소로 사용한다.

```text
헌터 (Playwright 실행)
  │
  └─ POST /api/hunter/tasks/:id/result
       │
       ▼
캡틴 Gateway (server.ts)
  │
  ├─ [1차] SQLite 저장 (state/tasks.sqlite) — 즉시, 동기
  │
  └─ [2차] Notion 백업 — fire-and-forget, 비동기
       │
       └─ create_page() → Notion DB (NOTION_TASK_RESULTS_DB)
          실패해도 1차 저장은 이미 완료됨
          실패 시 console.warn만 기록
```

**설계 원칙:**
- Notion 실패가 태스크 완료를 절대 차단하지 않음 (fire-and-forget)
- SQLite가 primary, Notion이 secondary (eventual consistency)
- 환경변수 `NOTION_TASK_RESULTS_DB` 미설정 시 백업 비활성화 (graceful degradation)

---

## 교차 승인 플로우 (Cross-Approval)

```text
캡틴 Claude Code
  │
  ├── MID 리스크 액션 (git commit, 파일 쓰기 등)
  │     │
  │     ▼
  │   cross_approval.ts
  │     │
  │     ├── Gemini CLI 프로세스 spawn
  │     │     └── "이 액션을 승인하시겠습니까?" (JSON 응답)
  │     │
  │     ├── 승인 → 액션 실행
  │     ├── 거부 → 액션 차단 + 로그
  │     └── 타임아웃(10분) / 파싱 실패 → 자동 거부 (secure by default)
  │
  ├── HIGH 리스크 액션 (git push, 배포, 외부 API)
  │     └── Telegram → 인간 승인 (기존 approval_high 플로우)
  │
  └── LOW 리스크 액션 (파일 읽기, 검색)
        └── 자동 실행, 로그만 기록
```

## Telegram Command Listener

Telegram long polling으로 주인님의 명령을 수신하여 태스크를 생성하는 인바운드 채널.
`create_telegram_commands()`로 생성, 캡틴 `main.ts`에서 Gateway와 함께 기동.

```text
주인님 (Telegram)
  │
  ├── /hunter {명령} → chatgpt_task 태스크 생성 (헌터 배정)
  ├── /captain {명령} → 캡틴 태스크 생성
  ├── /crawl {URL} → web_crawl 태스크 생성
  ├── /research {주제} → deep_research 태스크 생성
  ├── /status → 태스크 통계 응답
  ├── /tasks → 대기중 태스크 목록
  ├── /cancel {id} → 태스크 취소
  └── (일반 텍스트) → 기본 captain 태스크로 생성 (PII 보호)
```

보안:
- `config.chat_id`와 일치하는 채팅만 처리, 미인가 채팅은 무시.
- 일반 텍스트(명령어가 아닌 메시지)는 **캡틴 태스크로 생성** — PII가 포함될 수 있는 텍스트가 헌터로 직행하는 취약점을 방지. 캡틴이 먼저 수신하고 판단 후 PII 마스킹하여 헌터에 하위 태스크로 하달.

## Persona Injector

Doctrine memory 파일에서 PII를 제거한 사용자 컨텍스트를 추출하여 태스크 description에 주입.
헌터에게 전달되는 태스크에 배경 정보를 제공하되, 개인정보는 절대 포함하지 않음.

```text
Doctrine memory files (user_overview.md, user_values.md, ...)
  │
  └── PersonaInjector.inject(description)
        ├── strip_pii() — PII 패턴 정규식으로 제거
        ├── extract_career_context() — 직업/경력 (안전)
        ├── extract_education() — 학력 (안전)
        ├── extract_tech_stack() — 기술 스택 (안전)
        └── 24시간 TTL 캐시 → "[Background - 의뢰인 프로필]\n..."
```

## 자율 활동 엔진 (Planning Loop)

```text
07:30 Morning
  │
  ├── planning_loop.run_morning()
  │     ├── config/schedules.yml 읽기
  │     ├── 오늘 due인 태스크 산출 (daily / every_3_days / weekly)
  │     ├── 중복 검사 (이미 pending/in_progress/최근 완료)
  │     ├── TaskStore에 태스크 주입
  │     └── [Morning Briefing] 알림 전송 (Telegram + Slack)
  │
23:00 Night
  │
  └── planning_loop.run_night()
        ├── 일일 통계 집계 (done / blocked / pending)
        └── [Night Summary] 알림 전송
```

## 디렉토리 구조

```text
FAS-operations/
├── README.md                      # 프로젝트 소개
├── PLAN.md                        # 구축 순서
├── CLAUDE.md                      # Claude Code 자율 실행 규칙
├── package.json
├── tsconfig.json
├── docker-compose.yml             # n8n (Colima)
├── .env.example                   # 환경변수 템플릿
│
├── docs/                          # 상세 기술 문서
│   ├── agents-charter.md          # 에이전트 체계 원천 문서 (Source of Truth)
│   ├── architecture.md            # (이 파일)
│   ├── agent-control.md           # 에이전트 제어 프로토콜
│   ├── task-system.md             # 태스크 큐 & 스케줄링
│   ├── gateway.md                 # 승인 게이트웨이 + Task API
│   ├── hunter-protocol.md         # 헌터 격리 & 통신
│   ├── notification.md            # Telegram + Slack + Notion
│   ├── n8n-workflows.md           # n8n 워크플로우 상세
│   ├── crawlers.md                # 크롤러 상세
│   ├── academy.md                 # 학원 자동화
│   ├── pipeline.md                # 캐시플로우 & 사업화
│   ├── monitoring.md              # 감시 & 리소스 모니터링
│   ├── security.md                # 보안
│   └── cost.md                    # 비용 관리
│
├── src/
│   ├── gateway/                   # 승인 게이트웨이 + Task API + 교차 승인
│   ├── captain/                   # 자율 활동 엔진 (Planning Loop, Persona Injector, Telegram Commands, Feedback Extractor)
│   ├── agents/                    # 에이전트 래퍼
│   ├── orchestrator/              # n8n 커스텀 노드 & 워크플로우
│   ├── notification/              # 알림 (Telegram + Slack + Notion)
│   ├── tasks/                     # 태스크 매니저
│   ├── crawlers/                  # 크롤러
│   ├── academy/                   # 학원 자동화
│   ├── pipeline/                  # 사업화 파이프라인
│   ├── watchdog/                  # 감시 데몬
│   ├── validation/                # 할루시네이션 방지
│   └── shared/                    # 공유 유틸리티
│
├── hunter/                        # 헌터 전용 설정 & 배포 패키지
│   ├── CLAUDE.md                  # 헌터 Claude Code 규칙
│   └── openclaw/
│       ├── system_prompt.md       # OpenClaw 초기 지시문
│       └── browsing_rules.md      # 브라우징 규칙
│
├── shadow/                        # 그림자(주인님 디바이스) 설정
│   └── CLAUDE.md                  # 그림자 Claude Code 규칙
│
├── config/                        # 설정 파일
│   ├── agents.yml
│   ├── risk_rules.yml
│   ├── crawlers.yml
│   ├── schedules.yml
│   └── personal_filter.yml
│
├── scripts/
│   ├── setup/
│   │   ├── install_deps.sh
│   │   ├── setup_captain.sh       # 캡틴 초기 세팅
│   │   ├── setup_hunter.sh        # 헌터 초기 세팅
│   │   ├── setup_colima.sh
│   │   └── setup_tmux.sh
│   ├── start_all.sh
│   ├── stop_all.sh
│   └── status.sh
│
├── state/                         # 런타임 상태 (.gitignore)
├── tasks/                         # 태스크 큐 (파일 기반)
│   ├── pending/
│   ├── in_progress/
│   ├── done/
│   └── blocked/
├── reports/                       # 산출물
├── logs/                          # 로그 (.gitignore)
└── tests/
```

## 프로세스 시작 순서

### 캡틴 부팅 시 (`start_all.sh` — `com.fas.start-all.plist`로 로그인 시 자동 실행)

```text
Phase 1: Colima (Docker runtime)
  └─ colima start → Docker daemon 준비 대기

Phase 2: n8n (Docker container)
  └─ docker-compose up -d → n8n health check 대기 (최대 30초)

Phase 3: fas-captain (pnpm captain — 통합 서비스)
  └─ tmux: fas-captain → Gateway + Watcher + Planning + Monitors
  └─ Gateway health check 대기 (http://localhost:3100/api/health, 최대 30초)

Phase 4: Claude Code sessions (빈 세션 — 주인님이 수동 시작)
  └─ tmux: cc-root  (Claude Code 원격 제어)
  └─ tmux: cc-fas   (Claude Code FAS 전용)

Phase 5: Post-boot
  └─ 현재 시간 기반 AWAKE/SLEEP 모드 자동 설정 (07:00~23:00 → awake)
  └─ Telegram 부팅 완료 알림
```

### 헌터 부팅 시 (`hunter_watchdog.sh` — `com.fas.hunter.plist`로 자동 실행)

```text
1. nvm 환경 자동 로드 (비로그인 셸 호환성)
   └─ $NVM_DIR/nvm.sh source → Node.js PATH 확보

2. OpenClaw Gateway health check
   └─ $OPENCLAW_GATEWAY_URL/health 대기 (최대 60초, 5초 간격 폴링)
   └─ 미응답 시 WARNING 로그 후 계속 진행

3. Hunter Agent 시작 (npx tsx src/hunter/main.ts)
   └─ 크래시 시 지수 백오프 자동 재시작 (최대 3회)
   └─ 60초 이상 정상 실행 시 재시도 카운터 리셋
   └─ 로그 경로: $DEPLOY_DIR/logs

4. Task API 폴링 + heartbeat 전송 시작
```
