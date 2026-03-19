# OpenClaw — 헌터의 AI 에이전트 프레임워크

> 관련 문서: [hunter-protocol.md](hunter-protocol.md) | [architecture.md](architecture.md) | [agents-charter.md](agents-charter.md)

---

## 1. OpenClaw이란?

OpenClaw은 **오픈소스 개인 AI 에이전트 프레임워크**다. 다양한 LLM 백엔드(ChatGPT, Claude, Gemini, GLM 등)를 연결하여 24/7 자율 동작하는 개인 비서/에이전트를 구축할 수 있다.

- **GitHub**: [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) (68,000+ stars)
- **공식 문서**: [docs.openclaw.ai](https://docs.openclaw.ai)
- **라이선스**: Apache 2.0

### 핵심 아키텍처 — 3계층 구조

| 계층 | 역할 | 설명 |
|------|------|------|
| **CLI / 런타임** | 실행 엔진 | LLM 호출, 도구 실행, 태스크 루프. `openclaw -p "prompt"` 명령으로 one-shot 실행 가능 |
| **Gateway** | API 서버 | REST/WebSocket API 제공. 외부에서 태스크 주입, 상태 조회 가능 |
| **Persistence** | 상태 저장 | 대화 이력, 메모리, 스킬 데이터를 SQLite/Postgres에 저장. 초기화 후에도 지식 복원 가능 |

### 주요 기능

- **브라우저 자동화**: CDP(Chrome DevTools Protocol) + Playwright 기반. 스냅샷/ref 시스템으로 DOM 요소를 안정적으로 식별하고 조작한다. 봇탐지 우회 기능 내장.
- **메시징 통합**: Telegram, Slack, Discord, WhatsApp, LINE 등 20+ 채널과 연동. 양방향 대화 가능.
- **24/7 자율 동작**: 데몬 모드 실행 시 30분마다 자동으로 깨어나 대기 중인 태스크 확인, 스케줄된 작업 실행, 자율 탐색 수행.
- **Skills / Plugins 생태계**: 5,400+ 커뮤니티 스킬 (웹 검색, 파일 관리, 코드 실행, 데이터 분석 등). `openclaw skill install <name>`으로 즉시 추가.
- **멀티 LLM 지원**: 동일 프레임워크에서 백엔드 LLM을 자유롭게 교체. OpenAI, Anthropic, Google, Zhipu AI 등 주요 프로바이더 모두 지원.

---

## 2. FAS에서의 역할

OpenClaw은 **헌터(Hunter)의 AI 엔진**이다. 헌터 머신(Mac Studio #1, M1 Ultra / 32GB)에서 24/7 가동되며, ChatGPT Pro(계정 B)를 OAuth로 연결하여 추가 API 비용 없이 정액제($200/월)로 사용한다.

### 태스크 흐름

```text
주인님 / 캡틴
     │
     ▼
캡틴 Gateway (Task API, :3100)
     │
     ▼  (Tailscale HTTP)
헌터 Poll Loop (10초 주기)
     │
     ▼
Task Executor
     ├── web_crawl       → Playwright 직접 실행
     ├── browser_task     → Playwright 직접 실행
     ├── deep_research    → Playwright (Gemini Deep Research 웹 UI)
     ├── notebooklm      → Playwright (NotebookLM 웹 UI)
     └── chatgpt_task     → OpenClaw CLI로 위임
```

### Playwright 직접 자동화 vs OpenClaw

| 구분 | Playwright 직접 (`[PW]`) | OpenClaw (`[OC]`) |
|------|--------------------------|-------------------|
| **대상** | 구조화된 웹 태스크 (URL 크롤링, 특정 UI 자동화) | 추상적/자유도 높은 태스크 |
| **예시** | NotebookLM 문서 업로드, Gemini Deep Research 실행, 특정 URL 크롤링 | "AI 교육 시장 트렌드 분석해줘", "이 주제에 대해 리서치해줘", 코드 생성, 종합 분석 |
| **제어 수준** | 정밀 (셀렉터 기반, 단계별 스크립트) | 자율 (LLM이 판단하여 브라우저 탐색) |
| **실패 대응** | 코드 수정 필요 | LLM이 자체 재시도/우회 |

OpenClaw은 캡틴이 구체적으로 스크립팅하기 어려운 **탐색적, 창의적, 분석적 태스크**를 담당한다. 정형화된 웹 자동화는 Playwright가 직접 처리하여 속도와 안정성을 확보한다.

---

## 3. 아키텍처

```text
Captain (Mac Studio #2, M4 Ultra)     Hunter (Mac Studio #1, M1 Ultra)
┌──────────────────┐                  ┌───────────────────────────────┐
│ Gateway API      │                  │ Poll Loop (Task API Client)   │
│ :3100            │◄── Tailscale ──► │   ↓                           │
│                  │     (HTTP)       │ Task Executor                  │
│ Planning Loop    │                  │   ├ web_crawl     [PW]        │
│ Task Store       │                  │   ├ browser_task  [PW]        │
│ Sanitizer (PII)  │                  │   ├ deep_research [PW]        │
│ Notion Backup    │                  │   ├ notebooklm   [PW]        │
│                  │                  │   └ chatgpt_task  [OC]        │
│ Watchdog         │                  │                               │
│ (heartbeat 감시)  │                  │ OpenClaw Gateway (daemon)      │
│                  │                  │   ├ ChatGPT Pro (OAuth, 계정B) │
└──────────────────┘                  │   ├ Browser (CDP/Playwright)  │
                                      │   ├ Memory (SQLite)           │
                                      │   └ Skills (5,400+)           │
                                      └───────────────────────────────┘

[PW] = Playwright direct control
[OC] = OpenClaw framework (LLM-driven autonomous)
```

---

## 4. 설치 및 설정

### 시스템 요구사항

| 항목 | 최소 | 권장 |
|------|------|------|
| Node.js | 22+ | 24 LTS |
| macOS | 12 (Monterey) | 13+ |
| RAM | 4GB+ | 8GB+ (브라우저 자동화 포함 시) |
| 디스크 | 2GB | 5GB+ (브라우저 캐시, 스킬 데이터) |

### 설치 순서

```bash
# 1. OpenClaw 전역 설치
npm install -g openclaw@latest

# 2. 대화형 설정 마법사 실행
openclaw onboard
# → LLM 프로바이더 선택: "OpenAI Codex (ChatGPT OAuth)"
# → OAuth 인증 진행 (아래 섹션 참조)
# → 브라우저 설정: Playwright (자동 설치)
# → 메시징 채널 설정: Telegram (선택)

# 3. 데몬 등록 (launchd, 24/7 자동 실행)
openclaw gateway --install-daemon
# → ~/Library/LaunchAgents/com.openclaw.gateway.plist 자동 생성
# → 부팅/로그인 시 자동 시작

# 4. 동작 확인
openclaw status
```

---

## 5. ChatGPT Pro OAuth 연동 상세

### 원리

ChatGPT Pro($200/월) 구독을 **그대로** 사용한다. 별도의 OpenAI API 키가 필요 없으며, 추가 토큰 과금이 발생하지 않는다. Pro 플랜의 높은/무제한 쿼터를 활용한다.

### 연동 절차

1. `openclaw onboard` 실행
2. LLM 프로바이더 선택: "OpenAI Codex (ChatGPT OAuth)"
3. 터미널에 OAuth URL 출력됨
4. 브라우저에서 해당 URL 열기
5. OpenAI 계정(**계정 B**)으로 로그인
6. OpenClaw 접근 권한 승인
7. 리다이렉트 URL의 `?code=...` 파라미터를 터미널에 붙여넣기
8. 인증 완료 → 토큰 자동 저장 (`~/.openclaw/auth.json`)

### 비용 구조

| 항목 | 비용 | 비고 |
|------|------|------|
| ChatGPT Pro 구독 | $200/월 | 계정 B, 정액제 |
| OpenClaw 프레임워크 | 무료 | 오픈소스 |
| OpenAI API (임베딩) | 극소 (~$1-5/월) | 선택사항, 메모리/검색 기능 활용 시 |

---

## 6. 보안 고려사항

헌터는 **완전 격리된 외부 머신**으로 취급된다. OpenClaw이 브라우저 세션 전체를 제어하므로, 개인정보 유출에 대한 철저한 방어가 필요하다.

### 격리 원칙

| 항목 | 정책 |
|------|------|
| 계정 | 계정 B(헌터 전용 격리 계정)만 사용. 계정 A 접근 절대 금지 |
| 개인정보 | 주인님의 이름, 연락처, 주소, 금융정보 전달/검색/저장 금지 |
| 소스코드 | FAS 소스코드, 아키텍처 문서 접근/보유 금지 |
| 네트워크 | 캡틴과 Task API(:3100)로만 통신 |
| 산이타이징 | 캡틴 Gateway의 Sanitizer가 태스크 전달 시 PII를 자동 제거 |

### OpenClaw 특유의 위험

- **브라우저 세션 전체 제어**: OpenClaw이 CDP로 브라우저를 조작하므로, 로그인된 서비스의 모든 데이터에 접근 가능 → 계정 B 전용 프로필만 사용
- **LLM 프롬프트 인젝션**: 웹 페이지에 악의적 프롬프트가 삽입되면 의도치 않은 동작 가능 → `browsing_rules.md`에서 허용/금지 사이트 목록 관리
- **메모리 누출**: Persistence 계층에 민감 정보가 저장될 수 있음 → 민감한 프롬프트 전달 금지, 주기적 메모리 감사

### 초기화 및 복원

- OpenClaw의 로컬 상태(메모리, 대화 이력)는 초기화 대상
- 운영 노하우는 캡틴의 `state/hunter_knowledge.json`에 보존
- 초기화 후 재배포 시: `deploy_hunter.sh`가 시스템 프롬프트, 브라우징 규칙을 자동 주입

---

## 7. GLM에서 ChatGPT Pro로의 전환

| 시점 | 백엔드 | 상태 | 사유 |
|------|--------|------|------|
| 초기 테스트 | GLM (Zhipu AI) | 폐기 | 개인정보 유출 우려. 한국어/영어 성능 부족 |
| 현재 | ChatGPT Pro (OAuth) | **운영 중** | $200/월 정액제. 최고 수준 성능. API 비용 무발생 |

OpenClaw은 LLM 백엔드를 설정으로 즉시 교체할 수 있다:

```bash
# 현재 백엔드 확인
openclaw config get llm.provider

# 백엔드 교체 (예시)
openclaw onboard --reconfigure-llm
```

---

## 8. 관련 도구 비교

| 도구 | 유형 | FAS에서의 위치 |
|------|------|----------------|
| **OpenClaw** | 범용 AI 에이전트 프레임워크 (LLM + 브라우저 + 메시징) | 헌터의 메인 AI 엔진 |
| **Browser Use** | Python 라이브러리 (LLM 브라우저 에이전트) | 미사용 (OpenClaw이 커버) |
| **Stagehand** | Playwright AI 레이어 | 미사용 (Playwright 직접 사용) |
| **Claude Code** | AI 코딩 에이전트 | 캡틴의 메인 엔진 (계정 A) |
| **Gemini CLI** | AI CLI 도구 | 캡틴(A) + 헌터(B, 임시 코딩) |

---

## 참조

- [hunter-protocol.md](hunter-protocol.md) — 헌터 격리 & 통신 프로토콜
- [architecture.md](architecture.md) — 시스템 아키텍처 전체도
- [agents-charter.md](agents-charter.md) — 에이전트 체계
- [`hunter/openclaw/system_prompt.md`](../hunter/openclaw/system_prompt.md) — OpenClaw 시스템 프롬프트
- [`hunter/openclaw/browsing_rules.md`](../hunter/openclaw/browsing_rules.md) — 브라우징 규칙
