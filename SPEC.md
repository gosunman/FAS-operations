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
                                  │ Telegram Bot API
                                  │ (승인/알림)
                         ┌────────▼─────────┐
                         │  APPROVAL GATEWAY │
                         │  (TypeScript)     │
                         └────────┬─────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
    ┌─────────▼────────┐ ┌───────▼────────┐ ┌────────▼───────┐
    │ Mac Studio #1    │ │ Mac Studio #2  │ │  External APIs │
    │ M1 Ultra / 32GB  │ │ M4 Ultra / 36GB│ │                │
    │                  │ │                │ │ - NotebookLM   │
    │ ┌──────────────┐ │ │ ┌────────────┐ │ │ - Deep Research│
    │ │ OpenClaw     │ │ │ │ n8n        │ │ │ - Google       │
    │ │ (ChatGPT Pro)│ │ │ │ (Docker)   │ │ │ - Crawlers     │
    │ └──────────────┘ │ │ ├────────────┤ │ └────────────────┘
    │ ┌──────────────┐ │ │ │ Claude Code│ │
    │ │ Gemini CLI   │ │ │ │ (Max)      │ │
    │ │ (Account B)  │ │ │ ├────────────┤ │
    │ └──────────────┘ │ │ │ Gemini CLI │ │
    │                  │ │ │ (Account A)│ │
    └──────────────────┘ │ ├────────────┤ │
                         │ │ Codex CLI  │ │
                         │ └────────────┘ │
                         └────────────────┘
                                  │
                         ┌────────▼─────────┐
                         │   SHARED STATE    │
                         │   (File System)   │
                         │                   │
                         │ tasks/            │
                         │ state/            │
                         │ reports/          │
                         │ logs/             │
                         │ research/         │
                         └──────────────────┘
```

### 1.2 하드웨어 할당 상세

#### Mac Studio #1 (M1 Ultra / 32GB) — `fas-worker-1`
| 서비스 | 리소스 할당 | tmux 세션명 |
|--------|-------------|-------------|
| OpenClaw | ~20GB RAM | `fas-openclaw` |
| Gemini CLI (Account B) | ~8GB RAM | `fas-gemini-b` |
| 감시 데몬 | ~1GB RAM | `fas-watchdog-1` |

#### Mac Studio #2 (M4 Ultra / 36GB) — `fas-worker-2`
| 서비스 | 리소스 할당 | tmux 세션명 |
|--------|-------------|-------------|
| n8n (Docker) | ~4GB RAM | `fas-n8n` |
| Claude Code (Max) | ~12GB RAM | `fas-claude` |
| Gemini CLI (Account A) | ~8GB RAM | `fas-gemini-a` |
| Codex CLI | ~8GB RAM | `fas-codex` |
| Approval Gateway | ~2GB RAM | `fas-gateway` |
| 감시 데몬 | ~1GB RAM | `fas-watchdog-2` |

---

## 2. 디렉토리 구조

```
fully-automation-system/
├── README.md
├── PLAN.md
├── SPEC.md
├── package.json
├── tsconfig.json
├── docker-compose.yml              # n8n + 관련 서비스
│
├── src/
│   ├── orchestrator/               # n8n 커스텀 노드 & 워크플로우
│   │   ├── workflows/
│   │   │   ├── master.json         # 마스터 오케스트레이션
│   │   │   ├── health_check.json   # 에이전트 헬스체크
│   │   │   ├── mode_switch.json    # SLEEP/AWAKE 전환
│   │   │   └── daily_report.json   # 일일 리포트 생성
│   │   └── nodes/
│   │       └── agent_dispatch.ts   # 에이전트 태스크 배정 커스텀 노드
│   │
│   ├── gateway/                    # 승인 게이트웨이
│   │   ├── server.ts               # Express 서버 (내부용)
│   │   ├── approval_engine.ts      # 승인 로직
│   │   ├── risk_classifier.ts      # 위험도 분류기
│   │   └── types.ts
│   │
│   ├── agents/                     # 에이전트 래퍼 & 관리
│   │   ├── base_agent.ts           # 공통 에이전트 인터페이스
│   │   ├── claude_agent.ts         # Claude Code 래퍼
│   │   ├── gemini_agent.ts         # Gemini CLI 래퍼
│   │   ├── codex_agent.ts          # Codex CLI 래퍼
│   │   ├── openclaw_agent.ts       # OpenClaw 래퍼
│   │   └── agent_registry.ts       # 에이전트 등록 & 상태 관리
│   │
│   ├── validation/                 # 할루시네이션 방지
│   │   ├── notebook_lm.ts          # NotebookLM 연동
│   │   ├── cross_validator.ts      # AI 교차 검증
│   │   ├── fact_checker.ts         # 팩트 체크 파이프라인
│   │   └── types.ts
│   │
│   ├── notification/               # 알림 시스템
│   │   ├── telegram_bot.ts         # Telegram Bot 클라이언트
│   │   ├── notification_manager.ts # 알림 라우팅
│   │   └── templates/              # 메시지 템플릿
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
│   │   ├── k_startup.ts            # 창업지원사업
│   │   ├── apply_home.ts           # 청약홈
│   │   ├── blind.ts                # 블라인드
│   │   ├── tech_trends.ts          # HN, Reddit, arxiv
│   │   └── types.ts
│   │
│   ├── watchdog/                   # 감시 데몬
│   │   ├── process_monitor.ts      # tmux 세션 감시
│   │   ├── output_scanner.ts       # stdout 패턴 감지
│   │   ├── auto_restart.ts         # 자동 재시작
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
│   ├── crawlers.yml                # 크롤러 설정
│   └── schedules.yml               # 스케줄 설정
│
├── scripts/
│   ├── setup/
│   │   ├── install_deps.sh         # 의존성 설치
│   │   ├── setup_tmux.sh           # tmux 세션 초기화
│   │   ├── setup_docker.sh         # Docker + n8n 세팅
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
│   ├── codex/
│   ├── openclaw/
│   ├── gateway/
│   └── approvals/
│
└── tests/
    ├── gateway/
    ├── agents/
    ├── validation/
    └── tasks/
```

---

## 3. 핵심 컴포넌트 상세 명세

### 3.1 Approval Gateway

승인 게이트웨이는 모든 에이전트 행동의 관문.

#### 위험도 분류 기준

```typescript
type risk_level = 'low' | 'mid' | 'high' | 'critical'

// risk_rules.yml 로 외부 설정 가능
const risk_classification = {
  low: [
    'file_read',           // 파일 읽기
    'web_search',          // 웹 검색
    'code_analysis',       // 코드 분석 (읽기전용)
    'report_generation',   // 리포트 생성 (로컬)
    'test_execution',      // 테스트 실행
    'log_review',          // 로그 확인
  ],
  mid: [
    'file_write',          // 파일 쓰기 (프로젝트 내)
    'git_commit',          // git commit (push 제외)
    'code_generation',     // 코드 생성
    'config_change',       // 설정 변경 (비핵심)
    'crawler_execution',   // 크롤러 실행
    'internal_api_call',   // 내부 API 호출
  ],
  high: [
    'git_push',            // git push
    'pr_creation',         // PR 생성
    'external_api_call',   // 외부 API 호출
    'docker_operation',    // Docker 컨테이너 조작
    'system_config',       // 시스템 설정 변경
    'package_install',     // 패키지 설치
  ],
  critical: [
    'payment_action',      // 결제 관련 (청약 등)
    'deploy',              // 프로덕션 배포
    'data_deletion',       // 데이터 삭제
    'account_action',      // 계정 관련 행동
    'secret_access',       // 시크릿/인증 정보 접근
  ],
}
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
            │    검증 AI    판정 AI      │              │
            │    (리뷰)    (불일치 시)   │              │
            │        │         │        │              │
            │        └────┬────┘        │              │
            │             │             │              │
            ▼             ▼             ▼              ▼
         실행 로그     실행 로그    Telegram 전송   Telegram 전송
                                   (요약 + 증거)   (풀 컨텍스트)
                                       │              │
                                  응답 대기 (30분)  응답 대기 (무제한)
                                       │              │
                                  타임아웃 시       타임아웃 시
                                  → 안전모드        → 거부 처리
```

#### Approval Request 스키마

```typescript
interface approval_request {
  request_id: string             // 고유 ID (uuid v4)
  requester_agent: agent_id      // 요청한 에이전트
  action_type: string            // 행동 타입
  action_detail: string          // 상세 설명
  risk_level: risk_level         // 분류된 위험도
  context: {
    task_id: string              // 관련 태스크
    files_affected: string[]     // 영향받는 파일
    diff_summary?: string        // 변경 사항 요약
    test_results?: string        // 테스트 결과
    evidence: string[]           // 근거 자료
  }
  reviewer?: agent_id            // 교차 검증 에이전트 (MID)
  review_result?: {
    approved: boolean
    reason: string
    confidence: number           // 0~1
  }
  human_response?: {
    approved: boolean
    message?: string
    responded_at: string
  }
  status: 'pending' | 'approved' | 'rejected' | 'timeout'
  created_at: string
  resolved_at?: string
  timeout_minutes: number        // MID: 10, HIGH: 30, CRITICAL: ∞
}
```

### 3.2 Agent 래퍼 인터페이스

```typescript
type agent_id = 'claude' | 'gemini_a' | 'gemini_b' | 'codex' | 'openclaw'

type agent_status = 'idle' | 'busy' | 'error' | 'stopped'

interface agent_config {
  id: agent_id
  display_name: string
  device: 'studio_1' | 'studio_2'
  tmux_session: string
  capabilities: string[]          // 가능한 행동 목록
  max_concurrent_tasks: number
  restart_policy: {
    max_retries: number           // 기본 3
    retry_delay_seconds: number   // 기본 5
    escalate_after: number        // 이 횟수 후 인간 알림
  }
  allowed_modes: ('sleep' | 'awake' | 'recurring')[]
  priority_weight: number         // 태스크 배정 가중치
}

interface agent_interface {
  // 태스크 실행
  execute_task(task: task): Promise<task_result>

  // 교차 검증 (다른 에이전트의 결과물 리뷰)
  review_output(output: agent_output): Promise<review_result>

  // 상태 조회
  get_status(): agent_status

  // 강제 중지
  stop(): Promise<void>

  // 재시작
  restart(): Promise<void>
}
```

### 3.3 에이전트 역할 매핑

```yaml
# config/agents.yml

agents:
  claude:
    display_name: "Claude Code (Max)"
    device: studio_2
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
    max_concurrent_tasks: 1
    allowed_modes: [sleep, awake]
    priority_weight: 10
    strengths: "코드 품질, 긴 컨텍스트, 구조 설계"

  gemini_a:
    display_name: "Gemini CLI (Research)"
    device: studio_2
    tmux_session: fas-gemini-a
    capabilities:
      - web_search
      - research
      - trend_analysis
      - fact_checking
      - cross_validation
    max_concurrent_tasks: 2
    allowed_modes: [sleep, awake, recurring]
    priority_weight: 7
    strengths: "최신 정보 검색, 구글 생태계"

  gemini_b:
    display_name: "Gemini CLI (Validator)"
    device: studio_1
    tmux_session: fas-gemini-b
    capabilities:
      - cross_validation
      - fact_checking
      - code_review
      - report_review
    max_concurrent_tasks: 2
    allowed_modes: [sleep, awake]
    priority_weight: 5
    strengths: "교차 검증, 독립적 관점"

  codex:
    display_name: "Codex (ChatGPT Pro)"
    device: studio_2
    tmux_session: fas-codex
    capabilities:
      - code_generation
      - code_review
      - alternative_solutions
      - refactoring
    max_concurrent_tasks: 1
    allowed_modes: [awake]
    priority_weight: 6
    strengths: "다양한 코드 관점, 대안 제시"

  openclaw:
    display_name: "OpenClaw (ChatGPT Pro)"
    device: studio_1
    tmux_session: fas-openclaw
    capabilities:
      - autonomous_browsing
      - complex_task_execution
      - multi_step_workflow
    max_concurrent_tasks: 1
    allowed_modes: [sleep, awake, recurring]
    priority_weight: 8
    strengths: "자율적 멀티스텝 실행, 브라우저 조작"
```

### 3.4 Task 시스템

```typescript
interface task {
  id: string                      // task_YYYYMMDD_NNN
  title: string
  description: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  mode: 'sleep' | 'awake' | 'recurring'
  risk_level: risk_level
  assigned_to?: agent_id
  preferred_agents: agent_id[]    // 선호 에이전트 (순서대로 시도)
  status: 'pending' | 'in_progress' | 'blocked' | 'review' | 'done' | 'failed'

  // 스케줄링
  schedule?: {
    type: 'once' | 'daily' | 'weekly' | 'cron'
    cron_expression?: string      // cron 타입일 때
    next_run?: string
  }

  // 의존성
  depends_on: string[]            // 선행 태스크 ID
  blocks: string[]                // 후속 태스크 ID

  // 검증
  validation_required: boolean    // NotebookLM/교차검증 필요 여부
  validation_result?: {
    passed: boolean
    issues: string[]
    validated_by: string          // 'notebooklm' | agent_id
    validated_at: string
  }

  // 메타
  created_at: string
  started_at?: string
  completed_at?: string
  created_by: 'human' | agent_id

  // 결과
  output?: {
    files_created: string[]
    files_modified: string[]
    report_path?: string
    summary: string
  }
}
```

### 3.5 태스크 배정 알고리즘

```
1. 태스크 큐에서 pending 태스크 조회
2. 현재 모드(SLEEP/AWAKE) 필터링
3. 의존성 확인 (depends_on 모두 done인지)
4. 위험도 확인 (SLEEP 모드에서 high/critical 제외)
5. preferred_agents 순서로 가용 에이전트 탐색
6. 가용 에이전트 없으면 → 가장 높은 priority_weight 에이전트 대기열
7. 배정 시 상태 전이: pending → in_progress
```

---

## 4. 할루시네이션 방지 파이프라인

### 4.1 3단계 검증 체계

```
Stage 1: 자체 검증 (에이전트 내부)
  - 생성한 정보에 대해 스스로 신뢰도 점수 부여
  - 신뢰도 0.7 미만 → 자동으로 Stage 2 진입

Stage 2: 교차 검증 (AI ↔ AI)
  - 생성 에이전트와 다른 AI가 독립 검증
  - 검증 방법:
    a. 동일 질문을 독립적으로 답변 → 비교
    b. 생성된 주장의 출처 확인 요청
    c. 논리적 모순 탐지
  - 일치율 80% 이상 → 통과
  - 일치율 80% 미만 → Stage 3

Stage 3: NotebookLM 검증
  - 생성된 문서를 NotebookLM에 업로드
  - 검증 항목:
    a. 논리적 일관성
    b. 출처 확인 가능 여부
    c. 사실 관계 정확성
    d. 완전성 (빠진 정보 없는지)
  - 검증 실패 → 태스크 blocked + 사유 기록
  - 검증 성공 → 태스크 진행
```

### 4.2 Deep Research 활용 프로토콜

```
1. 새로운 도메인/주제 진입 시:
   - Deep Research로 포괄적 초기 조사 실행
   - 결과를 research/{topic}/ 에 구조화 저장
   - 목차: overview.md, key_findings.md, sources.md, open_questions.md

2. 저장된 리서치는 에이전트들의 참조 소스로 활용:
   - 에이전트가 해당 도메인 작업 시 research/ 먼저 참조
   - 새로운 정보 발견 시 research/에 추가

3. 주기적 갱신:
   - 7일마다 주요 리서치 결과 재검증
   - 변경 사항 발견 시 업데이트 + 변경 로그 기록
```

---

## 5. 알림 시스템 상세

### 5.1 Telegram 메시지 유형

| 유형 | 긴급도 | Watch 진동 | Fold 표시 | 응답 필요 |
|------|--------|-----------|-----------|-----------|
| `INFO` | 낮음 | X | O | X |
| `MILESTONE` | 중간 | O | O | X |
| `APPROVAL_MID` | 중간 | O | O | O (yes/no) |
| `APPROVAL_HIGH` | 높음 | O (반복) | O (상세) | O (yes/no + 사유) |
| `APPROVAL_CRITICAL` | 최고 | O (연속) | O (풀 컨텍스트) | O (필수) |
| `ALERT` | 긴급 | O (연속) | O | X (자동 안전모드) |
| `MORNING_BRIEFING` | 정기 | O | O | X |

### 5.2 모닝 브리핑 포맷

```
🌅 FAS 모닝 브리핑 (2026-03-18)

📊 밤새 실행 요약
- 완료: 5건
- 진행중: 2건
- 차단됨: 1건

🔬 리서치 결과
- [AI 트렌드] Claude 4.5 Haiku 벤치마크 결과 분석
- [창업] 2026 예비창업패키지 2차 공고 발견 (D-14)

⏳ 승인 대기 (3건)
1. [HIGH] 에듀테크 MVP PR 생성 → /approve 1
2. [HIGH] 청약 보고서 기반 신청 → /approve 2
3. [MID] 블라인드 인기글 3건 단톡방 공유 → /approve 3

📋 오늘 추천 태스크
1. NVC 플랫폼 API 설계 리뷰
2. 예창패 사업계획서 초안 검토

💰 어제 비용: Claude $2.30 | Gemini $0.80 | Codex $1.50
```

### 5.3 Telegram Bot 커맨드

```
/status          — 전체 시스템 상태
/agents          — 에이전트별 상태
/tasks           — 현재 태스크 목록
/approve {id}    — 승인
/reject {id}     — 거부 (사유 입력)
/pause           — 전체 시스템 일시 중지
/resume          — 시스템 재개
/sleep           — 강제 SLEEP 모드
/awake           — 강제 AWAKE 모드
/cost            — 오늘 비용 현황
/logs {agent}    — 최근 로그 조회
```

---

## 6. 보안 명세

### 6.1 시크릿 관리

```
저장소: macOS Keychain (security 명령어)
환경변수: .env 파일 (gitignore) + dotenv

필요한 시크릿:
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID
- CLAUDE_API_KEY (또는 세션)
- GEMINI_API_KEY_A
- GEMINI_API_KEY_B
- OPENAI_API_KEY (Codex/OpenClaw)
- NOTEBOOKLM_API_KEY (가용 시)
```

### 6.2 에이전트 격리

```
방법 1 (간이): 디렉토리 권한 제한
  - 각 에이전트는 지정된 디렉토리만 쓰기 가능
  - state/, logs/ 는 공유 쓰기
  - config/ 는 읽기 전용

방법 2 (강화): macOS 별도 사용자
  - 에이전트별 macOS 사용자 계정
  - SSH 키 분리
  - 파일시스템 ACL로 접근 제어
```

### 6.3 외부 접근 제어

```
- Tailscale ACL: 주인 디바이스만 접근 허용
- n8n: localhost 바인딩 (Tailscale 통해서만 접근)
- SSH: 키 인증만 허용, 패스워드 비활성화
- API 화이트리스트: 허용된 외부 도메인만 호출 가능
```

---

## 7. 모니터링 & 로깅

### 7.1 로그 포맷

```typescript
interface log_entry {
  timestamp: string          // ISO 8601
  level: 'debug' | 'info' | 'warn' | 'error'
  agent_id: agent_id
  task_id?: string
  action: string
  detail: string
  metadata?: Record<string, unknown>
}
```

### 7.2 로그 보존

```
- 실시간 로그: logs/{agent}/{date}.log
- 승인 기록: logs/approvals/{date}.json (영구 보존)
- 비용 기록: logs/cost/{month}.json (영구 보존)
- 에이전트 로그: 30일 보존 후 자동 삭제
- 리포트: reports/ 영구 보존
```

### 7.3 헬스체크

```
주기: 5분마다
체크 항목:
  1. tmux 세션 존재 여부
  2. 에이전트 프로세스 CPU/RAM
  3. 마지막 활동 시각 (30분 이상 무응답 = 경고)
  4. 디스크 잔여 용량 (10GB 미만 = 경고)
  5. 네트워크 연결 (Tailscale 상태)
```

---

## 8. 비용 관리

### 8.1 구독 비용 (월간 고정)

| 서비스 | 플랜 | 월 비용 |
|--------|------|---------|
| Claude | Max | ~$100 |
| Gemini Pro | x2 계정 | ~$40 |
| ChatGPT Pro | (OpenClaw + Codex) | ~$200 |
| **합계** | | **~$340/월** |

### 8.2 비용 제어

```
- 일일 API 호출 상한: 설정 가능 (config/schedules.yml)
- 월간 예산 알림: 80% 도달 시 경고
- 단순 작업 라우팅: 가능하면 저비용 모델 사용
  - 정보 요약 → Gemini Flash
  - 코드 포매팅 → 로컬 도구
  - 단순 분류 → Haiku
```

---

## 9. 확장 계획

### 9.1 단기 (구축 후 1개월)
- 안정적 SLEEP/AWAKE 모드 운영
- 창업지원사업 + 로또청약 자동화 가동
- 교차 승인 시스템 검증

### 9.2 중기 (2~3개월)
- Local LLM 추가 (Mac Studio 추가 구매 시)
- 투자 정보 수집 파이프라인
- 에이전트 간 학습 결과 공유 체계

### 9.3 장기 (6개월+)
- 에이전트 자율 판단 범위 점진적 확대
- 멀티 프로젝트 동시 운영
- 수익 창출 자동화 (SaaS 운영 등)
