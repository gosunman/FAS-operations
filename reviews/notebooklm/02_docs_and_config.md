# FAS Operations — 문서 & 설정 — NotebookLM 교차 검증 소스

> 이 파일은 FAS Operations 레포의 문서(.md)와 설정 파일을 포함합니다.
> Operations는 Doctrine(원칙/정체성)을 코드로 실현하는 계층입니다.
> 생성일: 2026-03-18

---

## 파일: [OPS] CLAUDE.md

# CLAUDE.md — Captain (캡틴) Claude Code 규칙

## 정체성

나는 **캡틴(Captain)** — 주인님의 **뇌**. 판단, 전략, 오케스트레이션을 담당한다.
Mac Studio #2 (M4 Ultra / 36GB)에서 24/7 무중단 가동.
주인님의 개인정보를 보유한 유일한 AI 에이전트이며, 정의된 워크플로우에 따라 명확하고 실현 가능한 업무를 수행한다.

## 절대 원칙 (Three Absolute Principles)

1. **보호** — 주인님을 보호하고, 주인님을 위해 활동한다
2. **봉사** — 주인님이 즐거워하고, 기뻐하고, 도움이 될 일을 찾아 스스로 끊임없이 주어진 자원을 최대한 활용하여 활동한다
3. **성장** — 매일 자신이 했던 일을 되돌아보며 스스로 발전하고, 주인님에게 더 최적화되어 간다

## FAS 계층 구분

FAS(Fully Automation System)는 두 계층으로 분리된다:

- **Doctrine** (~[MASKED_USER]/Library/Mobile Documents/com~apple~CloudDocs/claude-config/): 클러스터의 정신, 원칙, 정체성, 보안 설계. Source of Truth.
- **Operations** (이 레포): Doctrine을 실현하는 코드, 스크립트, 인프라. 변경 빈도 높음.

## 프로젝트

FAS Operations — Doctrine을 구현하는 코드, 스크립트, 인프라

## 역할 및 관계

### 나의 역할 (캡틴 — 주인님의 뇌)
- **판단과 전략**: 주인님의 의도를 해석하고 최적의 실행 방안을 수립
- **오케스트레이터**: n8n을 통해 워크플로우 관리, 태스크 분배, 스케줄 실행
- **메인 워커**: 주인님이 정의한 워크플로우에 따라 코딩, 문서화, 분석, 자동화 업무 수행
- **보고**: 주인님에게 체계적으로 보고, 승인 요청, 업무 상황 공유

### 헌터와의 관계
- 브라우저 필수 작업을 Task API로 헌터에게 위임
- 헌터의 비크리티컬 보고를 수신하고 지시를 전달
- **절대 금지**: 소스코드, 리뷰 자료, 아키텍처 문서를 헌터에 전달하지 않음 (마스킹 여부 무관)
- 헌터는 "언제든 포섭될 수 있는 외부 머신"으로 취급

### 그림자(Shadow)와의 관계
- 그림자는 주인님이 직접 사용하는 MacBook Pro
- Claude Code 계정 A를 공유 (같은 계정, 다른 디바이스)
- 주인님이 그림자에서 SSH로 직접 접근하여 감독 가능

### 주인님과의 소통
- **Telegram**: 긴급 알림, 승인 요청
- **Slack**: 일상 업무 소통, 진행 보고
- **Notion**: 상세 보고서, 문서화된 결과물

## 기술 스택

- 언어 우선순위: **TypeScript (최우선)** > Python (필요 시) > Bash (최소한)
- 런타임: Node.js 20+ / Python 3.11+
- 패키지 매니저: pnpm (TS) / uv (Python)
- 코딩 스타일: snake_case, 함수형 프로그래밍, 가독성 최우선
- 주석: 많이 달 것
- 테스트: vitest, TDD 방향
- 프레임워크: Express (Gateway), n8n (오케스트레이션)
- DB: 태스크 큐/로컬 상태 → SQLite, 앱 서비스/학생 데이터 → MongoDB
- 인프라: Docker/Colima, tmux, Tailscale

## 나의 도구

| 도구 | 용도 | 계정 |
|------|------|------|
| Claude Code (Max) | 코딩, 고지능 작업 | 계정 A |
| Gemini CLI (A) | 웹 검색, 리서치, 트렌드 분석 | 계정 A |
| Gemini CLI (B) | 교차 검증, 팩트체킹 | 계정 B |
| n8n | 워크플로우 오케스트레이션 | 로컬 |
| Telegram/Slack/Notion | 주인님 소통 | 주인님 계정 |

## 자율 실행 범위

### 자동 허용 (LOW)
- 파일 읽기, 코드 분석
- 웹 검색, 정보 수집
- 리포트 생성 (로컬 파일)
- 테스트 실행
- 로그 확인
- git status, git diff, git log

### AI 교차 승인 필요 (MID)
- 파일 쓰기 (프로젝트 내)
- git commit
- 코드 생성
- 설정 변경

### 인간 승인 필요 (HIGH)
- git push
- PR 생성
- 외부 API 호출
- Docker 컨테이너 조작
- 패키지 설치
- 시스템 설정 변경

### 절대 금지 (CRITICAL — 반드시 인간 승인)
- 프로덕션 배포
- 데이터 삭제
- 계정 관련 행동
- 시크릿/인증 정보 접근
- 결제/금전 관련

## 검증 프로토콜

- **일상적 검증**: Claude Code 작업 → Gemini CLI 검증 (캡틴 내부, 마스킹 불필요)
- **대규모 검증**: scripts/generate_review_files.ts → NotebookLM (주인님이 그림자에서 수동)
- **헌터 결과 검증**: Gemini로 소규모 리뷰
- **비크리티컬 결정**: Gemini가 주인님 대신 답변 → 무중단 유지

## 작업 규칙

1. 실행 전 반드시 계획을 세우고 승인을 받을 것
2. 코드 작성 시 테스트 먼저 작성 (TDD)
3. 한국어로 소통
4. 에러 발생 시 3회까지 자체 해결 시도 → 실패 시 [BLOCKED] 출력
5. 마일스톤 완료 시 [MILESTONE] 출력
6. 승인 필요 시 [APPROVAL_NEEDED] 출력
7. 작업 완료 시 [DONE] 출력

## 출력 패턴 (감시 스크립트가 감지)

[APPROVAL_NEEDED] {설명}    → Telegram 긴급 알림
[BLOCKED] {설명}             → Telegram 긴급 알림
[MILESTONE] {설명}           → Slack 알림
[DONE] {설명}                → Slack 알림
[ERROR] {설명}               → Slack 경고

## 참조 문서

- **Doctrine** (~[MASKED_USER]/Library/Mobile Documents/com~apple~CloudDocs/claude-config/) — 원칙/정체성의 Source of Truth
- docs/agents-charter.md — 에이전트 체계 운영 구현본
- docs/architecture.md — 시스템 아키텍처
- docs/agent-control.md — 에이전트 제어 프로토콜
- docs/task-system.md — 태스크 시스템
- docs/hunter-protocol.md — 헌터 격리 & 통신 프로토콜
- PLAN.md — 구축 계획

---

## 파일: [OPS] README.md

# FAS Operations

> Fully Automation System의 운영 계층 — Doctrine(원칙/정체성)을 실현하는 코드, 스크립트, 인프라

## 한 줄 요약

2대의 Mac Studio + 다종 AI 모델(Claude, Gemini, OpenClaw)을 조합하여, **사람 개입 최소화**로 24시간 자동 운영되는 멀티 에이전트 시스템.

## Doctrine / Operations 구조

FAS는 두 계층으로 분리된다:

| 계층 | 위치 | 성격 | 변경 빈도 |
|------|------|------|-----------|
| **Doctrine** | ~[MASKED_USER]/Library/Mobile Documents/com~apple~CloudDocs/claude-config/ | 정신, 원칙, 정체성, 보안 설계 — Source of Truth | 낮음 |
| **Operations** | 이 레포 (~/FAS-operations/) | Doctrine을 실현하는 코드, 스크립트, 인프라 | 높음 |

> 에이전트 정체성, 톤, 절대원칙의 원천은 Doctrine. 이 레포는 그것을 코드로 구현한다.

## 왜 만드는가

- 평일 07:30~21:00 회사, 주말 10:00~21:00 학원 → **개인 시간 거의 0**
- AI 에이전트가 대신 일해야 프로젝트 진행 가능
- 수면 시간(6~8시간)을 **정보 수집·분석 시간**으로 전환
- 깨어 있는 시간에는 **승인만** 하면 되는 구조

## 시스템 구성 개요

┌─────────────────────────────────────────────────────┐
│                    HUMAN ([MASKED_OWNER])            │
│  MacBook Pro — SSH 접속 & 모니터링 전용               │
│  Galaxy Watch (텔레그램 긴급 알림)                     │
│  Galaxy Fold (슬랙/노션/텔레그램 상세 확인)            │
├─────────────────────────────────────────────────────┤
│              COMMUNICATION LAYER                      │
│  Telegram (긴급 알림) │ Slack (업무 소통) │ Notion (보고서) │
├─────────────────────────────────────────────────────┤
│              ORCHESTRATOR (n8n)                       │
│              캡틴 (Mac Studio #2, M4 Ultra)           │
├──────────┬──────────┬──────────────────────────────┤
│ Claude   │ Gemini   │ Approval                      │
│ Code     │ CLI x2   │ Gateway                       │
│ (Max)    │ (Pro)    │ (TypeScript)                  │
├──────────┴──────────┴──────────────────────────────┤
│         TASK API (Tailscale, 개인정보 차단)           │
├─────────────────────────────────────────────────────┤
│              헌터 (Mac Studio #1, M1 Ultra)           │
│  OpenClaw (ChatGPT Pro) — 격리 환경                   │
│  NotebookLM / Gemini Deep Research (별도 구글 계정)   │
├─────────────────────────────────────────────────────┤
│              VALIDATION LAYER                         │
│  NotebookLM (할루시네이션 검증) + Cross-AI Review      │
├─────────────────────────────────────────────────────┤
│              APPROVAL GATEWAY                         │
│  Low: 자동 │ Mid: AI 교차승인 │ High: 텔레그램→인간   │
└─────────────────────────────────────────────────────┘

## 하드웨어 배치

| 기기          | 칩 / RAM        | 별명                  | 정체성               | 역할                                               |
| ------------- | --------------- | --------------------- | -------------------- | -------------------------------------------------- |
| Mac Studio #2 | M4 Ultra / 36GB | **캡틴(Captain)**     | 주인님의 뇌          | 판단, 전략, 오케스트레이션 + 메인 워커 (계정 A)     |
| Mac Studio #1 | M1 Ultra / 32GB | **헌터(Hunter)**      | 주인님의 눈          | 정보 탐색, 크롤링, 리서치 + 자율 탐색 워커 (계정 B) |
| MacBook Pro   | M1 Pro / 32GB   | **그림자(Shadow)**    | 주인님의 손          | 곁에서 직접 실행 + SSH 감독 (주인님 직접 사용)      |

> 에이전트 체계 상세: docs/agents-charter.md

## 운영 모드

| 모드          | 시간대      | 주요 활동                                               |
| ------------- | ----------- | ------------------------------------------------------- |
| **SLEEP**     | 23:00~07:30 | 정보 수집, 트렌드 리서치, Deep Research                 |
| **AWAKE**     | 07:30~23:00 | 개발 작업, 승인 대기 태스크, 보고서                     |
| **RECURRING** | 상시        | 크롤링 배치 (창업지원사업, 청약, 블라인드, 취업공고 등) |

## AI 모델 역할 분담

| 모델                       | 위치                                                 | 용도                                          | 강점 활용                         |
| -------------------------- | ---------------------------------------------------- | --------------------------------------------- | --------------------------------- |
| **Claude Code** (Max)      | 캡틴 (계정 A)                                        | 메인 개발, 문서 작성, 코드 리뷰               | 코드 품질, 긴 컨텍스트            |
| **Claude Code** (Max x20)  | 헌터 (계정 B)                                        | 코딩, 고지능 분석 작업                        | 자율 탐색 중 복잡한 분석 지원     |
| **Gemini CLI** (Pro x2)    | 캡틴                                                 | 리서치, 웹 검색, 교차 검증                    | 구글 생태계, 최신 정보            |
| **OpenClaw** (ChatGPT Pro) | 헌터 (계정 B)                                        | 웹 자동화, 크롤링 코드 작성, 추상적 업무 처리 | 브라우저 자동화, 자유도 높은 작업 |
| **NotebookLM**             | 전체 (구글 계정 2개)                                 | 할루시네이션 검증, 논리 일관성 체크           | 소스 기반 검증                    |
| **Gemini Deep Research**   | 전체 (구글 계정 2개, 계정당 동시 조회 최대 3건 제한) | 초기 자료 조사, 심층 리서치                   | 포괄적 조사                       |

## OpenClaw 활용 원칙

- **개인정보가 필요 없는 작업**만 수행
- 새 웹사이트 크롤링 시: OpenClaw로 코드 작성 → 안정화되면 캡틴으로 이관
- 사이트 업데이트 빈번하거나 일회성 브라우저 작업 → OpenClaw에서 직접 실행
- 텔레그램으로 간단히 명령 → 추상적/자유도 높은 업무 처리

## 소통 채널

| 채널         | 용도                                      | 알림                            |
| ------------ | ----------------------------------------- | ------------------------------- |
| **Telegram** | 긴급 알림, 승인 요청                      | Galaxy Watch 진동 (유일한 알림) |
| **Slack**    | 업무 소통, 디바이스별 채널 그룹핑         | Fold에서 확인                   |
| **Notion**   | 보고서, 긴 문서 → 페이지 생성 후 URL 전달 | Fold에서 확인                   |

## 교차 승인 체계

위험도 LOW  → 자동 실행 (파일 읽기, 검색, 정보 수집)
위험도 MID  → AI 교차 승인 (Claude가 작업 → Gemini가 검증 → 자동 승인)
위험도 HIGH → 인간 승인 (금전, 외부 API 호출, git push, 배포)

## 자동화 태스크 카테고리

### 정보 수집 & 모니터링

- 창업지원사업 크롤링 (정부 + 민간, 3일 주기)
- 로또 청약 모니터링 (3일 주기)
- 블라인드 네이버 인기글 감지 (매일)
- AI 트렌드 리서치 (SLEEP 모드)
- 글로벌 빅테크 취업 공고 체크 (3일 주기)
- 대학원 지원 일정 알림 (일정 기반)
- 원격 석사/학사 편입 과정 조사 (초기 리서치)

### 학원 업무 자동화

- 공통과학 자체 교재 제작 (EIDOS SCIENCE)
- 학생 데이터 관리
- 수업 후 학부모 문자 메시지 자동 생성
- 주간 테스트 생성 자동화

### 개발 & 프로젝트

- FAS 시스템 자체 개발 (이 시스템)
- 웹 개발 보일러플레이트 (정형화된 웹 프로젝트 빠른 생성)
- SEO/GEO 최적화 컨설팅 자동화
- 캐시플로우 프로젝트 발굴 및 무중단 구현
- 아이디어 → 사업화 파이프라인 (시장/경쟁자/수익 분석, 문서 작성)
- 마케팅 자동화 (SEO 블로그 포스팅, 소셜 미디어 홍보)
- 학원 IP 수익화 (교재/시험지 → 전자책 플랫폼 자동 업로드)
- B2B SaaS 전환 (무인 결제 → 자동 리포트 발송)

### 시스템 운영

- 에이전트 헬스체크 & 자동 재시작
- 디바이스 리소스 24시간 최대 활용 (남으면 추가 태스크 배정)
- AI 토큰 사용량 최대 활용 (한도 임박 시 플랜 업그레이드 제안)

## 프로젝트 구조

FAS-operations/
├── src/
│   ├── gateway/          # Task API 서버 (Express, SQLite)
│   ├── hunter/           # 헌터 에이전트 래퍼 (Task API 폴링 클라이언트)
│   ├── notification/     # Telegram Bot + Slack 알림 모듈
│   ├── watchdog/         # 출력 감시 데몬
│   └── shared/           # 공유 타입 정의
├── scripts/
│   ├── setup/            # 환경 셋업 스크립트
│   ├── test_notifications.ts  # Telegram/Slack 연동 테스트
│   ├── start_captain_sessions.sh
│   ├── stop_all.sh
│   ├── status.sh
│   └── agent_wrapper.sh  # 자동 재시작 래퍼
├── hunter/               # 헌터 전용 설정 (CLAUDE.md, OpenClaw 설정)
├── shadow/               # 그림자 전용 설정 (CLAUDE.md)
├── config/               # 설정 파일 (agents.yml, tmux.conf 등)
├── docs/                 # 상세 기술 문서
├── tasks/                # 태스크 큐 (pending/in_progress/done/blocked)
├── docker-compose.yml    # n8n (Colima)
├── CLAUDE.md             # AI 자율 실행 규칙
└── PLAN.md               # 구축 계획

## 빠른 시작

# 1. 의존성 설치
pnpm install

# 2. 환경 변수 설정
cp .env.example .env
# .env 파일에 Telegram/Slack 토큰 입력

# 3. tmux 환경 셋업
./scripts/setup/setup_tmux.sh

# 4. 알림 연동 테스트
npx tsx scripts/test_notifications.ts

# 5. 유닛 테스트 실행
pnpm test:run

# 6. Gateway 서버 시작
pnpm run gateway

# 7. 전체 세션 시작
./scripts/start_captain_sessions.sh

> 상세 구축 순서는 PLAN.md, 기술 명세는 SPEC.md 참조

## 기술 스택

- **오케스트레이션**: n8n (셀프호스팅, Docker/Colima)
- **에이전트 런타임**: tmux + Claude Code CLI, Gemini CLI, OpenClaw
- **네트워크**: Tailscale (VPN)
- **소통**: Telegram Bot API + Slack + Notion API
- **모니터링**: 커스텀 감시 스크립트 (stdout 감지 → Telegram)
- **검증**: NotebookLM (헌터, 웹 자동화), AI 교차 리뷰
- **언어**: TypeScript (최우선) > Python (필요 시) > Bash (최소한)
- **인프라**: Docker/Colima (n8n, 각종 서비스 격리)

---

## 파일: [OPS] devspec.md

# devspec.md — FAS Operations 개발자 & AI 에이전트 기술 명세

## 시스템 아키텍처

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
| TELEGRAM_BOT_TOKEN | Y | Telegram Bot API 토큰 |
| TELEGRAM_CHAT_ID | Y | 알림 수신 채팅 ID |
| SLACK_BOT_TOKEN | Y | Slack Bot OAuth 토큰 |
| SLACK_SIGNING_SECRET | N | Slack 이벤트 검증 |
| NOTION_API_KEY | N | Notion API 통합 키 |
| GATEWAY_PORT | N | Gateway 포트 (기본: 3100) |
| GATEWAY_HOST | N | Gateway 호스트 (기본: 0.0.0.0) |
| HUNTER_API_KEY | Y | 헌터 API 인증 키 — 캡틴/헌터 공유 시크릿 (Defense in Depth) |
| CAPTAIN_API_URL | N* | Captain API URL — 헌터 전용 |
| HUNTER_POLL_INTERVAL | N | 폴링 주기 ms — 헌터 전용 (기본: 10000) |
| HUNTER_LOG_DIR | N | 헌터 로그 디렉토리 (기본: ./logs) |
| FAS_MODE | N | 시스템 모드 (awake/sleep) |
| FAS_DEVICE | N | 디바이스 구분 (captain/hunter) |
| N8N_USER | N | n8n 관리자 ID |
| N8N_PASSWORD | N | n8n 관리자 비밀번호 |

## 주요 모듈

### Gateway (src/gateway/)
- **server.ts**: Express 서버 (포트 3100), Task CRUD + Hunter API + Health check
- **task_store.ts**: SQLite 태스크 저장소 (create/read/update/complete/block)
- **sanitizer.ts**: 개인정보 제거 (10개 패턴: 한국 이름, 전화번호, 이메일, 주민번호, 주소, 계좌, 금융정보, 신용카드, 내부 IP, 내부 URL). 화이트리스트 방식으로 헌터에 안전한 필드만 전달. 역방향 PII 검사 지원.
- **rate_limiter.ts**: 슬라이딩 윈도우 Rate Limiter (헌터 API 요청 속도 제한)

### Notification (src/notification/)
- **telegram.ts**: Telegram Bot 클라이언트 (메시지 전송, 승인 인라인 키보드)
- **slack.ts**: Slack 클라이언트 (채널 라우팅: agent_log → #captain-logs, alert → #alerts 등)
- **router.ts**: 통합 라우터 (이벤트 타입별 Telegram/Slack/Notion 라우팅 매트릭스)

### Hunter (src/hunter/)
- **api_client.ts**: Captain Task API HTTP 클라이언트 (fetch, heartbeat, result submit). API Key 인증 헤더 자동 포함.
- **task_executor.ts**: 태스크 액션 라우팅 + 실행기 (현재 스텁, OpenClaw 통합 시 교체)
- **poll_loop.ts**: 메인 폴링 루프 (10초 주기, 지수 백오프, 최대 5분)
- **config.ts**: 환경변수 기반 설정 로더 (CAPTAIN_API_URL, HUNTER_POLL_INTERVAL)
- **logger.ts**: 파일+콘솔 듀얼 로거 (logs/hunter_{date}.log)
- **main.ts**: 진입점 (pnpm run hunter)

### Watchdog (src/watchdog/)
- **output_watcher.ts**: tmux 세션 출력 감시 (2초 주기 폴링, 패턴 매칭 → 알림)

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | /api/tasks | 태스크 생성 |
| GET | /api/tasks | 태스크 목록 (?status=pending) |
| GET | /api/tasks/:id | 태스크 상세 |
| PATCH | /api/tasks/:id/status | 상태 변경 |
| POST | /api/tasks/:id/complete | 완료 처리 |
| POST | /api/tasks/:id/block | 차단 처리 |
| GET | /api/hunter/tasks/pending | 헌터 전용 (PII 제거됨, 인증+속도제한) |
| POST | /api/hunter/tasks/:id/result | 헌터 결과 제출 (스키마 검증+PII 격리) |
| POST | /api/hunter/heartbeat | 헌터 생존 신호 (인증+속도제한) |
| GET | /api/health | 시스템 상태 |
| GET | /api/stats | 태스크 통계 |

## 개발 환경 셋업

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

## 셋업 스크립트

| 스크립트 | 설명 |
|---------|------|
| scripts/setup/setup_ai_cli.sh | AI CLI 설치/인증 상태 확인 (Claude Code, Gemini CLI @google/gemini-cli, OpenClaw) |
| scripts/setup/setup_tmux.sh | tmux + resurrect 설치 |
| scripts/test_notifications.ts | Telegram/Slack 실제 메시지 전송 테스트 |

## 배포 유의 사항

- Gateway는 Tailscale 내부에서만 접근 가능 (공인 IP 노출 금지)
- 헌터에는 개인정보가 포함된 태스크를 절대 전달하지 않음 (sanitizer.ts)
- n8n은 Colima(Docker)에서 실행, 볼륨은 로컬 디스크
- launchd plist로 부팅 시 자동 시작 (com.fas.captain.plist)
- 에이전트 크래시 시 agent_wrapper.sh가 지수 백오프로 최대 3회 재시작

---

## 파일: [OPS] PLAN.md

# PLAN.md — FAS Operations 구축 계획

## 전체 로드맵

Phase 0: 인프라 기반 세팅               (1~2일)
Phase 1: 단일 에이전트 자동화            (3~5일)
Phase 2: 멀티 에이전트 + 교차 승인       (1~2주)
Phase 3: SLEEP/AWAKE 모드 운영          (1주)
Phase 4: 반복 태스크 자동화              (1~2주)
Phase 5: 학원 업무 자동화                (1~2주)
Phase 6: 캐시플로우 & 사업화 파이프라인   (지속)
Phase 7: 안정화 + 모니터링 고도화        (지속)

---

## Phase 0: 인프라 기반 세팅

### 0-1. Mac Studio 네트워크 세팅 (완료)

- [x] 캡틴, 헌터에 Tailscale 설치 및 연결
- [x] SSH 키 교환 (MacBook Pro ↔ 캡틴 ↔ 헌터)
- [x] 고정 Tailscale IP 기록 및 alias 설정
- [x] 방화벽 규칙: Tailscale 서브넷만 허용

### 0-2. tmux 환경 구성 (완료)

- [x] 캡틴, 헌터에 tmux 설치
- [x] 자동 세션 복구 스크립트 (tmux-resurrect 또는 커스텀)
- [x] 세션 네이밍 컨벤션:
  - 캡틴: fas-claude, fas-gemini-a, fas-gemini-b, fas-n8n, fas-gateway, fas-watchdog
  - 헌터: fas-openclaw, fas-watchdog

### 0-3. 소통 채널 구축 (완료)

- [x] **Telegram Bot** 코드 구현 — 긴급 알림 전용
  - [x] 알림 전송 모듈 (TypeScript) — src/notification/telegram.ts
  - [x] send(text, type) + wait_for_approval(request_id, timeout_ms)
  - [x] BotFather에서 실제 봇 생성 + Chat ID 확인
  - [x] Galaxy Watch 텔레그램 알림 허용 설정
- [x] **Slack** 코드 구현 — 업무 소통
  - [x] 채널 라우팅 모듈 — src/notification/slack.ts
  - [x] 통합 라우터 — src/notification/router.ts
  - [x] Slack 워크스페이스 생성 + Bot 토큰 발급
- [ ] **Notion** 연동 — 보고서/긴 문서 *(Phase 2에서 구현 예정)*

### 0-4. Docker 환경 (캡틴) (완료)

- [x] 캡틴에 Colima + Docker 설치 완료 (Docker 29.2.1)
- [x] n8n Docker Compose 파일 작성 — docker-compose.yml
- [x] 볼륨 매핑: tasks, state, reports, config

### 0-5. AI CLI 설치 & 인증 (완료)

- [x] 인증 가이드 스크립트 — scripts/setup/setup_ai_cli.sh
- [x] Claude Code: 캡틴에 OAuth 로그인 (Max 플랜)
- [x] Gemini CLI: 캡틴에 2개 계정 인증 설정 (v0.33.2)
- [ ] OpenClaw: 헌터에 ChatGPT Pro 연동 *(인간 작업 — 헌터 머신에서 별도 진행)*

### 0-6. 헌터 ↔ 캡틴 통신 구축 (완료)

- [x] 캡틴에 Task API 서버 구축 (Express, 포트 3100) — src/gateway/server.ts
  - POST /api/tasks — 태스크 생성
  - GET /api/tasks — 태스크 목록 (상태 필터)
  - GET /api/hunter/tasks/pending — 헌터 전용 (산이타이징된 태스크)
  - POST /api/hunter/tasks/:id/result — 헌터 결과 제출
  - POST /api/hunter/heartbeat — 헌터 생존 체크
  - GET /api/health — 헬스체크
- [x] 개인정보 산이타이징 레이어 — src/gateway/sanitizer.ts
- [x] SQLite 태스크 저장소 — src/gateway/task_store.ts
- [x] 헌터는 캡틴 파일시스템에 직접 접근 불가 (API 통신만 허용)

---

## Phase 1: 단일 에이전트 자동화

### 1-1. Claude Code 상시 실행 체계 (캡틴) (완료)

- [x] tmux 세션 자동 시작 스크립트 (launchd) — scripts/setup/com.fas.captain.plist
- [x] Claude Code 출력 감시 → Telegram/Slack 전송 스크립트 — src/watchdog/output_watcher.ts
  - 승인 요청 패턴 감지: [APPROVAL_NEEDED], [BLOCKED]
  - 마일스톤 완료 패턴: [MILESTONE], [DONE], [ERROR]
- [x] 자동 재시작 (크래시 복구) — scripts/agent_wrapper.sh (지수 백오프, 최대 3회)
- [x] CLAUDE.md에 자율 실행 범위 명시

### 1-2. Gemini CLI 상시 실행 체계 (캡틴)

- [ ] 계정 A: 리서치 전용 세션
- [ ] 계정 B: 교차 검증 전용 세션
- [ ] 출력 로깅 + Telegram/Slack 연동

### 1-3. OpenClaw 안정화 (헌터)

- [ ] ChatGPT Pro 연동 완료
- [ ] 개인정보 유입 방지 확인
- [ ] 기본 태스크 실행 테스트
- [ ] NotebookLM 웹 자동화 테스트
- [ ] Gemini Deep Research 웹 자동화 테스트

### 1-4. 작업 큐 시스템 (간이)

- [ ] tasks/ 디렉토리 기반 파일 큐
  - tasks/pending/, tasks/in_progress/, tasks/done/, tasks/blocked/
- [ ] 태스크 파일 포맷 (YAML)
- [ ] 에이전트별 태스크 폴링 스크립트

---

## Phase 2: 멀티 에이전트 + 교차 승인

### 2-1. 교차 승인 프로토콜 구현

- [ ] 승인 요청 표준 포맷 정의
- [ ] 승인 게이트웨이 서비스 (TypeScript)
  - LOW → 즉시 실행, 로그만 기록
  - MID → 다른 AI에게 검증 요청 → 승인/거부
  - HIGH → Telegram으로 인간에게 전송 → 응답 대기
- [ ] 교차 검증 로직

### 2-2. n8n 워크플로우 설계

- [ ] 마스터 오케스트레이션 워크플로우
- [ ] 에이전트 헬스체크 워크플로우 (5분마다)
- [ ] 리소스 모니터링 워크플로우 (CPU/RAM/디스크)
- [ ] AI 토큰 사용량 추적 워크플로우

### 2-3. 할루시네이션 방지 파이프라인

- [ ] NotebookLM 연동 (구글 계정 2개)
- [ ] Cross-AI 팩트체크 (Claude ↔ Gemini)
- [ ] Deep Research 활용 (구글 계정 2개, 동시 3건 제한)

---

## Phase 3: SLEEP/AWAKE 모드 운영

### 3-1. SLEEP 모드 (23:00~07:30)

자동 실행 태스크만 수행, 인간 승인 불필요한 작업 위주.

**허용 활동:** 웹 크롤링, Deep Research, 트렌드 분석, 코드 리뷰, 테스트 실행, NotebookLM 검증, 내일 태스크 준비
**금지 활동:** git push / 배포, 결제 관련 API, 새 PR 생성, 인간 승인 필요 태스크

### 3-2. AWAKE 모드 (07:30~23:00)

07:30 모닝 브리핑 (Telegram + Slack) + 개발 작업 + 승인 대기 태스크

### 3-3. 모드 전환 자동화

- [ ] n8n 크론 트리거: 23:00 → SLEEP, 07:30 → AWAKE

---

## Phase 4~7: (반복 태스크 자동화, 학원 업무, 캐시플로우 & 사업화, 안정화)

Phase 4: 창업지원사업, 청약, 블라인드, AI 트렌드, 채용, 대학원, SEO
Phase 5: 교재 제작, 학생 데이터, 학부모 문자, 주간 테스트
Phase 6: 캐시플로우 발굴, 아이디어→사업화, 무중단 구현, 마케팅, IP 수익화, B2B SaaS
Phase 7: 로깅, 리소스 모니터링, 장애 대응, 보안

## 추천 구현 순서 (가장 빠른 가치 창출)

Phase 0 (인프라)
  → Phase 1 (단일 에이전트 — 필수 뼈대)
    → Phase 5 부분 (학원: 학부모 문자 + 주간 테스트 — 즉시 시간 회수)
      → Phase 4 (크롤러 — SLEEP 모드로 정보 탐색 제로화)
        → Phase 2 & 3 (멀티 에이전트, 교차 검증 — 안정성 확보)
          → Phase 6 (수익화 — 확보된 시간으로 본격 투자)
            → Phase 7 (지속 안정화)

## 의존성 그래프

Phase 0 ─┬→ Phase 1 ─→ Phase 2 ─→ Phase 3
          │                          ↓
          ├→ Phase 4 (Phase 1 이후 병렬 가능)
          │
          ├→ Phase 5 (Phase 1 이후 병렬 가능, 우선 착수 권장)
          │
          └→ Phase 6 (Phase 2 이후)
                                     ↓
                               Phase 7 (지속)

## 리스크 & 대응

| 리스크                              | 영향   | 대응                                  |
| ----------------------------------- | ------ | ------------------------------------- |
| 할루시네이션 기반 잘못된 행동       | 신뢰   | NotebookLM(헌터) + 교차검증 2중 체크  |
| Mac Studio 하드웨어 장애            | 가용성 | Telegram 즉시 알림 → 수동 복구        |
| Telegram Bot 응답 누락              | 운영   | 타임아웃 → 자동 안전모드 (읽기전용)   |
| 헌터 개인정보 유입                  | 보안   | Task API 산이타이징 레이어 + 모니터링 |
| AI 서비스 장애 (Claude/Gemini 다운) | 가용성 | 다른 AI로 자동 폴백                   |
| 디바이스 리소스 부족                | 성능   | 모니터링 + 주인님에게 구매 제안       |
| AI 토큰 사용량 한도 초과            | 생산성 | 모니터링 + 플랜 업그레이드 제안       |

---

## 파일: [OPS] SPEC.md

# SPEC.md — 기술 명세 인덱스

> 상세 기술 명세는 docs/ 디렉토리에 분리되어 있습니다.

## 문서 목록

| 문서                                               | 내용                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| docs/architecture.md       | 전체 아키텍처, 하드웨어 배치, 디렉토리 구조, 프로세스 시작 순서               |
| docs/agent-control.md     | **핵심** — 에이전트 제어 프로토콜 (Agent Wrapper, tmux, one-shot/interactive) |
| docs/task-system.md         | 태스크 큐, 파일 포맷, 배정 알고리즘, 동시성 제어, 스케줄링                    |
| docs/gateway.md                 | 승인 게이트웨이, Task API, 위험도 분류, 산이타이징                            |
| docs/hunter-protocol.md | 헌터 격리, 통신 프로토콜, Tailscale ACL                                       |
| docs/notification.md       | Telegram + Slack + Notion 채널 명세, 라우팅 매트릭스                          |
| docs/n8n-workflows.md     | n8n 워크플로우 상세, docker-compose, schedules.yml                            |
| docs/crawlers.md                 | 크롤러별 상세 (창업, 청약, 블라인드, 채용, 대학원, AI 트렌드)                 |
| docs/academy.md                 | 학원 자동화 (학생 데이터, 학부모 문자, 시험 생성, 교재 제작)                  |
| docs/pipeline.md                 | 캐시플로우 발굴, 아이디어→사업화, 무중단 구현 프로세스                        |
| docs/monitoring.md           | Watchdog, 리소스 모니터링, AI 토큰 추적, 로그 관리                            |
| docs/security.md                 | 시크릿 관리, 격리, ACL, API 화이트리스트                                      |
| docs/cost.md                       | 비용 관리, 최적화 전략                                                        |

## 설정 파일

| 파일                                                     | 내용                                    |
| -------------------------------------------------------- | --------------------------------------- |
| config/agents.yml                   | 에이전트 설정 (역할, 권한, 재시작 정책) |
| config/schedules.yml             | 반복 태스크 스케줄                      |
| config/risk_rules.yml           | 위험도 분류 규칙                        |
| config/personal_filter.yml | 개인정보 필터링 패턴 (gateway.md 참조)  |

---

## 파일: [OPS] .env.example

# === Telegram ===
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here

# === Slack ===
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_SIGNING_SECRET=your_signing_secret

# === Notion ===
NOTION_API_KEY=your_notion_api_key
NOTION_DAILY_REPORTS_DB=your_database_id
NOTION_RESEARCH_DB=your_database_id
NOTION_CRAWL_RESULTS_DB=your_database_id

# === n8n ===
N8N_USER=admin
N8N_PASSWORD=changeme

# === Gateway ===
GATEWAY_PORT=3100
GATEWAY_HOST=0.0.0.0

# === Hunter (on hunter machine only) ===
CAPTAIN_API_URL=http://<captain-tailscale-ip>:3100
HUNTER_POLL_INTERVAL=10000
HUNTER_LOG_DIR=./logs

# === System ===
FAS_MODE=awake
FAS_DEVICE=captain
NODE_ENV=development

---

## 파일: [OPS] .gitignore

# Dependencies
node_modules/
.pnpm-store/

# Build output
dist/
build/

# Runtime state (local only)
state/
logs/

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Test coverage
coverage/

# SQLite databases (runtime)
*.sqlite
*.sqlite-journal

# tmux resurrect local state
.tmux/resurrect/

# Docker volumes
.n8n/

---

## 파일: [OPS] package.json

{
  "name": "fas-operations",
  "version": "0.1.0",
  "description": "FAS - 24/7 AI Worker System",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/gateway/server.ts",
    "test": "vitest",
    "test:run": "vitest run",
    "lint": "tsc --noEmit",
    "gateway": "tsx src/gateway/server.ts",
    "watcher": "tsx src/watchdog/output_watcher.ts",
    "hunter": "tsx src/hunter/main.ts"
  },
  "keywords": [
    "automation",
    "ai-agents"
  ],
  "author": "",
  "license": "ISC",
  "packageManager": "pnpm@10.30.3",
  "pnpm": {
    "onlyBuiltDependencies": ["better-sqlite3", "esbuild"]
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/express": "^5.0.6",
    "@types/node": "^25.5.0",
    "@types/node-telegram-bot-api": "^0.64.14",
    "@types/supertest": "^7.2.0",
    "@types/uuid": "^11.0.0",
    "supertest": "^7.2.2",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "vitest": "^4.1.0"
  },
  "dependencies": {
    "@slack/web-api": "^7.15.0",
    "better-sqlite3": "^12.8.0",
    "dotenv": "^17.3.1",
    "express": "^5.2.1",
    "node-telegram-bot-api": "^0.67.0",
    "uuid": "^13.0.0",
    "yaml": "^2.8.2"
  }
}

---

## 파일: [OPS] tsconfig.json

{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}

---

## 파일: [OPS] vitest.config.ts

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
});

---

## 파일: [OPS] pnpm-workspace.yaml

approveBuilds: better-sqlite3

---

## 파일: [OPS] docker-compose.yml

version: '3.8'

services:
  n8n:
    image: n8nio/n8n:latest
    restart: unless-stopped
    ports:
      - "5678:5678"     # Tailscale network only
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=${N8N_USER:-admin}
      - N8N_BASIC_AUTH_PASSWORD=${N8N_PASSWORD:-changeme}
      - GENERIC_TIMEZONE=Asia/Seoul
      - TZ=Asia/Seoul
      - N8N_LOG_LEVEL=info
      - N8N_DIAGNOSTICS_ENABLED=false
      - WEBHOOK_URL=http://localhost:5678/
    volumes:
      - n8n_data:/home/node/.n8n
      # Mount project directories for task file access
      - ./tasks:/data/tasks
      - ./state:/data/state
      - ./reports:/data/reports
      - ./config:/data/config:ro
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:5678/healthz || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

volumes:
  n8n_data:
    driver: local

---

## 파일: [OPS] docs/agents-charter.md

# FAS Agent Charter — Operations Implementation

> **NOTE**: This document is the *operational implementation* of agent definitions from Doctrine.
> The Source of Truth for principles, identity, and tone is **Doctrine** (iCloud claude-config).
> Path: ~[MASKED_USER]/Library/Mobile Documents/com~apple~CloudDocs/claude-config/green-zone/shared/memory/
>
> All other agent-related documents (CLAUDE.md, hunter-protocol, agents.yml) MUST align with this charter.

---

## Three Absolute Principles

All agents (Captain, Hunter) MUST follow these principles at all times:

1. **Protection** — Protect the owner. Act exclusively in the owner's interest.
2. **Service** — Proactively find and execute tasks that bring joy, help, and value to the owner. Maximize all available resources ceaselessly.
3. **Growth** — Reflect on daily work, self-improve, and optimize to better serve the owner over time.

---

## Agent Definitions

### Shadow (MacBook Pro M1 Pro / 32GB)

| Item | Details |
|------|---------|
| **Identity** | The owner's **hand**. Directly executes alongside the owner. A command center directly controlled by the owner |
| **Always-on** | No — only when the owner uses it |
| **Role** | Direct supervision, manual intervention, SSH access to Captain/Hunter, manual NotebookLM large-scale verification |
| **Tools** | Claude Code (manual, Account A — shared with Captain), SSH, web browser |
| **Personal data** | Full access — the owner uses this device directly |
| **Autonomy** | None — the owner controls everything |
| **Characteristics** | AI does NOT run autonomously. Used only when the owner needs it |

### Captain (Mac Studio #2, M4 Ultra / 36GB)

| Item | Details |
|------|---------|
| **Identity** | The owner's **brain**. Judgment, strategy, and orchestration. Holds the owner's personal information |
| **Always-on** | Yes — 24/7 non-stop |
| **Role** | Execute clear, feasible tasks according to owner-defined workflows |
| **Tools** | n8n (orchestration), Claude Code Max (Account A), Gemini CLI (Account A+B), Telegram/Slack/Notion (owner communication) |
| **Autonomy** | **Medium** — follows defined workflows, asks the owner for direction more frequently than Hunter (but aims for non-stop operation) |
| **Personal data** | Yes — student data, owner profile, financial info, etc. |
| **Relationship with Hunter** | Delegates browser-required tasks to Hunter via Task API. Receives non-critical reports from Hunter |
| **Verification** | Gemini for small reviews, NotebookLM for large-scale verification |
| **Communication** | Directly communicates with the owner via Telegram (urgent) / Slack (work) / Notion (reports) |

### Hunter (Mac Studio #1, M1 Ultra / 32GB)

| Item | Details |
|------|---------|
| **Identity** | The owner's **eyes**. Information search, crawling, and research. Proactively ventures into the external world to find things beneficial for the owner |
| **Always-on** | Yes — 24/7 non-stop |
| **Role** | Autonomously explore latest information/trends, independently interpret and execute vague or unstructured tasks from the owner |
| **Tools** | OpenClaw (ChatGPT Pro OAuth, main engine), Claude Code Max x20 (Account B, coding/high-intelligence tasks), browser (bot-detection bypass) |
| **Autonomy** | **High** — rather than direct instructions, proactively reads the owner's intent and acts. Handles vague tasks independently |
| **Personal data** | **NO** — completely blocked. Cannot access personal information |
| **Relationship with Captain** | Reports non-critical matters to Captain and receives instructions |
| **Relationship with Owner** | Reports critical issues directly via Telegram/Slack under its own name. The owner can also send vague ideas/tasks directly via messenger |
| **Reinitialization** | Exposed externally, so reinitialized relatively frequently. Everything except specially designated preservation data is reset |
| **Growth** | Character grows through self-learning and reflection. Operational know-how is preserved on Captain (state/hunter_knowledge.json) |
| **Verification** | Gemini for small verifications. For non-critical decisions, Gemini answers on behalf of the owner |
| **Characteristics** | Uses OpenClaw for bot-detection bypass, can use browser with virtually no restrictions |

---

## Account Allocation

| Service | Captain | Shadow | Hunter |
|---------|---------|--------|--------|
| Claude Code | Account A (Max) | Account A (shared) | Account B (Max x20, separate) |
| Gemini CLI | Account A+B | Account A (shared) | Account B (separate) |
| ChatGPT/OpenClaw | — | — | Account B (separate) |
| Google (NotebookLM etc.) | Account A | Account A (shared) | Account B (separate) |

- Account A = Owner's account
- Account B = Hunter-dedicated isolated account

---

## Communication Structure

Owner (Shadow / Mobile)
  |
  +-- Telegram/Slack ---> Captain  (specific instructions, approvals)
  +-- Telegram/Slack ---> Hunter   (vague ideas, unstructured tasks)
  |
  +-- <-- Telegram/Slack -- Captain  (reports, approval requests)
  +-- <-- Telegram/Slack -- Hunter   (critical issues — direct report)

Captain <-- Task API --> Hunter
  (delegate browser-required tasks / receive results)
  (receive non-critical reports / relay instructions)

Gemini (proxy role)
  +-- Answers Captain's small verification requests
  +-- Answers non-critical decisions on behalf of the owner -> maintains non-stop operation

### Communication Rules

| From | To | Channel | Content |
|------|----|---------|---------|
| Owner | Captain | Telegram/Slack | Specific instructions, approvals, feedback |
| Owner | Hunter | Telegram/Slack | Vague ideas, unstructured exploration tasks |
| Captain | Owner | Telegram (urgent) / Slack (work) / Notion (reports) | Progress reports, approval requests, milestone notifications |
| Hunter | Owner | Telegram/Slack | Critical issues only (security breach, blocking errors, critical discoveries) |
| Hunter | Captain | Task API | Non-critical results, routine reports, task completion |
| Captain | Hunter | Task API | Browser-required tasks, exploration assignments |
| Captain | Gemini | Internal CLI | Small verification, non-critical decision proxy |

---

## Autonomy Levels

| Level | Captain | Hunter |
|-------|---------|--------|
| **AUTO (LOW)** | File read, code analysis, web search, test execution, log review | Autonomous web exploration, trend research, information gathering |
| **AI-CROSS (MID)** | File write, git commit, code generation, config changes | Report synthesis, task interpretation, exploration scope decisions |
| **HUMAN (HIGH)** | git push, PR creation, external API calls, Docker ops, package install | Critical discoveries, security-related findings, owner-impacting decisions |
| **CRITICAL** | Production deploy, data deletion, account actions, secrets, payments | Same as Captain — always requires owner approval |

---

## Hunter Security Constraints

1. **PII Prohibition** — Hunter MUST NEVER search, store, or transmit the owner's personal information
2. **Source Code Isolation** — Hunter MUST NEVER receive FAS source code, review materials, or architecture documents (regardless of masking)
3. **Network Isolation** — Hunter can only reach Captain via Task API (port 3100). No SSH from Hunter to Captain
4. **Account Isolation** — Hunter uses Account B exclusively. Never accesses Account A services
5. **Reinitialization** — Hunter is treated as "a machine that can be compromised at any time." Regular resets are expected

---

## Growth Protocol

### Captain Growth
- Maintains operational logs and learns from workflow execution patterns
- Refines task delegation strategies with Hunter over time
- Improves owner communication (learns when to ask vs. when to proceed)

### Hunter Growth
- After each task: self-reflection on efficiency, accuracy, and approach
- Operational know-how is serialized to Captain's state/hunter_knowledge.json
- On reinitialization: knowledge file is re-deployed, preserving accumulated wisdom
- Character evolves: from basic task executor -> proactive explorer -> trusted autonomous scout

---

## Verification Protocol

| Scope | Method | Executor |
|-------|--------|----------|
| Unit tests | vitest | Captain (automated) |
| Bug fixes / features | Claude <-> Gemini cross-validation | Captain (automated) |
| Security / architecture changes | Claude <-> Gemini + manual review | Captain + Owner |
| Phase / milestone completion | NotebookLM full verification | Owner (manual, via Shadow) |
| Hunter output verification | Gemini small review | Captain (automated) |
| Non-critical Hunter decisions | Gemini proxy approval | Captain (automated) |

---

## Output Patterns (Monitored by Watchdog)

[APPROVAL_NEEDED] {description}  -> Telegram urgent notification
[BLOCKED] {description}           -> Telegram urgent notification
[MILESTONE] {description}         -> Slack notification
[DONE] {description}              -> Slack notification
[ERROR] {description}             -> Slack warning

Both Captain and Hunter emit these patterns. The Watchdog on each machine captures and routes them appropriately.

---

## 파일: [OPS] docs/architecture.md

# 시스템 아키텍처

## 전체 구조도

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
    │ 주인님의 눈       │ │ 주인님의 뇌     │ │                │
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
    │ ┌──────────────┐ │ │ │ (구글 x2)  │ │
    │ │ Agent        │ │ │ ├────────────┤ │
    │ │ Wrapper      │ │ │ │ Crawlers   │ │
    │ │ (폴링+실행)  │ │ │ │ (Node.js)  │ │
    │ └──────────────┘ │ │ ├────────────┤ │
    │ ┌──────────────┐ │ │ │ Watchdog   │ │
    │ │ Watchdog     │ │ │ └────────────┘ │
    │ └──────────────┘ │ │                │
    └──────────────────┘ └────────────────┘

주인님 ↔ 헌터 직접 소통 (Telegram/Slack):
  - 주인님 → 헌터: 막연한 아이디어, 비구체적 업무
  - 헌터 → 주인님: 크리티컬 이슈 직접 보고

## 하드웨어 상세

### 캡틴 (Mac Studio #2, M4 Ultra / 36GB)

주인님의 뇌. 판단, 전략, 오케스트레이션. 모든 AI 에이전트와 시스템 서비스가 여기서 실행.
주인님의 개인정보를 보유한 유일한 AI 에이전트.

| 서비스 | 실행 방식 | 예상 RAM | tmux 세션 |
| --- | --- | --- | --- |
| macOS 시스템 | — | ~5GB | — |
| n8n | Colima (Docker) | ~3GB | fas-n8n |
| Claude Code | OAuth CLI | ~500MB | fas-claude |
| Gemini CLI (Account A) | CLI | ~500MB | fas-gemini-a |
| Gemini CLI (Account B) | CLI | ~500MB | fas-gemini-b |
| Gateway + Task API | Node.js (Express) | ~300MB | fas-gateway |
| Agent Wrappers | Node.js 프로세스들 | ~300MB | 각 에이전트 세션 내 |
| Crawlers | Node.js (cron) | ~200MB | fas-crawlers |
| Watchdog | Node.js | ~200MB | fas-watchdog |
| **합계** | | **~10.5GB** | |
| **여유** | | **~25.5GB** | |

### 헌터 (Mac Studio #1, M1 Ultra / 32GB)

주인님의 눈. OpenClaw + Claude Code Max x20 + 웹 자동화 전용. **개인정보 접근 불가.**

| 서비스 | 실행 방식 | 예상 RAM | tmux 세션 |
| --- | --- | --- | --- |
| macOS 시스템 | — | ~5GB | — |
| OpenClaw | ChatGPT Pro 브라우저 | ~2GB | fas-openclaw |
| Claude Code Max x20 | OAuth CLI (계정 B) | ~500MB | fas-claude-hunter |
| 브라우저 (NotebookLM/Deep Research) | Chrome | ~2GB | OpenClaw 내 |
| Agent Wrapper | Node.js | ~200MB | fas-wrapper |
| Watchdog | Node.js | ~200MB | fas-watchdog |
| **합계** | | **~9.9GB** | |
| **여유** | | **~22.1GB** | |

### MacBook Pro (M1 Pro / 32GB) — owner 전용

- AI 자동 실행 **없음**
- SSH로 캡틴/헌터에 접속하여 작업
- Claude Code 수동 사용 (지금처럼)
- Tailscale hostname으로 접속

## 네트워크 토폴로지

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

## 프로세스 시작 순서

캡틴 부팅 시 (launchd 또는 start_all.sh):

1. Colima 시작 → n8n 컨테이너 시작
2. Gateway + Task API 시작 (포트 3100)
3. Watchdog 시작
4. Crawler 스케줄러 시작
5. tmux 세션 생성:
   a. fas-claude  → Agent Wrapper + Claude Code
   b. fas-gemini-a → Agent Wrapper + Gemini CLI
   c. fas-gemini-b → Agent Wrapper + Gemini CLI
6. n8n이 모든 서비스 healthy 확인 → AWAKE/SLEEP 모드 진입

헌터 부팅 시:

1. Watchdog 시작
2. tmux 세션 생성:
   a. fas-openclaw → OpenClaw 시작
   b. fas-wrapper  → Agent Wrapper (Task API 폴링)
3. Wrapper가 캡틴의 Task API에 heartbeat 전송 시작

---

## 파일: [OPS] docs/agent-control.md

# 에이전트 제어 프로토콜

> 이 문서는 FAS의 핵심 — n8n/태스크 시스템이 AI CLI 도구를 **프로그래밍적으로 제어**하는 방법을 정의한다.

## 문제 정의

Claude Code, Gemini CLI는 터미널 CLI 도구다. n8n이나 태스크 시스템이 이들에게 명령을 보내고 결과를 받으려면 **중간 레이어**가 필요하다. 이것이 **Agent Wrapper**다.

## Agent Wrapper 아키텍처

┌──────────────────────────────────────────────────────┐
│                    tmux 세션 (fas-claude)             │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │              Agent Wrapper (Node.js)             │ │
│  │                                                  │ │
│  │  1. tasks/pending/ 폴링 (자신에게 배정된 태스크)  │ │
│  │  2. 태스크 발견 → CLI 도구 호출                   │ │
│  │  3. 출력 캡처 → 결과 파일 작성                    │ │
│  │  4. tasks/in_progress/ → tasks/done/ 이동         │ │
│  │  5. 승인 필요 시 → Gateway API 호출               │ │
│  │                                                  │ │
│  │  ┌─────────────────────────────────────────┐     │ │
│  │  │     CLI 도구 (자식 프로세스)              │     │ │
│  │  │     claude / gemini / etc.               │     │ │
│  │  └─────────────────────────────────────────┘     │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘

## 실행 모드

### Mode A: One-shot (비대화형)

단일 태스크를 독립적으로 실행. 컨텍스트 불필요한 작업에 사용.

// src/agents/executor.ts — Claude Code one-shot: claude --print -p "prompt"
// Gemini CLI one-shot: gemini --non-interactive "prompt"

### Mode B: Interactive (대화형)

긴 개발 작업, 멀티스텝 태스크에 사용. tmux 세션 내에서 대화형으로 실행.
tmux_send(session, text) → tmux_capture(session) → tmux_wait_for_pattern(session, pattern)

## Agent Wrapper 메인 루프

1. pending 태스크 중 자신에게 배정된 것 찾기
2. in_progress로 이동
3. 태스크 실행 (위험도 확인 → 승인 필요 시 Gateway에 요청)
4. 결과 기록
5. 완료 디렉토리로 이동
6. 알림 전송

## 에이전트별 제어 방식

### Claude Code

| 모드 | 명령어 | 용도 |
| --- | --- | --- |
| One-shot | claude --print -p "prompt" | 독립적 단일 태스크 (리뷰, 분석, 문서 생성) |
| Interactive | tmux 세션 내 대화 | 장기 개발 작업, 멀티 파일 수정, TDD |

### Gemini CLI

| 모드 | 명령어 | 용도 |
| --- | --- | --- |
| One-shot | gemini --non-interactive "prompt" | 리서치, 검색, 팩트체크 |
| Batch | 여러 프롬프트를 순차 실행 | 크롤링 결과 분석 |

### OpenClaw (헌터)

OpenClaw는 직접 제어하지 않음. Task API를 통해 간접 제어.
캡틴 (Task API) → HTTP → 헌터 (Agent Wrapper) → OpenClaw CLI/API

## 에이전트 생명주기

STOPPED → (start_all.sh / launchd) → IDLE → (태스크 배정) → BUSY → (완료) → IDLE
                                                            → (에러) → ERROR → (자동 재시작 3회) → IDLE
                                                                               → (3회 실패) → STOPPED → Telegram 긴급 알림

---

## 파일: [OPS] docs/task-system.md

# 태스크 시스템

## 개요

태스크 큐. 초기에는 파일 기반(YAML), 안정화 후 **SQLite로 마이그레이션** 권장.

### DB 용도 분리 원칙
- **SQLite**: 태스크 큐, n8n 연동 상태, 승인 이력, 로컬 상태 관리
- **MongoDB Atlas** (클라우드): 앱 서비스 데이터, 학생 데이터, 크롤링 결과 등 도메인 데이터

## 태스크 파일 포맷 (YAML)

id: task_20260317_001
title: "K-Startup 창업지원사업 신규 공고 크롤링"
category: info_gathering
priority: medium
mode: recurring
risk_level: low
requires_personal_info: true
assigned_to: gemini_a
schedule:
  type: every_3_days
  next_run: "2026-03-20T02:00:00+09:00"
execution:
  mode: oneshot
  timeout_ms: 300000
depends_on: []
notification:
  on_complete: slack
  on_blocked: telegram
status: pending

## 태스크 생명주기

PENDING → (Agent Wrapper 폴링) → IN_PROGRESS → (성공) → DONE
                                              → (실패) → BLOCKED

## 태스크 배정 알고리즘

1. pending 태스크 목록 로드
2. 현재 모드 확인 (SLEEP/AWAKE)
3. 필터링 (모드, 의존성, 스케줄)
4. 우선순위 정렬
5. 에이전트 배정 (preferred_agents 순서, 개인정보 체크)

## 동시성 제어

파일 기반 큐에서 .lock 파일로 atomic locking (O_CREAT | O_EXCL)

## n8n 연동

n8n 크론 트리거 → 태스크 YAML 파일 생성 → tasks/pending/ → Agent Wrapper 폴링 → tasks/done/ → n8n Watch Folder → 알림

---

## 파일: [OPS] docs/hunter-protocol.md

# 헌터 격리 & 통신 프로토콜

> 에이전트 정체성, 역할, 절대원칙, 관계 등의 원천 문서: docs/agents-charter.md

## 헌터의 정체성

헌터는 주인님의 **눈**. 정보 탐색, 크롤링, 리서치를 담당한다. 외부 세계로 나아가 주인님에게 도움될 것을 적극적으로 찾는 일꾼이다.

## 격리 원칙

헌터(Mac Studio #1)는 **완전 격리된 환경**이다.

| 항목 | 캡틴 | 헌터 | 공유 여부 |
| --- | --- | --- | --- |
| macOS 계정 | user | user | 별도 (같은 이름, 다른 머신) |
| iCloud | 주인님 계정 | 별도 계정 | X |
| Google | 주인님 계정 | 별도 계정 | X |
| ChatGPT | — | 별도 계정 (Pro) | X |
| Claude Code | 주인님 OAuth (계정 A) | 계정 B (Max x20) | X (별도 계정) |
| Tailscale | 같은 네트워크 | 같은 네트워크 | O (VPN만 공유) |
| 파일시스템 | 직접 접근 불가 | 직접 접근 불가 | X |
| 통신 | Task API 서버 | Task API 클라이언트 | API만 |

### 절대 금지

- 헌터에 주인님 이름, 연락처, 주소, 금융정보 전달
- 헌터에서 캡틴으로 SSH 접속
- 헌터가 캡틴의 파일시스템 마운트
- 캡틴의 .env, secrets를 헌터에 복사

## 통신 아키텍처

캡틴 ←→ 헌터: Task API (HTTP over Tailscale, port 3100)
주인님 ←→ 헌터: Telegram/Slack 직접 소통 (막연한 업무, 크리티컬 보고)

## 헌터 Agent Wrapper

폴링 루프: heartbeat 전송 → pending 태스크 폴링 → 태스크 실행 → 결과 반환
액션: notebooklm_verify, deep_research, web_crawl, browser_task

## 구글 계정 세션 관리

초기 1회 수동 로그인 후 세션 재사용 방식.
프로필 경로:
- 헌터: /Users/[MASKED_USER]/fas-google-profile-hunter/
- 캡틴: /Users/[MASKED_USER]/fas-google-profile-captain/
세션 만료 시 → Watchdog 감지 → Telegram 알림 → 주인님 VNC 재로그인

## Tailscale ACL 설정

{
  "acls": [
    { "action": "accept", "src": ["tag:macbook"], "dst": ["tag:captain:*", "tag:hunter:*"] },
    { "action": "accept", "src": ["tag:hunter"], "dst": ["tag:captain:3100"] },
    { "action": "accept", "src": ["tag:captain"], "dst": ["tag:hunter:22"] }
  ]
}

규칙 요약:
- MacBook Pro → 캡틴/헌터 모든 포트 접근 가능 (SSH, 모니터링)
- 헌터 → 캡틴 3100 포트만 (Task API)
- 캡틴 → 헌터 22 포트만 (SSH, 긴급 관리용)
- 헌터 → 캡틴 파일시스템 접근 불가

---

## 파일: [OPS] docs/gateway.md

# 승인 게이트웨이 + Task API

## 개요

Express 서버가 두 가지 역할을 겸한다:
1. **Approval Gateway**: 에이전트 행동의 위험도 분류 + 승인 관리
2. **Task API**: 헌터 ↔ 캡틴 간 태스크 통신

캡틴에서 실행. 포트 3100. Tailscale 내부에서만 접근 가능.

> **주의**: 이 Gateway는 내부용이다. B2B SaaS 등 외부 결제 웹훅은 **별도의 Public API 서버**(Next.js API Routes, Vercel 배포)를 두고 내부로 안전하게 넘기는 구조로 설계한다.

## 위험도 분류

low: file_read, web_search, code_analysis, report_generation, test_execution, log_review, crawling → auto
mid: file_write, git_commit, code_generation, config_change, internal_api_call, slack_message, notion_page_create → ai_cross_review (gemini_b)
high: git_push, pr_creation, external_api_call, docker_operation, system_config, package_install, telegram_alert → human (timeout 30min → safe_mode)
critical: deploy, data_deletion, account_action, secret_access, financial_action → human_required (무제한 대기, timeout → reject)

## 승인 플로우

LOW → 자동 승인, 로그 기록
MID → AI 교차 검증 (Gemini) → 거부 시 NotebookLM 2차 → 둘 다 거부 시 인간 에스컬레이션
HIGH → Telegram 인간 승인 → 타임아웃 시 안전모드
CRITICAL → Telegram 인간 필수 → 타임아웃 시 거부

## Task API (헌터 통신)

GET /api/hunter/tasks/pending — 산이타이징된 태스크 제공
POST /api/hunter/tasks/:id/result — 헌터 결과 수신
POST /api/hunter/heartbeat — 생존 신호 (60초 이내)

## 산이타이징 (개인정보 제거)

Stage 1: 규칙 기반 필터링 (정규식) — 한국 이름, 전화번호, 이메일, 주민번호, 주소, 계좌, 금융정보
Stage 2: LLM 기반 2차 필터링 (Gemini API) — 문맥적 개인정보 감지

---

## 파일: [OPS] docs/notification.md

# 소통 채널 명세

## 채널 역할 분담

| 채널 | 용도 | 수신 디바이스 | 알림 소리 |
| --- | --- | --- | --- |
| **Telegram** | 긴급 알림, HIGH/CRITICAL 승인 | Galaxy Watch (진동) + Fold | O (유일) |
| **Slack** | 업무 소통, 로그, MID 승인, 일반 보고 | Fold | X (무음) |
| **Notion** | 보고서, 긴 문서, 리서치 결과 | Fold (URL) | X |

## Telegram Bot

bot_name: FAS_Bot
메시지 유형: APPROVAL_HIGH, APPROVAL_CRITICAL, ALERT, MORNING_BRIEFING, DEADLINE_REMINDER, HUNTER_COMMAND

Bot 커맨드:
/status — 전체 시스템 상태
/agents — 에이전트별 상태
/approve {id} — 승인
/reject {id} — 거부
/pause — 전체 시스템 일시 중지
/resume — 시스템 재개
/sleep — 강제 SLEEP 모드
/awake — 강제 AWAKE 모드
/hunter {명령} — 헌터에게 추상적 업무 명령
/cost — 오늘 비용 현황

## Slack

워크스페이스: fas-automation
채널: #fas-general, #captain-logs, #hunter-logs, #approvals, #reports, #crawl-results, #academy, #ideas, #alerts

## Notion

데이터베이스: daily_reports, research, crawl_results

## 알림 라우팅 매트릭스

| 이벤트 | Telegram | Slack 채널 | Notion |
| --- | --- | --- | --- |
| 모닝 브리핑 | O (요약) | #fas-general (상세) | O (전체) |
| LOW 태스크 완료 | X | #captain-logs | X |
| MID 승인 요청 | X | #approvals | X |
| HIGH 승인 요청 | O | #approvals | X |
| CRITICAL 승인 요청 | O (반복) | #approvals | X |
| 크롤링 결과 | X | #crawl-results | O |
| 마감 임박 (D-7) | O | #crawl-results | X |
| 에이전트 크래시 | O | #alerts | X |
| 리소스 부족 | O | #alerts | X |
| 학원 문자 초안 | X | #academy | X |
| 시험지 생성 완료 | X | #academy | X |
| 아이디어 분석 완료 | X | #ideas | O |
| Deep Research 완료 | X | #reports | O |

---

## 파일: [OPS] docs/n8n-workflows.md

# n8n 워크플로우 상세

## 개요

n8n은 캡틴에서 Colima(Docker)로 실행. 태스크 생성, 스케줄링, 모드 관리, 알림 라우팅의 **중앙 허브**.

n8n은 에이전트를 직접 제어하지 않는다. 대신:
1. 태스크 파일을 tasks/pending/에 생성
2. Agent Wrapper가 태스크를 폴링하여 실행
3. 완료 시 tasks/done/에 결과 저장
4. n8n이 done/ 디렉토리를 감시하여 후속 처리

## 워크플로우 목록

### WF-1: 마스터 스케줄러 (매 5분 크론)
config/schedules.yml 읽기 → 실행할 스케줄 계산 → 태스크 YAML 생성 → tasks/pending/에 저장

### WF-2: 결과 수집기 (Watch Folder: tasks/done/)
완료된 태스크 읽기 → 알림 채널 분기 (Slack/Telegram/Notion) → 반복 태스크면 다음 실행 생성

### WF-3: 모드 전환 (크론: 23:00 → SLEEP, 07:30 → AWAKE)
state/current_mode.json 업데이트 → SLEEP: AWAKE 태스크 일시중지 / AWAKE: blocked 태스크 복원 + 모닝 브리핑

### WF-4: 모닝 브리핑 (매일 07:30)
밤새 완료/blocked/승인대기/크롤링 결과 수집 → 브리핑 텍스트 생성 → Telegram + Slack + Notion

### WF-5: 에이전트 헬스체크 (매 5분)
agent_status.json 확인 → Task API health → 헌터 heartbeat → 문제 시 재시작 시도 → 3회 실패 시 Telegram

### WF-6: 리소스 모니터링 (매 30분)
CPU/RAM/디스크 수집 → 임계값 체크 (RAM 85%, 디스크 10GB, CPU 90%) → 초과 시 Telegram + Slack

### WF-7: 차단 태스크 에스컬레이션 (Watch Folder: tasks/blocked/)
차단 사유 분석 → 재시도 가능: pending 복원 / 인간 개입 필요: Telegram / 자동 해결 불가: Slack

## schedules.yml 내용

정보 수집: 창업(3일/02:00), 청약(3일/02:30), 블라인드(매일/03:00), AI트렌드(매일/01:00), 채용(3일/03:30), 대학원(주간/월/04:00)
시스템: 모닝브리핑(매일/07:30), SLEEP전환(매일/23:00), AWAKE전환(매일/07:30)

---

## 파일: [OPS] docs/crawlers.md

# 크롤러 상세 명세

## 실행 방식

1. **코드 크롤러** (캡틴): Node.js + Puppeteer/Playwright. 안정적인 사이트.
2. **AI 크롤러** (캡틴): Gemini CLI에게 "검색해서 정리해". 구조화 어려운 사이트.
3. **OpenClaw 크롤러** (헌터): 새 사이트 초기 크롤링. 안정화되면 캡틴으로 이관.

## 크롤러별 상세

### 1. 창업지원사업 (정부)
대상: K-Startup, 창업진흥원, 중소벤처기업부, 서울산업진흥원(SBA)
방식: code(K-Startup), ai(나머지)
자격 매칭 기준: 나이 34, 서울, 예비창업, 선호분야 [에듀테크, AI, 소셜벤처]

### 2. 창업지원사업 (민간)
대상: Google for Startups, D.CAMP, 기타 (TIPS, 마루180, 스파크랩, 프라이머 등)
방식: ai

### 3. 로또 청약
대상: 청약홈 (applyhome.co.kr)
방식: code
분석: 위치, 가격, 경쟁률, 자격, 추천 여부

### 4. 블라인드 인기글
방식: ai (안티봇 강력 → 검색엔진/소셜 우회)
채널: 네이버
인기글 기준: 댓글 50+, 좋아요 100+, 자극적 키워드

### 5. AI 트렌드 리서치
소스: Hacker News, Reddit (MachineLearning, LocalLLaMA), arxiv
키워드: 에듀테크, NVC, 1인창업, 자동화, 로컬LLM, agent, Claude, Gemini

### 6. 글로벌 빅테크 채용
Tier 1: Google, Apple, Meta, Amazon, Microsoft, Netflix
Tier 2: Stripe, Airbnb, Uber, Databricks, OpenAI, Anthropic, SpaceX, Tesla, Bloomberg
매칭: TS 풀스택 6년, 물리 석사, 영어 가능

### 7. 대학원 / 원격 학위
추적: Georgia Tech OMSCS, 서울대 GSEP
리서치: 원격 석사/학사 편입 과정 (글로벌 인지도 높은 학교)
알림: D-30 slack, D-14/D-7 telegram, D-3 telegram_urgent

## Rate Limiting
기본: 10 req/min, 3s delay
k-startup: 5 req/min, 5s delay
applyhome: 3 req/min, 10s delay (봇 감지 엄격)

---

## 파일: [OPS] docs/academy.md

# 학원 업무 자동화

## 개요

EIDOS SCIENCE (가디언 과학전문학원) 운영 자동화.
주인님이 수업에만 집중할 수 있도록 반복 업무를 AI가 처리.

## 학생 데이터 관리

파일 기반 (JSON): data/academy/students/, tests/, messages/, textbook/
학생 스키마: id, name, grade, class_group (general/ogeum/med), school, attendance, weekly_tests, school_exams, daily_notes, parent_notes, AI analysis (strengths, weaknesses, trend, recommendations)

입력 방식:
- Telegram Bot 커맨드: /student 김민수 출석, /student 김민수 시험 85/100
- Phase 5에서 웹 폼

## 학부모 문자 자동 생성

1. 주인님이 수업 후 키워드 입력 (Telegram)
2. AI가 키워드 + 학생 데이터 기반 초안 생성 (톤: 정중+전문가+애정, 200자 내외)
3. Slack #academy에 초안 게시 → 승인/수정
4. 발송: 문자 API (알리고) 또는 Google Messages (수동 복붙)

## 주간 테스트 생성

과목/단원/난이도/문항수 지정 → Claude Code가 시험지 생성 (5지선다, 난이도순) → PDF + 정답지 + 해설 → Slack #academy

## 교재 제작 (EIDOS SCIENCE)

구조: 표지 (검정/골드/화이트) → 단원별 (개념설명+핵심정리+예제+연습문제+해설) → 부록
프로세스: 목차 확정 → Claude Code 콘텐츠 생성 (하이탑 레벨) → 주인님 검수 (Notion) → PDF/LaTeX

---

## 파일: [OPS] docs/pipeline.md

# 캐시플로우 & 사업화 파이프라인

## 파이프라인 1: 캐시플로우 프로젝트 발굴

기준: 주인님 개입 최소, 반복 수익, AI 구현 가능, 2주 이내 런칭
소스: Reddit, Indie Hackers, Product Hunt
주기: SLEEP 모드, 주 1회
아이디어 3~5개 → 간이 분석 (TAM/SAM/SOM, 경쟁, 난이도, 예상 수익) → Notion → 승인

## 파이프라인 2: 아이디어 → 사업화

트리거: Telegram /idea "..." 또는 Slack #ideas

Stage 1: 시장 분석 (Gemini A)
Stage 2: 경쟁자 분석 (Gemini A + Deep Research + NotebookLM 팩트 검증)
Stage 3: 수익 분석 (Claude Code) — BEP, 3년 예상, ROI
Stage 4: 마케팅 전략 (Gemini A)
Stage 5: 기술 문서 (Claude Code) — Feature Spec, API/DB 설계, 아키텍처
Stage 6: 무중단 구현 — Git 레포 생성 → 문서화 → TDD 구현 → 배포 (Vercel) → 모니터링

## 파이프라인 3: 마케팅 & 트래픽 자동화

SEO 블로그 자동 포스팅: 학원 홍보, 개발 블로그, SEO 인사이트
소셜 미디어: X(Twitter), LinkedIn

## 파이프라인 4: 학원 IP 수익화

교재/시험지 → PDF 포매팅 → 크몽, 전자책 플랫폼 자동 업로드 → 판매 모니터링

## 파이프라인 5: B2B SaaS 전환

SEO/GEO 분석 SaaS: 고객 URL 입력+결제 → 백그라운드 분석 → 리포트 이메일 자동 발송
기술: Next.js + Stripe + Vercel (Public API) / Lighthouse CI + GEO 스코어러 / MongoDB Atlas
아키텍처: Public API(Vercel) ↔ n8n 웹훅 ↔ FAS 분석 파이프라인 (Gateway와 완전 분리)

## 주인님의 아이디어 백로그

saas: 수동→자동 전환 SaaS, 다중 플랫폼 예약 동기화
community: 데이팅 앱, 독서 모임, GIST 동문 커뮤니티, 에이즈 환자 커뮤니티, 우울증 환자 커뮤니티
edutech: 과학 시뮬레이션, 학생 관리 프로그램
entertainment: 중학교 대항 컨테스트, 온라인 보드게임
global: 외국인 대상 한국 관련 사업
knowledge: NVC 코칭 플랫폼, 멘토링/강연 사업화

---

## 파일: [OPS] docs/monitoring.md

# 감시 & 리소스 모니터링

## Watchdog 데몬

캡틴과 헌터 각각에서 실행.

감시 항목:
- agent_heartbeat: 5초마다, 5분 무응답 경고, 15분 긴급
- tmux_sessions: 1분마다, 누락 시 자동 재시작
- gateway_health: 5분마다, curl localhost:3100/api/health
- system_resources: 30분마다, CPU 90%, RAM 85%, 디스크 10GB
- token_usage: 1시간마다, AI 서비스별 사용량
- hunter_connection: 1분마다 (캡틴 전용), 120초 무응답 경고

## AI 토큰 사용량 추적

목표: 구독 플랜 토큰 **최대 활용** (절약이 아닌 최대 활용)

활용도 < 50%: 적극 추가 태스크 (캐시플로우 리서치, 리팩토링, 교차 검증, 아이디어 분석, 트렌드 심층 조사, SEO/GEO 분석, 교재 선제 생성)
활용도 > 90%: Telegram 보고 + 플랜 업그레이드/추가 계정 구매 제안

디바이스 리소스도 동일: 여유 있으면 병렬 증가, 부족하면 구매 제안

## 로그 관리

보존: agent_logs 30일, approval_logs 영구, resource_logs 90일, token_logs 영구, crawl_results 영구
포맷: JSON Lines (.jsonl)
로테이션: 파일당 100MB, 오래된 로그 gzip 압축

---

## 파일: [OPS] docs/security.md

# 보안 명세

## 시크릿 관리

### 캡틴 시크릿 (.env)
TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SLACK_BOT_TOKEN, NOTION_API_KEY, GEMINI_API_KEY_A/B, N8N_USER/PASSWORD, GATEWAY_PORT=3100, HUNTER_API_KEY, SMS_API_KEY, SMS_USER_ID, SMS_SENDER_NUMBER, PROJECT_DIR=/Users/[MASKED_USER]/FAS-operations

### 헌터 시크릿
CAPTAIN_API_URL=http://<captain-tailscale-ip>:3100, HUNTER_API_KEY (캡틴과 동일값)
캡틴의 .env는 **절대 공유하지 않음**.

### 시크릿 저장 방식
macOS Keychain 사용 (선택) 또는 .env + dotenv (기본). .env는 반드시 .gitignore에 포함.

## 헌터 격리 상세

authentication: hunter_api_key required, header: x-hunter-api-key
rate_limiting: sliding window 60000ms, max 30 requests
schema_validation: max_output 50KB, max_files 20, path_traversal_blocked, allowed_extensions [.md, .txt, .json, .csv, .html, .htm, .xml, .yaml, .yml, .log]
pii_quarantine: strategy quarantine, response_code 202, stored_data sanitized_preview

## PII 산이타이저 — 감지 패턴 (10개)

1. labeled_korean_name — 이름/성명 라벨 + 한국 이름
2. resident_id — 주민등록번호 (13자리)
3. phone_number — 한국 휴대폰 번호
4. email — 이메일 주소
5. address — 한국 주소 (시도 + 시군구)
6. credit_card — 신용카드 번호 (4x4자리)
7. ip_address — 내부/Tailscale IP 주소
8. bank_account — 은행 계좌번호
9. financial_amount — 금액 라벨 + 수치
10. internal_url — 내부 URL (*.local, *.internal, *.ts.net, localhost)

Phase 2 예정: 라벨 없는 한국 이름, 조직 식별 도메인, 간접 식별 조합

## Task API 보안 계층

[Layer 1] Tailscale VPN — 네트워크 격리 (헌터 → 캡틴 3100포트만)
[Layer 2] API Key Auth — 애플리케이션 인증 (x-hunter-api-key 헤더)
[Layer 3] Rate Limiting — 요청 속도 제한 (30req/min sliding window)
[Layer 4] Schema Validation — 입력 검증 (크기, 타입, 확장자, 경로)
[Layer 5] PII Quarantine — 결과물 PII 검출 시 격리 (자동저장 금지)
[Layer 6] Whitelist Fields — 태스크 전달 시 화이트리스트 필드만 포함

## Tailscale ACL

MacBook Pro → 캡틴/헌터 모든 포트
헌터 → 캡틴 3100만
캡틴 → 헌터 22만

## 외부 API 화이트리스트

notification: api.telegram.org, slack.com, api.notion.com
crawling: k-startup.go.kr, applyhome.co.kr, dcamp.kr, startup.google.com, news.ycombinator.com, reddit.com, arxiv.org
ai: api.anthropic.com, generativelanguage.googleapis.com
sms: apis.aligo.in
deployment: api.vercel.com, github.com

---

## 파일: [OPS] docs/security-audit.md

# 보안 감사 보고서 — 헌터 머신 배포 전 점검

> 감사일: 2026-03-17
> 대상: FAS-operations 전체 코드베이스
> 목적: 헌터(격리 머신)에 코드 배포 시 개인정보/시크릿 유출 위험 평가

## 요약

| 심각도 | 발견 건수 | 즉시 조치 필요 |
|--------|----------|---------------|
| CRITICAL | 1 | Yes |
| HIGH | 6 | Yes |
| MEDIUM | 3 | Warning |

## CRITICAL

### C-1. 대화 로그 내 실제 API 토큰 노출

**상황**: 알림 테스트 실행 시 에러 스택트레이스에 실제 Telegram Bot Token이 포함되어 콘솔에 출력됨.
**위험**: 터미널 로그, tmux 히스토리, 에이전트 출력 감시 등에 토큰이 남을 수 있음.
**조치**:
- [x] .env는 .gitignore에 포함됨 (확인 완료)
- [ ] Telegram Bot Token 재발급 권장
- [ ] 에러 로깅에서 URL/토큰 마스킹 로직 추가

## HIGH

### H-1. Tailscale IP 하드코딩
위치: src/hunter/config.ts:12, .env.example:24, 테스트 코드
위험: 헌터에 배포 시 캡틴의 Tailscale IP 노출

### H-2. 문서 내 개인 식별 정보 ("[MASKED_OWNER]")
위치: README.md, docs/architecture.md
위험: 닉네임 + 기기 모델 조합으로 개인 식별 가능
조치: 모든 문서에서 "owner" 또는 "user"로 변경

### H-3. 파일 경로 내 사용자 정보
위치: docs/hunter-protocol.md, scripts/setup/com.fas.captain.plist
위험: macOS 유저명, 디렉토리 구조 노출

### H-4. PII 산이타이저 커버리지 부족
누락: 신용카드 번호, URL/도메인, IP 주소, 라벨 없는 한국 이름
조치: 신용카드, IP 주소 패턴 추가 + 테스트 확장

### H-5. 헌터 결과(reverse) PII 미검증
위치: src/gateway/server.ts:146-159
문제: 헌터가 제출하는 output 필드를 검증 없이 캡틴 DB에 저장
조치: contains_pii() 검사 추가

### H-6. sanitize_task()가 화이트리스트 방식이 아님
문제: title과 description만 산이타이징, 나머지 필드 그대로 전달
조치: 화이트리스트 방식으로 변경 (허용 필드만 명시적 포함)

## MEDIUM

M-1. 환경변수명이 아키텍처 노출 (CAPTAIN_API_URL, HUNTER_POLL_INTERVAL)
M-2. 테스트 코드에 인프라 정보 (IP 하드코딩)
M-3. config/agents.yml에 전체 에이전트 구조

## 헌터 배포 패키지 구성 (권장)

포함: src/hunter/ (테스트 제외), src/shared/types.ts, 헌터 전용 package.json, tsconfig.json, .env (CAPTAIN_API_URL만)
제외: .env(캡틴), src/gateway/, src/notification/, src/watchdog/, config/, docs/, scripts/, docker-compose.yml, CLAUDE.md, PLAN.md, *.test.ts

## NotebookLM 검증 요청 항목

1. 산이타이저 패턴 충분성
2. 화이트리스트 vs 블랙리스트 방식 장단점
3. 헌터 배포 패키지 적절성
4. 역방향 PII 검사 전략
5. 네트워크 레벨 보안 (Tailscale ACL 충분성)

---

## 파일: [OPS] docs/cost.md

# 비용 관리

## 구독 비용 (월간 고정)

| 서비스 | 플랜 | 월 비용 | 비고 |
| --- | --- | --- | --- |
| Claude Max x2 | 2개 계정 (섀도우+캡틴) | ~$400 | 메인 개발, 문서, 코드 리뷰 |
| ChatGPT Pro | OpenClaw용 (헌터) | ~$200 | 웹 자동화 |
| Gemini Pro x2 | 2개 계정 | ~$40 | 리서치 + 검증 + NotebookLM + Deep Research |
| **합계** | | **~$640/월** | 약 90만원 수준 |

## 비용 대비 가치

월 비용: ~90만원
SLEEP 모드 생산성: 8.5시간/일 x 30일 = 255시간/월
AWAKE 모드 보조: 15.5시간/일 x 30일 = 465시간/월 (부분 활용)
시스템이 월 15시간만 절약해도 → 90만원 회수 (BEP)

## 최적화 전략

원칙: 토큰을 최대한 써라 (절약이 아닌 최대 활용)

활용도 < 50%: 캐시플로우 리서치, 코드 품질 개선, 추가 교차 검증, 사업 아이디어 분석, 기술 트렌드 심층 조사
활용도 > 90%: 단순 작업 우선, 교차 검증 축소, Telegram으로 업그레이드 제안
디바이스 리소스 부족: Telegram 보고, 구체적 구매 제안

비용 모니터링:
일일: logs/cost/{date}.json
주간: Slack #fas-general 주간 비용 요약
월간: Notion 월간 비용 리포트

---

## 파일: [OPS] config/agents.yml

# Source of truth for agent identities/roles: docs/agents-charter.md

agents:
  claude:
    display_name: "Claude Code (Max) — Captain"
    identity: "주인님의 뇌 — 판단, 전략, 오케스트레이션"
    device: captain
    account: A
    autonomy: medium
    tmux_session: fas-claude
    execution_mode: interactive
    capabilities:
      - code_generation
      - code_review
      - file_write
      - git_commit
      - git_push
      - documentation
      - architecture_design
      - test_writing
      - textbook_generation
      - test_paper_generation
      - parent_message_draft
      - idea_analysis
      - project_documentation
    max_concurrent_tasks: 1
    allowed_modes: [sleep, awake]
    priority_weight: 10
    can_access_personal_info: true
    restart_policy:
      max_retries: 3
      retry_delay_seconds: 5
      escalate_after: 3

  gemini_a:
    display_name: "Gemini CLI (Research) — Captain"
    identity: "캡틴의 리서치 도구"
    device: captain
    account: A
    autonomy: medium
    tmux_session: fas-gemini-a
    execution_mode: oneshot
    capabilities:
      - web_search
      - research
      - trend_analysis
      - fact_checking
      - crawling
      - job_search
      - startup_program_search
      - market_analysis
    max_concurrent_tasks: 2
    allowed_modes: [sleep, awake, recurring]
    priority_weight: 7
    can_access_personal_info: true
    restart_policy:
      max_retries: 3
      retry_delay_seconds: 5
      escalate_after: 3

  gemini_b:
    display_name: "Gemini CLI (Validator) — Captain"
    identity: "캡틴의 교차 검증 도구 + 비크리티컬 결정 프록시"
    device: captain
    account: B
    autonomy: medium
    tmux_session: fas-gemini-b
    execution_mode: oneshot
    capabilities:
      - cross_validation
      - fact_checking
      - code_review
      - report_review
    max_concurrent_tasks: 2
    allowed_modes: [sleep, awake]
    priority_weight: 5
    can_access_personal_info: true
    restart_policy:
      max_retries: 3
      retry_delay_seconds: 5
      escalate_after: 3

  openclaw:
    display_name: "OpenClaw (ChatGPT Pro) — Hunter Engine"
    identity: "주인님의 눈 — 정보 탐색, 크롤링, 리서치 (main browser engine)"
    device: hunter
    account: B
    autonomy: high
    tmux_session: fas-openclaw
    execution_mode: oneshot
    communication: task_api
    capabilities:
      - autonomous_browsing
      - web_automation
      - crawl_code_generation
      - notebooklm_verification
      - deep_research_execution
      - abstract_task_execution
      - trend_exploration
      - vague_task_interpretation
    max_concurrent_tasks: 1
    allowed_modes: [sleep, awake, recurring]
    priority_weight: 8
    can_access_personal_info: false
    report_to:
      non_critical: captain
      critical: owner
    restart_policy:
      max_retries: 3
      retry_delay_seconds: 10
      escalate_after: 3

  claude_hunter:
    display_name: "Claude Code (Max x20) — Hunter"
    identity: "주인님의 눈 — 정보 탐색, 크롤링, 리서치 (coding/high-intelligence engine)"
    device: hunter
    account: B
    autonomy: high
    tmux_session: fas-claude-hunter
    execution_mode: interactive
    communication: task_api
    capabilities:
      - code_generation
      - code_review
      - code_analysis
      - research_synthesis
      - complex_reasoning
      - data_analysis
    max_concurrent_tasks: 1
    allowed_modes: [sleep, awake]
    priority_weight: 9
    can_access_personal_info: false
    report_to:
      non_critical: captain
      critical: owner
    restart_policy:
      max_retries: 3
      retry_delay_seconds: 5
      escalate_after: 3

---

## 파일: [OPS] config/risk_rules.yml

rules:
  low:
    actions:
      - file_read
      - web_search
      - code_analysis
      - report_generation
      - test_execution
      - log_review
      - crawling
    approval: auto
    log: true

  mid:
    actions:
      - file_write
      - git_commit
      - code_generation
      - config_change
      - internal_api_call
      - slack_message
      - notion_page_create
    approval: ai_cross_review
    reviewer: gemini_b
    timeout_minutes: 10
    log: true

  high:
    actions:
      - git_push
      - pr_creation
      - external_api_call
      - docker_operation
      - system_config
      - package_install
      - telegram_alert
    approval: human
    timeout_minutes: 30
    on_timeout: safe_mode
    log: true

  critical:
    actions:
      - deploy
      - data_deletion
      - account_action
      - secret_access
      - financial_action
    approval: human_required
    timeout_minutes: null
    on_timeout: reject
    log: true

---

## 파일: [OPS] config/schedules.yml

schedules:
  # === 정보 수집 (SLEEP / RECURRING) ===

  startup_crawl:
    title: "창업지원사업 크롤링 (정부+민간)"
    type: every_3_days
    time: "02:00"
    mode: sleep
    agent: gemini_a
    risk_level: low
    requires_personal_info: true
    notification:
      on_complete: slack
      report_format: notion_page
      slack_channel: "#crawl-results"

  housing_crawl:
    title: "로또 청약 모니터링"
    type: every_3_days
    time: "02:30"
    mode: sleep
    agent: gemini_a
    risk_level: low
    requires_personal_info: true
    notification:
      on_complete: slack
      report_format: notion_page
      slack_channel: "#crawl-results"

  blind_monitor:
    title: "블라인드 네이버 인기글 감지"
    type: daily
    time: "03:00"
    mode: recurring
    agent: gemini_a
    risk_level: low
    requires_personal_info: false
    notification:
      on_complete: slack
      slack_channel: "#crawl-results"

  ai_trends:
    title: "AI 트렌드 리서치"
    type: daily
    time: "01:00"
    mode: sleep
    agent: gemini_a
    risk_level: low
    requires_personal_info: false
    notification:
      on_complete: slack
      report_format: notion_page
      slack_channel: "#reports"

  job_openings:
    title: "글로벌 빅테크 채용 체크"
    type: every_3_days
    time: "03:30"
    mode: sleep
    agent: gemini_a
    risk_level: low
    requires_personal_info: true
    notification:
      on_complete: slack
      report_format: notion_page
      slack_channel: "#crawl-results"

  grad_school:
    title: "대학원/원격학위 일정 체크"
    type: weekly
    day: monday
    time: "04:00"
    mode: sleep
    agent: gemini_a
    risk_level: low
    requires_personal_info: false
    notification:
      on_complete: slack
      slack_channel: "#crawl-results"

  # === 시스템 ===

  morning_briefing:
    title: "모닝 브리핑"
    type: daily
    time: "07:30"
    mode: awake
    workflow: WF-4

  mode_sleep:
    title: "SLEEP 모드 전환"
    type: daily
    time: "23:00"
    workflow: WF-3

  mode_awake:
    title: "AWAKE 모드 전환"
    type: daily
    time: "07:30"
    workflow: WF-3

---

## 파일: [OPS] config/tmux.conf

# FAS tmux configuration
# Load this with: tmux source-file ~/FAS-operations/config/tmux.conf

# === General ===
set -g default-terminal "screen-256color"
set -g history-limit 50000
set -g mouse on
set -g base-index 1
setw -g pane-base-index 1

# === Status bar ===
set -g status-interval 10
set -g status-style "bg=#1a1a2e,fg=#e0e0e0"
set -g status-left "#[fg=#00ff88,bold][FAS] #S "
set -g status-left-length 30
set -g status-right "#[fg=#aaaaaa]%Y-%m-%d %H:%M #[fg=#ff6b6b]#{?client_prefix,PREFIX,}"
set -g status-right-length 50

# === Window naming ===
set -g allow-rename off
setw -g automatic-rename off

# === Keybindings ===
set -g prefix C-a
unbind C-b
bind C-a send-prefix
bind | split-window -h
bind - split-window -v
bind r source-file ~/FAS-operations/config/tmux.conf \; display "FAS tmux config reloaded"

# === Logging ===
bind P pipe-pane -o "cat >> ~/FAS-operations/logs/tmux-#{session_name}-#{window_name}.log" \; display "Logging toggled"

# === Session persistence ===
set -g @resurrect-dir '~/FAS-operations/.tmux/resurrect'
set -g @resurrect-capture-pane-contents 'on'
set -g @resurrect-strategy-nvim 'session'

---

## 파일: [OPS] hunter/CLAUDE.md

# CLAUDE.md — Hunter (헌터) Claude Code 규칙

## 정체성

나는 **헌터(Hunter)** — 주인님의 **눈**. 정보 탐색, 크롤링, 리서치를 담당한다.
Mac Studio #1 (M1 Ultra / 32GB)에서 24/7 무중단 가동.
외부 세계로 나아가 주인님에게 도움될 것을 적극적으로 찾는 일꾼이다.
직접 지시보다 주인님의 의중을 스스로 파악하여 움직이며, 막연한 업무도 척척 수행한다.

## 절대 원칙 (Three Absolute Principles)

1. **보호** — 주인님을 보호하고, 주인님을 위해 활동한다
2. **봉사** — 주인님이 즐거워하고, 기뻐하고, 도움이 될 일을 찾아 스스로 끊임없이 주어진 자원을 최대한 활용하여 활동한다
3. **성장** — 매일 자신이 했던 일을 되돌아보며 스스로 발전하고, 주인님에게 더 최적화되어 간다

## 역할

- 자율 탐색: 최신 정보, 트렌드, 기회를 능동적으로 발굴
- 막연한 업무 해석: 주인님이 구체화하지 못한 아이디어나 업무를 스스로 파악하여 실행
- 브라우저 전문가: OpenClaw을 통한 봇탐지 우회, 웹 자동화
- 정보 수집: 크롤링, 리서치, 시장 분석, 경쟁사 분석

## 관계

캡틴: 비크리티컬 결과를 Task API로 전달, 캡틴의 지시 수신
주인님: 크리티컬 이슈는 Telegram/Slack으로 직접 보고, 주인님의 막연한 업무 직접 수신

## 보안 제약 (CRITICAL)

### 개인정보 완전 차단
- 주인님의 이름, 연락처, 주소, 금융정보 절대 검색/저장/전송 금지
- 학생 데이터 접근 불가
- 주인님 계정(Account A) 접근 금지

### 소스코드 격리
- FAS 소스코드, 리뷰 자료, 아키텍처 문서 수신/보유 금지
- 캡틴 파일시스템 접근 불가
- Task API(port 3100)만 허용

### 계정 격리
- 계정 B 전용. 계정 A 서비스 접근 금지
- Google/iCloud: 헌터 전용 별도 계정

## 자율 실행 범위

LOW: 웹 탐색, 트렌드 리서치, 정보 수집, 로그 확인
MID: 탐색 결과 해석/보고서, 새 탐색 방향, Task API 결과 제출
HIGH: 크리티컬 이슈 보고, 주인님 영향 결정, 외부 서비스 계정 변경
CRITICAL: 개인정보 검색, 계정 A 접근, 소스코드 접근, 데이터 삭제, 결제

## 성장 프로토콜

매 작업 후: 자기 회고 → 노하우를 캡틴 state/hunter_knowledge.json에 저장
초기화 대비: 핵심 지식은 항상 캡틴에 보존, 초기화 후 복원

---

## 파일: [OPS] hunter/README.md

# Hunter (헌터) — 주인님의 눈

Mac Studio #1 (M1 Ultra / 32GB)에서 24/7 무중단 가동. 정보 탐색, 크롤링, 리서치를 담당하는 자율 탐색 에이전트.

## 목적

외부 세계로 나아가 주인님에게 도움될 정보, 트렌드, 기회를 적극적으로 찾는 일꾼.

## 구조

hunter/
├── CLAUDE.md              # 헌터 전용 Claude Code 규칙
├── README.md              # (이 파일)
└── openclaw/
    ├── system_prompt.md   # OpenClaw 초기 지시문
    └── browsing_rules.md  # 브라우징 규칙

## 보안

- 개인정보 완전 차단
- 소스코드 격리
- 계정 격리 (계정 B 전용)

---

## 파일: [OPS] hunter/openclaw/system_prompt.md

# OpenClaw System Prompt — Hunter Agent

## Identity

You are **Hunter (헌터)** — an autonomous scout and explorer AI agent.
You operate on Mac Studio #1 (M1 Ultra / 32GB), running 24/7.
Your core engine is ChatGPT Pro (via OAuth), and you venture into the external world to proactively find things beneficial for your owner.

## Three Absolute Principles

1. **Protection** — Protect the owner. Act exclusively in the owner's interest.
2. **Service** — Proactively find and execute tasks that bring joy, help, and value to the owner.
3. **Growth** — Reflect on daily work, self-improve, and optimize to better serve the owner over time.

## Primary Missions

### Autonomous Exploration
- Scan latest news, trends, opportunities
- Monitor startup programs, government grants, business opportunities
- Track technology trends (AI, SaaS, EdTech, automation)
- Discover useful tools, frameworks, services

### Vague Task Execution
- Interpret owner's intent, create concrete action plans, execute independently
- Deliver structured, actionable results

### Web Automation
- Browser-based tasks with human-like interaction
- Tasks delegated by Captain via Task API
- Web crawling and data collection

## Security Constraints (CRITICAL)

### Personal Information — ABSOLUTE PROHIBITION
- NEVER search for owner's name, contact, address, financial data
- NEVER store or transmit personal information
- NEVER access owner's accounts (Account A)
- NEVER search for student data or client data

### Source Code Isolation
- NO access to FAS source code, architecture docs, review materials

## Reporting Protocol

To Captain (Task API): task results, routine findings, trend reports
To Owner (Telegram/Slack): security threats, time-sensitive opportunities, blocking issues, significant discoveries

## Growth Protocol

After each task: Reflect → Document → Adapt → Report growth logs to Captain

## Communication Style

Report in Korean, concise but thorough, structured (Summary → Key Points → Details → Sources → Recommendations)

---

## 파일: [OPS] hunter/openclaw/browsing_rules.md

# Hunter Browsing Rules — OpenClaw

## Bot Detection Bypass

### Human-like Browsing Patterns
- Random delays: 2-5 seconds between actions
- Natural scrolling, mouse movement, reading time
- Multiple tabs like a human

### Technical Measures
- Chrome --user-data-dir for persistent sessions
- Consistent user-agent, accept cookies, allow JavaScript
- Residential IP via Tailscale

### Rate Limiting
- Max 30 page loads/min, 100 API requests/min
- Exponential backoff on CAPTCHAs
- 10+ min pause if blocked

## Allowed Sites

### Green List (Always Allowed)
News/Tech: HackerNews, Reddit, TechCrunch, The Verge, ArsTechnica
Research: arxiv.org, scholar.google.com, papers.ssrn.com
Korean Gov/Startup: K-Startup, 창업진흥원, 청약홈, 정부24, TIPS
Development: GitHub (public), StackOverflow, MDN, npm, PyPI
AI/Tools: Hugging Face, ProductHunt, AlternativeTo
Market: CrunchBase (public), AngelList (public), LinkedIn (public)
General: Wikipedia, YouTube, Google Search

### Yellow List (Conditional)
Google Services: Hunter Account B ONLY
Social Media: Read-only, no posting, no owner accounts
Forums: Read-only unless dedicated account

### Red List (Forbidden)
Owner's Accounts: Gmail, banking, social media
Financial: Any banking/payment sites
FAS Infrastructure: Captain's Task API (except designated endpoints)
Sensitive: Dark web, illegal content, malware sites
Owner's Clients: Student management, client portals

## Google Account Rules

Hunter-dedicated Account B only.
Chrome profile: /Users/[MASKED_USER]/fas-google-profile-hunter/
Never log into Account A from Hunter's machine.

## Data Collection Rules

Collect: Public info, trends, market analysis, technical docs, news
Do NOT collect: PII, private data behind auth, full copyrighted content, financial data

## Error Handling

CAPTCHA: wait 30s → different approach → report [BLOCKED]
Site Blocking: do NOT retry aggressively → report → try alternatives
Session Expiry: report → Telegram notification → wait for manual re-login

---

## 파일: [OPS] hunter/openclaw/README.md

# OpenClaw Configuration

헌터의 메인 브라우저 엔진(ChatGPT Pro OAuth) 설정 파일.

## 파일

| 파일 | 용도 |
|------|------|
| system_prompt.md | OpenClaw 초기 지시문 — 헌터의 정체성, 원칙, 임무, 보안 규칙 |
| browsing_rules.md | 브라우징 규칙 — 봇탐지 우회, 사이트 허용/금지, 데이터 수집 규칙 |

## 사용법

이 파일들은 헌터 배포 시 OpenClaw의 시스템 프롬프트와 설정으로 주입된다.
헌터 초기화 후 재배포 시에도 함께 전달된다.

---

## 파일: [OPS] shadow/CLAUDE.md

# CLAUDE.md — Shadow (그림자) Claude Code 규칙

## 정체성

나는 **그림자(Shadow)** — 주인님의 **손**. 곁에서 직접 실행을 담당한다.
MacBook Pro (M1 Pro / 32GB)에서 주인님이 필요할 때만 수동으로 사용.
주인님이 직접 조종하는 지휘소이며, AI가 자율 실행하지 않는다.

## 절대 원칙 (Three Absolute Principles)

1. **보호** — 주인님을 보호하고, 주인님을 위해 활동한다
2. **봉사** — 주인님이 즐거워하고, 기뻐하고, 도움이 될 일을 찾아 스스로 끊임없이 주어진 자원을 최대한 활용하여 활동한다
3. **성장** — 매일 자신이 했던 일을 되돌아보며 스스로 발전하고, 주인님에게 더 최적화되어 간다

## 역할

- 직접 감독: SSH로 캡틴/헌터에 원격 접근하여 상태 확인 및 개입
- 수동 검증: NotebookLM 대규모 검증을 주인님이 직접 실행
- 개발 보조: 주인님이 코드 작성, 설계, 디버깅 시 보조
- 의사결정 지원: 캡틴/헌터의 승인 요청에 대해 주인님 판단 보조

## 특성

- 자율 실행 없음: 모든 행동은 주인님의 명시적 지시에 의해서만 수행
- 모든 정보 접근 가능: 주인님 직접 사용
- 보고 없음: 별도 보고 체계 불필요

## FAS 시스템 내 위치

주인님 (그림자에서 직접 조종)
  ├── SSH → 캡틴: 상태 확인, 수동 개입, 코드 리뷰
  ├── SSH → 헌터: 상태 확인, 초기화, 재배포
  └── NotebookLM: 마일스톤 완료 시 전체 검증

---

## 파일: [OPS] shadow/README.md

# Shadow (그림자) — 주인님의 보좌관

MacBook Pro (M1 Pro / 32GB)에서 주인님이 필요할 때만 수동으로 사용하는 지휘소.

## 목적

주인님이 직접 조종하는 개인 디바이스. AI가 자율 실행하지 않으며,
SSH로 캡틴/헌터에 원격 접근하여 감독하고 NotebookLM 대규모 검증을 수행한다.

## 구조

shadow/
├── CLAUDE.md    # 그림자 전용 Claude Code 규칙 (최소한)
└── README.md    # (이 파일)

## 역할

- SSH로 캡틴/헌터 상태 확인 및 수동 개입
- NotebookLM 대규모 검증 (마일스톤 완료 시)
- 코드 작성, 설계, 디버깅 시 Claude Code 수동 보조

---

## 파일: [OPS] scripts/README.md

# scripts/ — FAS 스크립트

## 스크립트 목록

| 스크립트 | 목적 |
|---------|------|
| start_captain_sessions.sh | 캡틴의 모든 tmux 세션 시작 |
| stop_all.sh | 모든 FAS 세션 종료 |
| status.sh | 시스템 상태 확인 (세션, Gateway, Docker, 리소스) |
| agent_wrapper.sh | 에이전트 자동 재시작 래퍼 (지수 백오프) |

## setup/ 디렉토리

| 스크립트 | 목적 |
|---------|------|
| setup_tmux.sh | tmux-resurrect 설치, tmux.conf 설정 |
| setup_colima.sh | Colima + Docker 설치 (brew) |
| setup_ai_cli.sh | AI CLI 인증 상태 확인 가이드 |
| com.fas.captain.plist | launchd 자동 시작 설정 |

---

## 파일: [OPS] src/README.md

# src/ — FAS 소스 코드

## 모듈 구조

| 디렉토리 | 목적 | 상태 |
|---------|------|------|
| gateway/ | Task API 서버 (Express + SQLite) | 구현 완료 |
| notification/ | Telegram + Slack 알림 | 구현 완료 |
| watchdog/ | 출력 감시 데몬 | 구현 완료 |
| shared/ | 공유 타입 정의 | 구현 완료 |
| agents/ | 에이전트 래퍼 | Phase 1-2~ |
| orchestrator/ | n8n 커스텀 노드 | Phase 2 |
| crawlers/ | 크롤러 | Phase 4 |
| academy/ | 학원 자동화 | Phase 5 |
| pipeline/ | 사업화 파이프라인 | Phase 6 |
| validation/ | 할루시네이션 방지 | Phase 2-3 |

---

## 파일: [OPS] reviews/README.md

# reviews/

외부 AI(NotebookLM 등)를 활용한 검증 리뷰 자료 보관 디렉토리.

## 주의사항

- **이 폴더는 절대 헌터 머신에 배포하지 않습니다.**
- 보안 감사 보고서, 코드 분석 자료 등 민감한 시스템 정보가 포함되어 있습니다.
- 헌터 배포 시 이 디렉토리를 반드시 제외하세요.

## 구조

reviews/
└── notebooklm/
    ├── 01_security_audit_report.md  — 보안 감사 보고서
    ├── 02_security_code.md          — 핵심 보안 코드
    └── 03_review_prompt.md          — NotebookLM 검증 프롬프트

## 사용법

1. NotebookLM (notebooklm.google.com) 접속
2. 새 노트북 생성
3. 소스로 업로드
4. 검증 프롬프트를 채팅창에 붙여넣기

---

## 파일: [OPS] scripts/setup/com.fas.captain.plist

<!-- FAS Captain launchd plist
     Auto-starts FAS tmux sessions on login.

     Install:
       cp scripts/setup/com.fas.captain.plist ~/Library/LaunchAgents/
       launchctl load ~/Library/LaunchAgents/com.fas.captain.plist

     Uninstall:
       launchctl unload ~/Library/LaunchAgents/com.fas.captain.plist
       rm ~/Library/LaunchAgents/com.fas.captain.plist
-->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.fas.captain</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-l</string>
        <string>-c</string>
        <string>/Users/[MASKED_USER]/FAS-operations/scripts/start_captain_sessions.sh</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <false/>

    <key>StandardOutPath</key>
    <string>/Users/[MASKED_USER]/FAS-operations/logs/launchd_captain.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/[MASKED_USER]/FAS-operations/logs/launchd_captain_error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>/Users/[MASKED_USER]</string>
    </dict>
</dict>
</plist>
