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
    │ Mac Studio #1    │ │ Mac Studio #2  │ │                │
    │ M1 Ultra / 32GB  │ │ M4 Ultra / 36GB│ │ - Telegram     │
    │ macOS user: user │ │ macOS user:user│ │ - Slack        │
    │                  │ │                │ │ - Notion       │
    │ ┌──────────────┐ │ │ ┌────────────┐ │ │ - 크롤링 대상  │
    │ │ OpenClaw     │ │ │ │ n8n        │ │ └────────────────┘
    │ │ (ChatGPT Pro)│ │ │ │ (Colima)   │ │
    │ └──────────────┘ │ │ ├────────────┤ │
    │ ┌──────────────┐ │ │ │ Claude Code│ │
    │ │ NotebookLM   │ │ │ │ (Max)      │ │
    │ │ (웹 자동화)  │ │ │ ├────────────┤ │
    │ ├──────────────┤ │ │ │ Gemini CLI │ │
    │ │ Deep Research│ │ │ │ (Acc A+B)  │ │
    │ │ (웹 자동화)  │ │ │ ├────────────┤ │
    │ └──────────────┘ │ │ │ Gateway +  │ │
    │                  │ │ │ Task API   │ │
    │ 별도 구글 계정   │ │ ├────────────┤ │
    │ 별도 iCloud     │ │ │ Agent      │ │
    │ 개인정보 차단    │ │ │ Wrappers   │ │
    │                  │ │ ├────────────┤ │
    │ ※NotebookLM/    │ │ │ NotebookLM │ │
    │  DeepResearch는  │ │ │ DeepRsch   │ │
    │  양쪽 모두 사용  │ │ │ (구글 x2)  │ │
    │  (구글계정 2개)  │ │ ├────────────┤ │
    │                  │ │ │ Crawlers   │ │
    │ │ Agent        │ │ │ │ (Node.js)  │ │
    │ │ Wrapper      │ │ │ ├────────────┤ │
    │ │ (폴링+실행)  │ │ │ │ Watchdog   │ │
    │ └──────────────┘ │ │ └────────────┘ │
    └──────────────────┘ └────────────────┘
```

## 하드웨어 상세

### 캡틴 (Mac Studio #2, M4 Ultra / 36GB)

메인 워커 + 오케스트레이터. 모든 AI 에이전트와 시스템 서비스가 여기서 실행.

| 서비스 | 실행 방식 | 예상 RAM | tmux 세션 |
| --- | --- | --- | --- |
| macOS 시스템 | — | ~5GB | — |
| n8n | Colima (Docker) | ~3GB | `fas-n8n` |
| Claude Code | OAuth CLI | ~500MB | `fas-claude` |
| Gemini CLI (Account A) | CLI | ~500MB | `fas-gemini-a` |
| Gemini CLI (Account B) | CLI | ~500MB | `fas-gemini-b` |
| Gateway + Task API | Node.js (Express) | ~300MB | `fas-gateway` |
| Agent Wrappers | Node.js 프로세스들 | ~300MB | 각 에이전트 세션 내 |
| Crawlers | Node.js (cron) | ~200MB | `fas-crawlers` |
| Watchdog | Node.js | ~200MB | `fas-watchdog` |
| **합계** | | **~10.5GB** | |
| **여유** | | **~25.5GB** | |

> CLI 도구(Claude Code, Gemini CLI)는 원격 API 호출 기반이므로 로컬 RAM을 거의 안 씀.

### 헌터 (Mac Studio #1, M1 Ultra / 32GB)

격리 워커. OpenClaw + 웹 자동화 전용. **개인정보 접근 불가.**

| 서비스 | 실행 방식 | 예상 RAM | tmux 세션 |
| --- | --- | --- | --- |
| macOS 시스템 | — | ~5GB | — |
| OpenClaw | ChatGPT Pro 브라우저 | ~2GB | `fas-openclaw` |
| 브라우저 (NotebookLM/Deep Research) | Chrome | ~2GB | OpenClaw 내 |
| Agent Wrapper | Node.js | ~200MB | `fas-wrapper` |
| Watchdog | Node.js | ~200MB | `fas-watchdog` |
| **합계** | | **~9.4GB** | |
| **여유** | | **~22.6GB** | |

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

## 디렉토리 구조

```text
fully-automation-system/
├── README.md                      # 프로젝트 소개
├── PLAN.md                        # 구축 순서
├── CLAUDE.md                      # Claude Code 자율 실행 규칙
├── package.json
├── tsconfig.json
├── docker-compose.yml             # n8n (Colima)
├── .env.example                   # 환경변수 템플릿
│
├── docs/                          # 상세 기술 문서
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
│   ├── gateway/                   # 승인 게이트웨이 + Task API
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
   c. fas-gemini-b → Agent Wrapper + Gemini CLI
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
