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
    │ │ Claude Code  │ │ │ │ Claude Code│ │
    │ │ Max x20      │ │ │ │ (Max)      │ │
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
| n8n | Colima (Docker) | ~3GB | `fas-n8n` |
| Claude Code | OAuth CLI | ~500MB | `fas-claude` |
| Gemini CLI (Account A) | CLI | ~500MB | `fas-gemini-a` |
| Gateway + Task API | Node.js (Express) | ~300MB | `fas-gateway` |
| Agent Wrappers | Node.js 프로세스들 | ~300MB | 각 에이전트 세션 내 |
| Crawlers | Node.js (cron) | ~200MB | `fas-crawlers` |
| Watchdog | Node.js | ~200MB | `fas-watchdog` |
| **합계** | | **~10.5GB** | |
| **여유** | | **~25.5GB** | |

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
| Claude Code | OAuth CLI (계정 B) | Pro ($20) | Max x20 ($200) | `fas-claude-hunter` |
| 브라우저 (NotebookLM/Deep Research) | Playwright Chrome | ~2GB | ~2GB | 핸들러 내 |
| Agent Wrapper | Node.js | ~200MB | ~200MB | `fas-wrapper` |
| Watchdog | Node.js | ~200MB | ~200MB | `fas-watchdog` |

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
│   ├── captain/                   # 자율 활동 엔진 (Planning Loop, Feedback Extractor)
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

캡틴 부팅 시 (launchd 또는 start_all.sh):

```text
1. Colima 시작 → n8n 컨테이너 시작
2. Gateway + Task API 시작 (포트 3100)
3. Watchdog 시작
4. Crawler 스케줄러 시작
5. tmux 세션 생성:
   a. fas-claude  → Agent Wrapper + Claude Code
   b. fas-gemini-a → Agent Wrapper + Gemini CLI
6. n8n이 모든 서비스 healthy 확인 → AWAKE/SLEEP 모드 진입
```

헌터 부팅 시:

```text
1. Watchdog 시작
2. tmux 세션 생성:
   a. fas-openclaw → OpenClaw 시작
   b. fas-wrapper  → Agent Wrapper (Task API 폴링)
3. Wrapper가 캡틴의 Task API에 heartbeat 전송 시작
```
