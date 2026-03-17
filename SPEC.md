# SPEC.md — Fully Automation System 기술 명세

## 1. 시스템 아키텍처

### 1.1 전체 구조도

```
                         ┌──────────────────┐
                         │   Human (sunman) │
                         │  Galaxy Watch    │
                         │  Galaxy Fold     │
                         │  MacBook Pro     │
                         └────────┬─────────┘
                                  │
                    ┌─────────────┼──────────────┐
                    │ Telegram    │ Slack         │ Notion
                    │ (긴급알림)  │ (업무소통)     │ (보고서)
                    └─────────────┼──────────────┘
                                  │
                         ┌────────▼─────────┐
                         │  APPROVAL GATEWAY │
                         │  (TypeScript)     │
                         └────────┬─────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
    ┌─────────▼────────┐ ┌───────▼────────┐ ┌────────▼───────┐
    │ 헌터 (Hunter)    │ │ 캡틴 (Captain) │ │  External APIs │
    │ Mac Studio #1    │ │ Mac Studio #2  │ │                │
    │ M1 Ultra / 32GB  │ │ M4 Ultra / 36GB│ │ - Telegram     │
    │                  │ │                │ │ - Slack        │
    │ ┌──────────────┐ │ │ ┌────────────┐ │ │ - Notion       │
    │ │ OpenClaw     │ │ │ │ n8n        │ │ │ - Google       │
    │ │ (ChatGPT Pro)│ │ │ │ (Colima)   │ │ │ - Crawlers     │
    │ └──────────────┘ │ │ ├────────────┤ │ └────────────────┘
    │ ┌──────────────┐ │ │ │ Claude Code│ │
    │ │ NotebookLM   │ │ │ │ (Max)      │ │
    │ │ (웹 자동화)  │ │ │ ├────────────┤ │
    │ ├──────────────┤ │ │ │ Gemini CLI │ │
    │ │ Deep Research│ │ │ │ (Acc A+B)  │ │
    │ │ (웹 자동화)  │ │ │ ├────────────┤ │
    │ └──────────────┘ │ │ │ Approval   │ │
    │                  │ │ │ Gateway    │ │
    │ 별도 구글 계정    │ │ ├────────────┤ │
    │ 별도 iCloud      │ │ │ Task API   │ │
    │ 개인정보 차단     │ │ └────────────┘ │
    └──────────────────┘ └────────────────┘
                                  │
                         ┌────────▼─────────┐
                         │   SHARED STATE    │
                         │   (캡틴 로컬)     │
                         │                   │
                         │ tasks/            │
                         │ state/            │
                         │ reports/          │
                         │ logs/             │
                         │ research/         │
                         └──────────────────┘
```

### 1.2 하드웨어 할당 상세

#### 캡틴 (Mac Studio #2, M4 Ultra / 36GB) — 메인 워커
| 서비스 | 예상 RAM | tmux 세션명 |
|--------|----------|-------------|
| macOS 시스템 | ~5GB | — |
| n8n (Colima/Docker) | ~3GB | `fas-n8n` |
| Claude Code (Max, OAuth) | ~500MB | `fas-claude` |
| Gemini CLI (Account A) | ~500MB | `fas-gemini-a` |
| Gemini CLI (Account B) | ~500MB | `fas-gemini-b` |
| Approval Gateway + Task API | ~300MB | `fas-gateway` |
| 감시 데몬 | ~200MB | `fas-watchdog` |
| **합계** | **~10GB** | |
| **여유** | **~26GB** | 추가 서비스 확장 가능 |

> Claude Code, Gemini CLI는 원격 API 호출 기반 CLI 도구이므로 RAM 사용량이 매우 적다.

#### 헌터 (Mac Studio #1, M1 Ultra / 32GB) — 격리 워커
| 서비스 | 예상 RAM | tmux 세션명 |
|--------|----------|-------------|
| macOS 시스템 | ~5GB | — |
| OpenClaw (ChatGPT Pro) | ~2GB | `fas-openclaw` |
| 감시 데몬 | ~200MB | `fas-watchdog` |
| **합계** | **~7GB** | |
| **여유** | **~25GB** | NotebookLM/Deep Research 브라우저 메모리 포함해도 충분 |

#### MacBook Pro (M1 Pro / 32GB) — 접속 전용
- AI 자동 실행 없음
- SSH로 캡틴/헌터에 접속하여 작업
- Claude Code는 수동 사용만 (지금처럼)

---

## 2. 디렉토리 구조

```
fully-automation-system/
├── README.md
├── PLAN.md
├── SPEC.md
├── CLAUDE.md                     # Claude Code 자율 실행 범위
├── package.json
├── tsconfig.json
├── docker-compose.yml              # n8n (Colima)
│
├── src/
│   ├── orchestrator/               # n8n 커스텀 노드 & 워크플로우
│   │   ├── workflows/
│   │   │   ├── master.json         # 마스터 오케스트레이션
│   │   │   ├── health_check.json   # 에이전트 헬스체크
│   │   │   ├── mode_switch.json    # SLEEP/AWAKE 전환
│   │   │   ├── daily_report.json   # 일일 리포트 생성
│   │   │   └── resource_monitor.json # 리소스/토큰 모니터링
│   │   └── nodes/
│   │       └── agent_dispatch.ts   # 에이전트 태스크 배정
│   │
│   ├── gateway/                    # 승인 게이트웨이 + Task API
│   │   ├── server.ts               # Express 서버 (Tailscale 내부)
│   │   ├── approval_engine.ts      # 승인 로직
│   │   ├── risk_classifier.ts      # 위험도 분류기
│   │   ├── task_api.ts             # 헌터 ↔ 캡틴 Task API
│   │   ├── sanitizer.ts            # 개인정보 제거 레이어
│   │   └── types.ts
│   │
│   ├── agents/                     # 에이전트 래퍼 & 관리
│   │   ├── base_agent.ts           # 공통 에이전트 인터페이스
│   │   ├── claude_agent.ts         # Claude Code 래퍼
│   │   ├── gemini_agent.ts         # Gemini CLI 래퍼
│   │   ├── openclaw_agent.ts       # OpenClaw 래퍼 (Task API 경유)
│   │   └── agent_registry.ts       # 에이전트 등록 & 상태 관리
│   │
│   ├── validation/                 # 할루시네이션 방지
│   │   ├── cross_validator.ts      # AI 교차 검증
│   │   ├── fact_checker.ts         # 팩트 체크 파이프라인
│   │   └── types.ts
│   │
│   ├── notification/               # 알림 시스템
│   │   ├── telegram_bot.ts         # Telegram Bot (긴급 알림)
│   │   ├── slack_client.ts         # Slack Bot (업무 소통)
│   │   ├── notion_client.ts        # Notion API (보고서)
│   │   ├── notification_router.ts  # 채널별 라우팅
│   │   └── templates/
│   │       ├── morning_briefing.ts
│   │       ├── approval_request.ts
│   │       └── alert.ts
│   │
│   ├── tasks/                      # 태스크 관리
│   │   ├── task_manager.ts         # CRUD + 상태 전이
│   │   ├── task_queue.ts           # 큐 관리 (파일 기반)
│   │   ├── scheduler.ts            # SLEEP/AWAKE 모드별 스케줄링
│   │   └── types.ts
│   │
│   ├── crawlers/                   # 정보 수집 크롤러
│   │   ├── base_crawler.ts
│   │   ├── k_startup.ts            # 창업지원사업 (정부)
│   │   ├── private_startup.ts      # 창업지원사업 (민간: Google, D.CAMP 등)
│   │   ├── apply_home.ts           # 청약홈
│   │   ├── blind.ts                # 블라인드
│   │   ├── tech_trends.ts          # HN, Reddit, arxiv
│   │   ├── job_openings.ts         # 글로벌 빅테크 채용
│   │   ├── grad_school.ts          # 대학원/원격학위 일정
│   │   └── types.ts
│   │
│   ├── academy/                    # 학원 업무 자동화
│   │   ├── textbook_generator.ts   # 교재 제작
│   │   ├── student_manager.ts      # 학생 데이터 관리
│   │   ├── parent_message.ts       # 학부모 문자 생성
│   │   ├── test_generator.ts       # 주간 테스트 생성
│   │   └── types.ts
│   │
│   ├── pipeline/                   # 캐시플로우 & 사업화
│   │   ├── idea_analyzer.ts        # 아이디어 → 시장/경쟁/수익 분석
│   │   ├── project_documenter.ts   # 완벽한 기획/상세 문서 작성
│   │   ├── cashflow_scout.ts       # 캐시플로우 프로젝트 발굴
│   │   └── types.ts
│   │
│   ├── watchdog/                   # 감시 데몬
│   │   ├── process_monitor.ts      # tmux 세션 감시
│   │   ├── output_scanner.ts       # stdout 패턴 감지
│   │   ├── auto_restart.ts         # 자동 재시작
│   │   ├── resource_monitor.ts     # CPU/RAM/디스크 모니터링
│   │   ├── token_tracker.ts        # AI 토큰 사용량 추적
│   │   └── health_reporter.ts      # 헬스 리포트
│   │
│   └── shared/                     # 공유 유틸리티
│       ├── config.ts               # 환경 설정
│       ├── logger.ts               # 로깅
│       ├── file_queue.ts           # 파일 기반 큐
│       └── types.ts                # 공통 타입
│
├── config/
│   ├── agents.yml                  # 에이전트 설정
│   ├── risk_rules.yml              # 위험도 분류 규칙
│   ├── crawlers.yml                # 크롤러 설정 (주기, 대상)
│   ├── schedules.yml               # 스케줄 설정
│   └── personal_filter.yml         # 개인정보 필터링 규칙 (헌터용)
│
├── scripts/
│   ├── setup/
│   │   ├── install_deps.sh         # 의존성 설치
│   │   ├── setup_tmux.sh           # tmux 세션 초기화
│   │   ├── setup_colima.sh         # Colima + n8n 세팅
│   │   └── setup_tailscale.sh      # Tailscale 구성
│   ├── start_all.sh                # 전체 시스템 시작
│   ├── stop_all.sh                 # 전체 시스템 중지
│   └── status.sh                   # 시스템 상태 확인
│
├── state/                          # 런타임 상태 (gitignore)
│   ├── current_mode.json
│   ├── agent_status.json
│   └── pending_approvals.json
│
├── tasks/                          # 태스크 큐 (파일 기반)
│   ├── pending/
│   ├── in_progress/
│   ├── done/
│   └── blocked/
│
├── reports/                        # 산출물
│   ├── daily/
│   ├── research/
│   └── crawl_results/
│
├── logs/                           # 로그 (gitignore)
│   ├── claude/
│   ├── gemini_a/
│   ├── gemini_b/
│   ├── openclaw/
│   ├── gateway/
│   └── approvals/
│
└── tests/
    ├── gateway/
    ├── agents/
    ├── validation/
    ├── crawlers/
    ├── academy/
    └── pipeline/
```

---

## 3. 핵심 컴포넌트 상세 명세

### 3.1 Approval Gateway + Task API

#### 위험도 분류 기준

```typescript
type risk_level = 'low' | 'mid' | 'high' | 'critical'

const risk_classification = {
  low: [
    'file_read',           // 파일 읽기
    'web_search',          // 웹 검색
    'code_analysis',       // 코드 분석 (읽기전용)
    'report_generation',   // 리포트 생성 (로컬)
    'test_execution',      // 테스트 실행
    'log_review',          // 로그 확인
    'crawling',            // 크롤링 (공개 정보)
  ],
  mid: [
    'file_write',          // 파일 쓰기 (프로젝트 내)
    'git_commit',          // git commit (push 제외)
    'code_generation',     // 코드 생성
    'config_change',       // 설정 변경 (비핵심)
    'internal_api_call',   // 내부 API 호출
    'slack_message',       // Slack 메시지 전송
    'notion_page_create',  // Notion 페이지 생성
  ],
  high: [
    'git_push',            // git push
    'pr_creation',         // PR 생성
    'external_api_call',   // 외부 API 호출
    'docker_operation',    // Docker 컨테이너 조작
    'system_config',       // 시스템 설정 변경
    'package_install',     // 패키지 설치
    'telegram_alert',      // Telegram 긴급 알림 전송
  ],
  critical: [
    'deploy',              // 프로덕션 배포
    'data_deletion',       // 데이터 삭제
    'account_action',      // 계정 관련 행동
    'secret_access',       // 시크릿/인증 정보 접근
    'financial_action',    // 결제/금전 관련
  ],
}
```

#### 헌터 ↔ 캡틴 Task API

```typescript
// 캡틴에서 실행되는 Task API (Tailscale 내부 전용)

// 헌터에게 태스크 전달 (개인정보 자동 제거)
interface hunter_task {
  task_id: string
  action: string              // 'web_crawl' | 'notebooklm_verify' | 'deep_research' | 'browser_task'
  description: string         // 개인정보 제거된 태스크 설명
  payload: Record<string, unknown>  // 실행에 필요한 데이터
  timeout_minutes: number
  created_at: string
}

// 헌터가 반환하는 결과
interface hunter_result {
  task_id: string
  status: 'success' | 'failed' | 'timeout'
  output: string              // 실행 결과
  files?: string[]            // 생성된 파일 경로
  completed_at: string
}

// API Endpoints (캡틴 Express 서버)
// GET  /api/hunter/tasks/pending    — 헌터가 폴링
// POST /api/hunter/tasks/:id/result — 헌터가 결과 전달
// GET  /api/hunter/health           — 헬스체크

// 개인정보 산이타이징 레이어
// - 이름, 연락처, 주소, 주민번호, 금융정보 패턴 자동 감지 및 마스킹
// - config/personal_filter.yml로 패턴 관리
```

#### 승인 플로우

```
에이전트 → 행동 요청 → risk_classifier 분류
                          │
            ┌─────────────┼─────────────┐──────────────┐
            ▼             ▼             ▼              ▼
          LOW           MID           HIGH          CRITICAL
            │             │             │              │
        자동 승인     AI 교차승인    인간 승인       인간 승인
            │             │             │         (상세 설명 필수)
            │        ┌────┴────┐        │              │
            │        ▼         ▼        │              │
            │    Gemini     NotebookLM  │              │
            │    (리뷰)    (헌터, 검증) │              │
            │        └────┬────┘        │              │
            ▼             ▼             ▼              ▼
         Slack 로그   Slack 로그    Telegram 전송   Telegram 전송
                                   (Galaxy Watch)  (Galaxy Watch)
                                       │              │
                                  응답 대기 (30분)  응답 대기 (무제한)
                                       │              │
                                  타임아웃 시       타임아웃 시
                                  → 안전모드        → 거부 처리
```

### 3.2 Agent 래퍼 인터페이스

```typescript
type agent_id = 'claude' | 'gemini_a' | 'gemini_b' | 'openclaw'

type agent_status = 'idle' | 'busy' | 'error' | 'stopped'

interface agent_config {
  id: agent_id
  display_name: string
  device: 'captain' | 'hunter'
  tmux_session: string
  capabilities: string[]
  max_concurrent_tasks: number
  restart_policy: {
    max_retries: number           // 기본 3
    retry_delay_seconds: number   // 기본 5
    escalate_after: number        // 이 횟수 후 인간 알림
  }
  allowed_modes: ('sleep' | 'awake' | 'recurring')[]
  priority_weight: number
  can_access_personal_info: boolean  // 헌터 에이전트는 false
}

interface agent_interface {
  execute_task(task: task): Promise<task_result>
  review_output(output: agent_output): Promise<review_result>
  get_status(): agent_status
  stop(): Promise<void>
  restart(): Promise<void>
}
```

### 3.3 에이전트 역할 매핑

```yaml
# config/agents.yml

agents:
  claude:
    display_name: "Claude Code (Max)"
    device: captain
    tmux_session: fas-claude
    capabilities:
      - code_generation
      - code_review
      - file_write
      - git_commit
      - git_push
      - documentation
      - architecture_design
      - test_writing
      - textbook_generation      # 학원 교재
      - test_paper_generation    # 시험지 생성
      - parent_message_draft     # 학부모 문자 초안
      - idea_analysis            # 아이디어 분석
      - project_documentation    # 프로젝트 문서화
    max_concurrent_tasks: 1
    allowed_modes: [sleep, awake]
    priority_weight: 10
    can_access_personal_info: true
    strengths: "코드 품질, 긴 컨텍스트, 구조 설계, 문서 작성"

  gemini_a:
    display_name: "Gemini CLI (Research)"
    device: captain
    tmux_session: fas-gemini-a
    capabilities:
      - web_search
      - research
      - trend_analysis
      - fact_checking
      - cross_validation
      - crawling
      - job_search              # 취업 공고 크롤링
      - startup_program_search  # 창업지원사업 크롤링
      - market_analysis         # 시장 분석
    max_concurrent_tasks: 2
    allowed_modes: [sleep, awake, recurring]
    priority_weight: 7
    can_access_personal_info: true
    strengths: "최신 정보 검색, 구글 생태계, 크롤링"

  gemini_b:
    display_name: "Gemini CLI (Validator)"
    device: captain
    tmux_session: fas-gemini-b
    capabilities:
      - cross_validation
      - fact_checking
      - code_review
      - report_review
    max_concurrent_tasks: 2
    allowed_modes: [sleep, awake]
    priority_weight: 5
    can_access_personal_info: true
    strengths: "교차 검증, 독립적 관점"

  openclaw:
    display_name: "OpenClaw (ChatGPT Pro)"
    device: hunter
    tmux_session: fas-openclaw
    capabilities:
      - autonomous_browsing
      - web_automation
      - crawl_code_generation    # 크롤링 코드 작성 (안정화 후 캡틴 이관)
      - notebooklm_verification  # NotebookLM 웹 자동화
      - deep_research_execution  # Gemini Deep Research 웹 자동화
      - abstract_task_execution  # 추상적/자유도 높은 업무
    max_concurrent_tasks: 1
    allowed_modes: [sleep, awake, recurring]
    priority_weight: 8
    can_access_personal_info: false  # 절대 개인정보 접근 금지
    strengths: "웹 자동화, NotebookLM/Deep Research 실행, 자유도 높은 업무"
    communication: task_api  # Task API로만 통신 (직접 파일시스템 접근 불가)
```

### 3.4 Task 시스템

```typescript
interface task {
  id: string                      // task_YYYYMMDD_NNN
  title: string
  description: string
  category: 'info_gathering' | 'academy' | 'development' | 'cashflow' | 'system'
  priority: 'critical' | 'high' | 'medium' | 'low'
  mode: 'sleep' | 'awake' | 'recurring'
  risk_level: risk_level
  assigned_to?: agent_id
  preferred_agents: agent_id[]
  requires_personal_info: boolean  // true면 헌터 배정 불가
  status: 'pending' | 'in_progress' | 'blocked' | 'review' | 'done' | 'failed'

  schedule?: {
    type: 'once' | 'daily' | 'every_3_days' | 'weekly' | 'cron'
    cron_expression?: string
    next_run?: string
  }

  depends_on: string[]
  blocks: string[]

  validation_required: boolean
  validation_result?: {
    passed: boolean
    issues: string[]
    validated_by: string          // 'notebooklm' | agent_id
    validated_at: string
  }

  // 알림 채널 설정
  notification: {
    on_complete: 'slack' | 'telegram' | 'notion' | 'none'
    on_blocked: 'telegram'        // 항상 긴급
    report_format?: 'notion_page' | 'slack_message' | 'file'
  }

  created_at: string
  started_at?: string
  completed_at?: string
  created_by: 'human' | agent_id

  output?: {
    files_created: string[]
    files_modified: string[]
    notion_page_url?: string
    summary: string
  }
}
```

---

## 4. 소통 채널 명세

### 4.1 채널별 역할

| 채널 | 용도 | 수신 디바이스 | 알림 |
|------|------|-------------|------|
| **Telegram** | 긴급 알림, 승인 요청 (HIGH/CRITICAL) | Galaxy Watch (진동) + Fold | 즉시 |
| **Slack** | 일반 업무 소통, 로그, MID 승인 | Fold | 무음 |
| **Notion** | 보고서, 긴 문서, 리서치 결과 | Fold (URL로 접근) | 없음 |

### 4.2 Slack 채널 구성

```
#fas-general          — 시스템 전체 공지
#captain-logs         — 캡틴 에이전트 활동 로그
#hunter-logs          — 헌터 활동 로그
#approvals            — 승인 요청/결과 (MID)
#reports              — 일일/주간 보고서 URL
#crawl-results        — 크롤링 결과 알림
#academy              — 학원 업무 (교재, 시험지, 학부모 문자)
#ideas                — 아이디어/캐시플로우 프로젝트
#alerts               — 시스템 경고
```

### 4.3 Telegram Bot 커맨드

```
/status          — 전체 시스템 상태
/agents          — 에이전트별 상태
/approve {id}    — 승인
/reject {id}     — 거부 (사유 입력)
/pause           — 전체 시스템 일시 중지
/resume          — 시스템 재개
/sleep           — 강제 SLEEP 모드
/awake           — 강제 AWAKE 모드
/hunter {명령}   — 헌터에게 추상적 업무 직접 명령
```

### 4.4 Notion 구조

```
FAS Workspace/
├── Daily Reports/          — 일일 보고서
├── Research/               — 리서치 결과
│   ├── AI Trends/
│   ├── Startup Programs/
│   ├── Job Openings/
│   └── Grad Schools/
├── Academy/                — 학원 관련
│   ├── Textbook Drafts/
│   ├── Test Papers/
│   └── Student Reports/
├── Ideas & Projects/       — 아이디어/사업화
│   ├── Market Analysis/
│   ├── Project Specs/
│   └── Cashflow Projects/
└── Crawl Results/          — 크롤링 결과
    ├── 청약/
    ├── 창업지원/
    └── 블라인드/
```

---

## 5. 반복 태스크 스케줄

| 태스크 | 주기 | 시간대 | 에이전트 | 알림 채널 |
|--------|------|--------|----------|-----------|
| 창업지원사업 크롤링 | 3일 | SLEEP | Gemini A | Slack + Notion |
| 로또 청약 모니터링 | 3일 | SLEEP | Gemini A | Slack + Notion |
| 블라인드 인기글 감지 | 매일 | RECURRING | Gemini A | Slack (기준: 아래 참조) |
| AI 트렌드 리서치 | 매일 | SLEEP | Gemini A + Deep Research(헌터) | Notion |
| 글로벌 빅테크 채용 | 3일 | SLEEP | Gemini A | Slack + Notion |
| 대학원 일정 체크 | 주간 + 마감 D-30/14/7/3 | RECURRING | Gemini A | Telegram (마감 임박) |
| 에이전트 헬스체크 | 5분 | 상시 | 감시 데몬 | Telegram (장애 시) |
| 리소스 모니터링 | 30분 | 상시 | 감시 데몬 | Telegram (부족 시) |
| 토큰 사용량 추적 | 1시간 | 상시 | 감시 데몬 | Slack (일반) / Telegram (한도 임박) |
| 모닝 브리핑 | 매일 07:30 | AWAKE 시작 | n8n | Telegram + Slack |

---

## 5-A. 반복 태스크 상세 기준

### 블라인드 네이버 인기글 감지 기준

```yaml
blind_filter:
  channel: "네이버"
  triggers:
    # 정량 기준 (OR 조건)
    - comments_count: >= 50
    - likes_count: >= 100

    # 주제 기준 (키워드 매칭, OR 조건)
    - keywords:
        - 치정
        - 불륜
        - 자살
        - 사망
        - 괴롭힘
        - 갑질
        - 해고
        - 구조조정
        - 연봉
        - 성과급
        - 폭로
        - 내부고발
        - 임원
        - 대표

    # AI 판단 (위 기준 미충족 시 보조)
    - ai_judgment: "사람들 흥미를 강하게 끌 만한 자극적/논쟁적 글"

  output:
    - 제목 + 핵심 요약 (3줄)
    - 댓글 수/좋아요 수
    - 원문 링크
    - Slack #crawl-results 채널로 전송
```

### 글로벌 빅테크 취업 공고 매칭 기준

```yaml
job_filter:
  target_companies:
    tier_1:  # 최우선
      - Google
      - Apple
      - Meta
      - Amazon
      - Microsoft
      - Netflix
    tier_2:  # 우선
      - Stripe
      - Airbnb
      - Uber
      - Databricks
      - OpenAI
      - Anthropic
      - SpaceX
      - Tesla
      - Bloomberg
      - Goldman Sachs (tech)
    tier_3:  # 관심
      - 기타 Forbes Global 500 중 테크/혁신 기업

  position_keywords:
    - fullstack
    - full-stack
    - typescript
    - frontend
    - react
    - next.js
    - node.js
    - startup (부서/팀 이름에 포함)
    - entrepreneurship
    - business development (tech 배경)
    - international / global operations

  location: [korea, remote, any]  # 모두 OK
  min_salary: null  # 연봉 무관, 이름빨이 목적
  contract_type: [full-time, contract, remote-short-term]  # 단기 계약도 OK

  matching_profile:
    experience: "6년 풀스택 (TypeScript/Next.js/NestJS/GraphQL/MongoDB)"
    education: "GIST 물리 석사, UC Berkeley/Technion 교환"
    military: "카투사 (영어)"
    languages: [korean_native, english_professional]
```

### 대학원 / 원격 학위 추적

```yaml
grad_school_tracking:
  active_targets:
    - name: "Georgia Tech OMSCS"
      type: online_master
      field: computer_science
      status: not_applied
      action: 다음 지원 가능 시기 자동 추적, 준비물/마감일 알림
    - name: "서울대 GSEP"
      type: master
      field: engineering_practice
      status: not_applied
      action: 다음 지원 가능 시기 자동 추적, 준비물/마감일 알림

  research_targets:  # 추가 조사 대상
    criteria:
      - 원격 수업 가능 (필수)
      - 인지도 높은 학교 (글로벌 또는 국내 top)
      - 석사 또는 학사 편입
      - 분야: CS, 공학, 경영, 교육학 등 유연하게
    action: Deep Research(헌터)로 초기 조사 → Notion 보고서

  alert_schedule:
    - D-30: Slack 알림 + 준비 체크리스트
    - D-14: Telegram 알림
    - D-7: Telegram 알림 (반복)
    - D-3: Telegram 긴급 알림
```

---

## 6. 할루시네이션 방지 파이프라인

### 6.1 3단계 검증 체계

```
Stage 1: 자체 검증 (에이전트 내부)
  - 신뢰도 0.7 미만 → 자동으로 Stage 2

Stage 2: 교차 검증 (Claude ↔ Gemini, 캡틴 내부)
  - 일치율 80% 이상 → 통과
  - 일치율 80% 미만 → Stage 3

Stage 3: NotebookLM 검증 (헌터, OpenClaw 웹 자동화)
  - OpenClaw가 NotebookLM에 문서 업로드 + 검증 실행
  - 검증 실패 → 태스크 blocked + 사유 기록
  - 검증 성공 → 태스크 진행
```

### 6.2 Deep Research 활용 프로토콜

```
1. 새로운 도메인/주제 진입 시:
   - 캡틴이 Task API로 헌터에게 Deep Research 요청 (개인정보 제거)
   - 헌터의 OpenClaw가 별도 구글 계정의 Gemini Deep Research 실행
   - 결과를 Task API로 캡틴에 반환
   - 캡틴이 research/{topic}/에 구조화 저장

2. 주기적 갱신:
   - 7일마다 주요 리서치 결과 재검증
```

---

## 6-A. 학원 업무 자동화 명세

### 학생 데이터 스키마

```typescript
interface student {
  id: string
  name: string
  grade: string                    // 중1, 중2, 중3, 고1
  class_group: 'general' | 'ogeum' | 'med'  // 일반반 / 오금고반 / 의대반
  school: string
  enrollment_date: string

  // 출석
  attendance: {
    date: string
    status: 'present' | 'absent' | 'late'
    note?: string
  }[]

  // 주간 테스트
  weekly_tests: {
    date: string
    subject: string
    unit: string
    score: number
    total: number
    weak_points?: string[]         // 취약 단원/개념
  }[]

  // 학교 시험 성적
  school_exams: {
    semester: string               // "2026-1학기-중간"
    subject: string
    score: number
    grade?: string                 // 등급
    rank?: string                  // 석차
  }[]

  // 매일 특이사항
  daily_notes: {
    date: string
    content: string                // 자유 입력
  }[]

  // 학부모 특이사항
  parent_notes: {
    date: string
    content: string                // 자유 입력
  }[]

  // 종합 분석 (AI 생성)
  analysis?: {
    strengths: string[]
    weaknesses: string[]
    trend: 'improving' | 'stable' | 'declining'
    last_updated: string
  }
}
```

### 학부모 문자 생성

```typescript
interface parent_message_request {
  student_id: string
  date: string
  keywords: string[]               // 주인님이 제공하는 오늘의 키워드
  daily_note?: string              // 오늘 특이사항
  test_result?: {
    score: number
    total: number
    weak_points: string[]
  }
}

interface parent_message_draft {
  student_name: string
  message: string                  // AI 생성 초안
  tone: 'warm_professional'        // 정중 + 전문가 + 애정
  status: 'draft' | 'approved' | 'sent'
}

// 발송 수단 (우선순위)
// 1. 문자 발송 API (구매 시)
// 2. 학원 관리자 페이지 연동
// 3. Google Messages 웹 자동화 (폴백)
```

### 주간 테스트 생성

```typescript
interface test_generation_request {
  subject: string                  // 공통과학, 물리학 등
  units: string[]                  // 대상 단원
  difficulty: 'general' | 'ogeum' | 'med'
  question_count: number           // 기본 20문항
  question_type: 'multiple_choice' // 객관식 위주
  include_answer_key: true
  include_explanations: true
  output_format: 'pdf'
}
```

---

## 7. 보안 명세

### 7.1 시크릿 관리

```
저장소: macOS Keychain (security 명령어)
환경변수: .env 파일 (gitignore) + dotenv

캡틴 시크릿:
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID
- SLACK_BOT_TOKEN
- NOTION_API_KEY
- CLAUDE_SESSION (OAuth)
- GEMINI_API_KEY_A
- GEMINI_API_KEY_B

헌터 시크릿 (별도 관리, 캡틴과 공유 안 함):
- OPENAI_SESSION (ChatGPT Pro, OpenClaw용)
- GOOGLE_ACCOUNT (별도 구글 계정, NotebookLM/Deep Research용)
```

### 7.2 헌터 격리

```
- 별도 macOS 유저 (user)
- 별도 iCloud 계정
- 별도 구글 계정
- 캡틴 파일시스템 직접 접근 불가
- Task API로만 통신
- 개인정보 산이타이징 레이어 통과 후에만 태스크 수신
- 헌터에서 캡틴으로의 SSH 접근 차단 (Tailscale ACL)
```

### 7.3 외부 접근 제어

```
- Tailscale ACL: 주인님 디바이스만 접근 허용
- 헌터 → 캡틴: Task API 포트만 허용 (Tailscale ACL)
- n8n: localhost 바인딩 (Tailscale 통해서만 접근)
- SSH: 키 인증만 허용, 패스워드 비활성화
```

---

## 8. 비용 관리

### 8.1 구독 비용 (월간 고정)

| 서비스 | 플랜 | 위치 | 월 비용 |
|--------|------|------|---------|
| Claude | Max | 캡틴 (OAuth) | ~$100 |
| Gemini Pro | x2 계정 | 캡틴 | ~$40 |
| ChatGPT Pro | OpenClaw용 | 헌터 | ~$200 |
| Gemini (별도 구글) | NotebookLM/Deep Research용 | 헌터 | ~$20 |
| Slack | Free or Pro | — | $0~$8 |
| Notion | Free or Plus | — | $0~$10 |
| **합계** | | | **~$360~$378/월** |

### 8.2 리소스 최적화 전략

```
목표: 구독 플랜의 토큰/사용량을 기간 내 최대한 활용

- AI 토큰 잔여량이 많으면 → 추가 태스크 자동 배정
  - 캐시플로우 프로젝트 리서치
  - 기존 코드 리팩토링
  - 문서 품질 개선
  - 추가 교차 검증

- 디바이스 리소스 여유 있으면 → 병렬 태스크 증가

- 리소스/토큰 부족 시:
  - Telegram으로 주인님에게 보고
  - 구체적 추가 구매 제안 (어떤 플랜, 얼마)
```

---

## 9. 확장 계획

### 9.1 단기 (구축 후 1개월)
- 안정적 SLEEP/AWAKE 모드 운영
- 창업지원사업 + 로또청약 + 블라인드 자동화 가동
- 학원 업무 자동화 (교재, 시험지, 학부모 문자)
- 교차 승인 시스템 검증

### 9.2 중기 (2~3개월)
- 캐시플로우 프로젝트 1~2개 런칭
- 아이디어 → 사업화 파이프라인 안정화
- 글로벌 빅테크 취업 공고 자동 매칭
- Local LLM 추가 (Mac Studio 추가 구매 시)

### 9.3 장기 (6개월+)
- 에이전트 자율 판단 범위 점진적 확대
- 멀티 프로젝트 동시 운영
- 수익 창출 자동화 (SaaS 운영 등)
- 자동 수입 월 1,000만원 목표 기여
