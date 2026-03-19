# FAS Operations

> Fully Automation System의 운영 계층 — Doctrine(원칙/정체성)을 실현하는 코드, 스크립트, 인프라

## 한 줄 요약

2대의 Mac Studio + 다종 AI 모델(Claude, Gemini, OpenClaw)을 조합하여, **사람 개입 최소화**로 24시간 자동 운영되는 멀티 에이전트 시스템.

## Doctrine / Operations 구조

FAS는 두 계층으로 분리된다:

| 계층 | 위치 | 성격 | 변경 빈도 |
|------|------|------|-----------|
| **Doctrine** | `~/Library/Mobile Documents/com~apple~CloudDocs/claude-config/` | 정신, 원칙, 정체성, 보안 설계 — Source of Truth | 낮음 |
| **Operations** | 이 레포 (`~/FAS-operations/`) | Doctrine을 실현하는 코드, 스크립트, 인프라 | 높음 |

> 에이전트 정체성, 톤, 절대원칙의 원천은 Doctrine. 이 레포는 그것을 코드로 구현한다.

## 왜 만드는가

- 평일 07:30~21:00 회사, 주말 10:00~21:00 학원 → **개인 시간 거의 0**
- AI 에이전트가 대신 일해야 프로젝트 진행 가능
- 수면 시간(6~8시간)을 **정보 수집·분석 시간**으로 전환
- 깨어 있는 시간에는 **승인만** 하면 되는 구조

## 시스템 구성 개요

```
┌─────────────────────────────────────────────────────┐
│                    HUMAN (owner)                     │
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
```

## 하드웨어 배치

| 기기          | 칩 / RAM        | 별명                  | 정체성               | 역할                                               |
| ------------- | --------------- | --------------------- | -------------------- | -------------------------------------------------- |
| Mac Studio #2 | M4 Ultra / 36GB | **캡틴(Captain)** 🧠 | 주인님의 뇌          | 판단, 전략, 오케스트레이션 + 메인 워커 (계정 A)     |
| Mac Studio #1 | M1 Ultra / 32GB | **헌터(Hunter)** 👁️  | 주인님의 눈          | 정보 탐색, 크롤링, 리서치 + 자율 탐색 워커 (계정 B) |
| MacBook Pro   | M1 Pro / 32GB   | **그림자(Shadow)** ✍️ | 주인님의 손          | 곁에서 직접 실행 + SSH 감독 (주인님 직접 사용)      |

> 에이전트 체계 상세: [docs/agents-charter.md](docs/agents-charter.md)

## Doctrine ↔ Operations 심링크

로컬 Claude Code 설정 파일들은 독트린(iCloud)으로 심링크되어 Source of Truth를 일원화한다:

| 로컬 경로 | 심링크 대상 (독트린) |
|-----------|---------------------|
| `~/.claude/projects/-Users-user-FAS-operations/memory/` | `green-zone/shared/memory/` |
| `~/.claude/hooks/` | `green-zone/shared/hooks/` |
| `~/.claude/projects/-Users-user-FAS-operations/CLAUDE.md` | `green-zone/captain/CLAUDE.md` |
| `~/.claude/projects/-Users-user-FAS-operations/settings.json` | `green-zone/shared/settings.json` |
| `~/.claude/projects/-Users-user-FAS-operations/settings.local.json` | `green-zone/captain/settings.local.json` |
| `~/.claude/projects/-Users-user-FAS-operations/commands/` | `green-zone/shared/commands/` |

> 모든 경로는 `~/Library/Mobile Documents/com~apple~CloudDocs/claude-config/` 하위.

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
| ~~**Claude Code** (Max x20)~~ | ~~헌터 (계정 B)~~ (제거됨 — 전화번호 인증 필수로 별도 계정 생성 불가) | ~~코딩, 고지능 분석 작업~~ → Gemini CLI로 임시 대체 | — |
| **Gemini CLI** (Pro x2)    | 캡틴                                                 | 리서치, 웹 검색, 교차 검증                    | 구글 생태계, 최신 정보            |
| **OpenClaw** (ChatGPT Pro) | 헌터 (계정 B, Node 22+)                               | 추상적 리서치, 분석, 트렌드 탐색, 웹 자동화   | CLI `openclaw agent -m` 원샷 실행 |
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

## Telegram 명령어

주인님이 Telegram에서 캡틴에게 직접 명령을 보낼 수 있다 (`src/captain/telegram_commands.ts`).

| 명령어 | 설명 |
|--------|------|
| `/hunter <설명>` | 헌터에게 즉시 태스크 생성 및 위임 |
| `/crawl <URL>` | 지정 URL 크롤링 태스크 생성 |
| `/research <주제>` | Gemini 리서치 태스크 생성 |
| `/status` | 현재 시스템 상태 조회 |
| `/tasks` | 진행 중/대기 중 태스크 목록 조회 |
| `/cancel <task_id>` | 태스크 취소 |

## 교차 승인 체계

```
위험도 LOW  → 자동 실행 (파일 읽기, 검색, 정보 수집)
위험도 MID  → AI 교차 승인 (Claude가 작업 → Gemini가 검증 → 자동 승인)
위험도 HIGH → 인간 승인 (금전, 외부 API 호출, git push, 배포)
```

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

### 헌터 운영 (Stage 2)

배포 후 운영 도구:

```bash
# 배포 검증 (5가지 자동 체크)
bash scripts/deploy/verify_hunter.sh

# 헌터 프로세스 감시 (자동 재시작, launchd 연동)
bash scripts/hunter_watchdog.sh

# launchd 등록 (부팅 시 자동 시작)
cp scripts/setup/com.fas.hunter.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.fas.hunter.plist
```

캡틴 heartbeat 모니터 (`src/watchdog/hunter_monitor.ts`): 2분 → Slack WARNING, 5분 → Telegram ALERT, 복구 시 → RECOVERY

**알림 안전장치:**
- Output Watcher crash 알림: threshold 도달 시 1회 + 이후 ~5분 간격 (Telegram rate limit 방지)
- Slack-only 이벤트 실패 시 Telegram 폴백 안 함 (비크리티컬 이벤트 폭주 방지)
- 감시 대상 tmux 세션은 `config/agents.yml`에서 동적 로딩 + 실제 존재하는 세션만 자동 필터링 (`src/shared/agents_config.ts`)
- VNC 자동 복구: 헌터에서 `[LOGIN_REQUIRED]` 감지 시 `scripts/resolve_hunter_login.sh`가 Screen Sharing을 자동으로 열어 수동 로그인 지원

상세: [docs/hunter-protocol.md](docs/hunter-protocol.md) Stage 2 섹션

### 시스템 운영

- 에이전트 헬스체크 & 자동 재시작
- 디바이스 리소스 24시간 최대 활용 (남으면 추가 태스크 배정)
- AI 토큰 사용량 최대 활용 (한도 임박 시 플랜 업그레이드 제안)
- **동적 기회 발견**: 크롤링/리서치 결과를 Gemini로 분석하여 추가 행동 아이템 자동 생성 (야간 SLEEP 모드)
- **Stale task cleanup**: in_progress 30분+ 태스크를 자동 blocked 전환 (5분 간격 체크)
- **PII 2단계 severity**: critical PII(주민번호, 전화번호, 이름) → quarantine / warning PII(주소, 계좌, 이메일) → auto-sanitize 후 통과

## 프로젝트 구조

```
FAS-operations/
├── src/
│   ├── gateway/          # Task API 서버 (Express, SQLite) + 교차 승인
│   ├── captain/          # 자율 활동 엔진 (Planning Loop, Feedback Extractor, Dynamic Discovery, Persona Injector, Telegram Commands)
│   ├── hunter/           # 헌터 에이전트 (Playwright 브라우저 자동화 + Task API 폴링)
│   ├── notification/     # Telegram Bot + Slack 알림 모듈
│   ├── watchdog/         # 출력 감시 데몬 + 헌터 heartbeat 모니터
│   └── shared/           # 공유 타입 정의 + agents.yml 로더
├── scripts/
│   ├── setup/            # 환경 셋업 스크립트 (launchd plist 등)
│   ├── deploy/           # 헌터 배포 (소스코드 격리) + 배포 검증
│   ├── security/         # 보안 스캔 (PII 검사)
│   ├── start_all.sh      # 전체 서비스 5단계 의존관계 기동 (멱등)
│   ├── stop_all.sh       # 전체 서비스 중지
│   ├── status.sh         # 전체 상태 조회
│   ├── start_captain_sessions.sh # (deprecated — use start_all.sh)
│   ├── check_macos_update.sh # macOS 업데이트 감시
│   ├── check_dependencies.sh # 의존성 점검 (pnpm, node, colima 등)
│   ├── gateway_wrapper.sh # Gateway 자동 재시작 래퍼
│   ├── agent_wrapper.sh  # Claude Code 자동 재시작 래퍼
│   ├── hunter_watchdog.sh # 헌터 프로세스 자동 재시작 래퍼
│   └── resolve_hunter_login.sh # VNC 자동 복구 (헌터 로그인 필요 시 Screen Sharing 실행)
├── hunter/               # 헌터 전용 설정 (CLAUDE.md, OpenClaw 설정)
├── shadow/               # 그림자 전용 설정 (CLAUDE.md)
├── config/               # 설정 파일 (agents.yml, tmux.conf 등)
├── docs/                 # 상세 기술 문서
├── tasks/                # 태스크 큐 (pending/in_progress/done/blocked)
├── docker-compose.yml    # n8n (Colima)
├── CLAUDE.md             # AI 자율 실행 규칙
└── PLAN.md               # 구축 계획
```

## start_all.sh — 5단계 의존관계 기동

`scripts/start_all.sh`는 전체 FAS 서비스를 의존 순서에 따라 기동한다:

| Phase | 대상 | 설명 |
|-------|------|------|
| Phase 1 | Colima | Docker 런타임 (n8n 등 컨테이너 의존) |
| Phase 2 | n8n | 오케스트레이션 엔진 |
| Phase 3 | Captain | Gateway + Watcher + Planning Loop |
| Phase 4 | CC sessions | Claude Code / Gemini CLI tmux 세션 |
| Phase 5 | mode + 알림 | SLEEP/AWAKE 모드 판별 + Slack 기동 알림 |

> `start_captain_sessions.sh`는 deprecated — `start_all.sh`를 사용할 것.

## launchd (LaunchAgents) plist 목록

캡틴 머신에 등록된 LaunchAgent plist 파일:

| plist | 용도 | 트리거 |
|-------|------|--------|
| `com.fas.awake.plist` | AWAKE 모드 전환 | 매일 07:30 |
| `com.fas.sleep.plist` | SLEEP 모드 전환 | 매일 23:00 |
| `com.fas.gemini-a.plist` | Gemini CLI 계정 A 세션 | KeepAlive |
| `com.fas.start-all.plist` | 로그인 시 전체 서비스 자동 기동 | RunAtLoad (로그인) |
| `com.fas.update-check.plist` | macOS 업데이트 감시 | 매일 09:00 |
| `com.fas.dep-check.plist` | 의존성 점검 (pnpm, node, colima 등) | 매월 1일 |

**설치 방법:**

```bash
# plist 복사 및 등록
cp scripts/setup/com.fas.start-all.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.fas.start-all.plist

cp scripts/setup/com.fas.update-check.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.fas.update-check.plist

cp scripts/setup/com.fas.dep-check.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.fas.dep-check.plist
```

## 빠른 시작

```bash
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

# 6. 캡틴 통합 시작 (Gateway + Watcher + Planning Loop)
pnpm run captain

# 또는 개별 서비스 시작:
pnpm run gateway    # Gateway만
pnpm run watcher    # Output Watcher만

# 7. (선택) Notion 태스크 백업 설정
# .env에 NOTION_API_KEY, NOTION_TASK_RESULTS_DB 설정 후 재시작

# 8. 헌터 머신 배포 (소스코드 격리 — captain 코드 절대 미전송)
bash scripts/deploy/deploy_hunter.sh hunter

# 9. 전체 서비스 기동
bash scripts/start_all.sh
```

## 모드 전환

```bash
# 수동 모드 전환
pnpm run mode:sleep   # SLEEP 모드 전환 (23:00 자동 전환)
pnpm run mode:awake   # AWAKE 모드 전환 (07:30 자동 전환)

# launchd 자동 전환 설치
cp scripts/setup/com.fas.sleep.plist ~/Library/LaunchAgents/
cp scripts/setup/com.fas.awake.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.fas.sleep.plist
launchctl load ~/Library/LaunchAgents/com.fas.awake.plist
```

## 반복 태스크 스케줄

스케줄 정의 파일: `config/schedules.yml`

| 태스크 | 주기 | 담당 | 시간 | 액션 |
|--------|------|------|------|------|
| 창업지원사업 신규 공고 수집 | 3일 | hunter | 02:00 | `web_crawl` |
| 청약홈 로또 청약 심층 필터링 | 3일 | hunter | 02:30 | `chatgpt_task` |
| 블라인드 네이버 인기글 | 매일 | hunter | 03:00 | `web_crawl` |
| 블라인드 NVC 수요 검증 모니터링 | 매일 | hunter | 03:15 | `chatgpt_task` |
| AI 트렌드 리서치 | 매일 | gemini_a | 01:00 | `research` |
| 글로벌 빅테크 원격 커리어 스캐닝 | 3일 | hunter | 03:30 | `chatgpt_task` |
| 에듀테크 경쟁사 딥 리서치 | 주간 (수) | hunter | 02:00 | `chatgpt_task` |
| 대학원 지원 일정 | 주간 (월) | gemini_a | 04:00 | `research` |

> 상세 구축 순서는 [PLAN.md](./PLAN.md), 기술 명세는 [SPEC.md](./SPEC.md) 참조

## 기술 스택

- **오케스트레이션**: n8n (셀프호스팅, Docker/Colima)
- **에이전트 런타임**: tmux + Claude Code CLI, Gemini CLI, OpenClaw
- **네트워크**: Tailscale (VPN)
- **소통**: Telegram Bot API + Slack + Notion API
- **모니터링**: 커스텀 감시 스크립트 (stdout 감지 → Telegram)
- **검증**: NotebookLM (헌터, 웹 자동화), AI 교차 리뷰
- **브라우저 자동화**: Playwright (Chromium)
- **언어**: TypeScript (최우선) > Python (필요 시) > Bash (최소한)
- **인프라**: Docker/Colima (n8n, 각종 서비스 격리)
