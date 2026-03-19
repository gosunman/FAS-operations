# 태스크 시스템

## 개요

태스크 큐. 초기에는 파일 기반(YAML), 안정화 후 **SQLite로 마이그레이션** 권장 (동시성 제어, 트랜잭션 안전성).

### 왜 SQLite인가
파일 기반 큐는 다수 Agent Wrapper가 동시 접근 시 경쟁 상태(Race Condition)와 파일 잠금 충돌이 발생할 수 있다. SQLite는 단일 파일 DB로 트랜잭션을 보장하면서도 서버 없이 동작하므로 FAS에 적합하다. 초기 MVP는 파일 기반으로 빠르게 구축하되, Phase 2에서 SQLite로 전환한다.

### DB 용도 분리 원칙
- **SQLite**: 태스크 큐, n8n 연동 상태, 승인 이력, 로컬 상태 관리 (단일 파일, 트랜잭션 보장)
- **MongoDB Atlas** (클라우드): 앱 서비스 데이터, 학생 데이터, 크롤링 결과 등 도메인 데이터 (스키마 유연성, 헌터와 시스템 분리, 프리티어로 시작 → 필요 시 유료 전환)

## 디렉토리 구조

```text
tasks/
├── pending/          # 대기 중인 태스크
├── in_progress/      # 실행 중
├── done/             # 완료
└── blocked/          # 차단됨 (에러, 승인 거부 등)
```

## 태스크 파일 포맷

```yaml
# tasks/pending/task_20260317_001.yml

id: task_20260317_001
title: "K-Startup 창업지원사업 신규 공고 크롤링"
description: |
  k-startup.go.kr에서 신규 창업지원사업 공고를 크롤링한다.
  - 신규 공고 목록 추출
  - 각 공고의 지원 자격, 마감일, 지원 금액 파싱
  - 주인님 프로필 기반 자격 매칭
  - 결과를 reports/crawl_results/startup/ 에 저장

category: info_gathering   # info_gathering | academy | development | cashflow | system
action: web_crawl          # (optional) 명시적 액션 타입 — 아래 "Action 라우팅" 참조
priority: medium           # critical | high | medium | low
mode: recurring            # sleep | awake | recurring
risk_level: low            # low | mid | high | critical
requires_personal_info: true   # true면 헌터 배정 불가

# 배정
assigned_to: gemini_a      # claude | gemini_a | openclaw
preferred_agents:
  - gemini_a

# 스케줄 (반복 태스크용)
schedule:
  type: every_3_days        # once | daily | every_3_days | weekly | cron
  cron_expression: null
  next_run: "2026-03-20T02:00:00+09:00"
  last_run: "2026-03-17T02:00:00+09:00"

# 실행 설정
execution:
  mode: oneshot             # oneshot | interactive
  timeout_ms: 300000        # 5분
  working_dir: null         # null이면 프로젝트 루트
  retry_on_fail: true
  max_retries: 2

# 의존성
depends_on: []              # 선행 태스크 ID 목록
blocks: []                  # 이 태스크가 차단하는 후속 태스크

# 검증
validation_required: false
validation_result: null

# 알림
notification:
  on_complete: slack        # slack | telegram | notion | none
  on_blocked: telegram      # 항상 긴급
  report_format: notion_page  # notion_page | slack_message | file

# 메타
status: pending             # pending | in_progress | blocked | review | done | failed
created_at: "2026-03-17T14:00:00+09:00"
started_at: null
completed_at: null
created_by: system          # human | system | claude | gemini_a | ...

# 결과 (실행 후 기록)
output: null
# output:
#   summary: "3건의 신규 공고 발견. 예비창업패키지 2차 (D-14) 자격 매칭됨."
#   files_created:
#     - reports/crawl_results/startup/20260317.json
#   files_modified: []
#   notion_page_url: "https://notion.so/..."
```

## 태스크 생명주기

```text
                    생성
                      │
                      ▼
┌──────────────────────────────────────────────┐
│                  PENDING                      │
│  tasks/pending/ 에 파일 생성                   │
│  n8n 스케줄러 또는 인간이 생성                  │
└───────────────────┬──────────────────────────┘
                    │ Agent Wrapper가 폴링하여 발견
                    │ + 배정 조건 확인 (모드, 의존성, 개인정보)
                    ▼
┌──────────────────────────────────────────────┐
│               IN_PROGRESS                     │
│  tasks/in_progress/ 로 이동                    │
│  Agent Wrapper가 CLI 도구 호출                 │
└───────┬──────────────┬───────────────────────┘
        │              │
   성공  │              │ 실패/차단
        ▼              ▼
┌──────────────┐ ┌──────────────┐
│     DONE     │ │   BLOCKED    │
│  tasks/done/ │ │ tasks/blocked│
│  알림 전송    │ │ 알림 전송     │
└──────────────┘ └──────────────┘
```

## 태스크 배정 알고리즘

```typescript
// src/tasks/scheduler.ts

async function assign_next_task(): Promise<void> {
  // 1. pending 태스크 목록 로드
  const pending = await load_pending_tasks()

  // 2. 현재 모드 확인 (SLEEP/AWAKE)
  const current_mode = await get_current_mode()

  // 3. 필터링
  const eligible = pending.filter(task => {
    // 모드 필터: SLEEP 모드에서는 sleep/recurring만
    if (current_mode === 'sleep' && task.mode === 'awake') return false

    // SLEEP 모드에서 high/critical 제외
    if (current_mode === 'sleep' && ['high', 'critical'].includes(task.risk_level)) return false

    // 의존성 확인: depends_on이 모두 done인지
    if (task.depends_on.length > 0) {
      const all_done = task.depends_on.every(dep_id => is_task_done(dep_id))
      if (!all_done) return false
    }

    // 스케줄 확인: next_run 시간이 지났는지
    if (task.schedule?.next_run) {
      if (new Date(task.schedule.next_run) > new Date()) return false
    }

    return true
  })

  // 4. 우선순위 정렬
  const sorted = eligible.sort((a, b) => {
    const priority_order = { critical: 0, high: 1, medium: 2, low: 3 }
    return priority_order[a.priority] - priority_order[b.priority]
  })

  // 5. 에이전트 배정
  for (const task of sorted) {
    const agent = find_available_agent(task)
    if (agent) {
      task.assigned_to = agent.id
      task.status = 'pending'  // Wrapper가 폴링할 수 있도록
      await save_task(task)
    }
  }
}

function find_available_agent(task: Task): Agent | null {
  const agents = get_all_agents()

  // preferred_agents 순서대로 시도
  for (const preferred_id of task.preferred_agents) {
    const agent = agents.find(a => a.id === preferred_id)
    if (!agent) continue
    if (agent.status !== 'idle') continue

    // 개인정보 필요한 태스크는 헌터(openclaw) 배정 불가
    if (task.requires_personal_info && !agent.can_access_personal_info) continue

    // 현재 모드에서 사용 가능한지
    const current_mode = get_current_mode()
    if (!agent.allowed_modes.includes(current_mode)) continue

    return agent
  }

  return null  // 가용 에이전트 없음 → 다음 폴링에서 재시도
}
```

## 반복 태스크 스케줄링

```typescript
// src/tasks/recurring.ts

// 반복 태스크가 완료되면 다음 실행 시간을 계산하여 새 pending 태스크 생성
async function schedule_next_run(completed_task: Task): Promise<void> {
  if (!completed_task.schedule || completed_task.schedule.type === 'once') return

  const next_run = calculate_next_run(completed_task.schedule)

  // 새 태스크 파일 생성 (ID만 변경)
  const new_task = {
    ...completed_task,
    id: generate_task_id(),
    status: 'pending',
    started_at: null,
    completed_at: null,
    output: null,
    schedule: {
      ...completed_task.schedule,
      next_run: next_run.toISOString(),
      last_run: new Date().toISOString(),
    },
  }

  await write_task_file(new_task, 'pending')
}

function calculate_next_run(schedule: Schedule): Date {
  const now = new Date()

  switch (schedule.type) {
    case 'daily':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000)
    case 'every_3_days':
      return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
    case 'weekly':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    case 'cron':
      return next_cron_time(schedule.cron_expression!)
    default:
      throw new Error(`Unknown schedule type: ${schedule.type}`)
  }
}
```

## Action 라우팅

Task의 `action` 필드는 헌터가 태스크를 어떤 핸들러로 실행할지 결정하는 힌트.
`config/schedules.yml`에서 정의되어 Planning Loop → TaskStore → Hunter API 응답까지 전달된다.

### 지원 액션 타입

| action | 설명 | 실행 핸들러 |
|--------|------|------------|
| `web_crawl` | 웹페이지 크롤링 (Playwright) | handle_web_crawl |
| `chatgpt_task` | ChatGPT Pro(OpenClaw)로 복잡한 분석 위임 | handle_chatgpt_task |
| `deep_research` | Google Deep Research 실행 | handle_deep_research |
| `research` | Gemini CLI 리서치 | 캡틴 내부 처리 |
| (미지정) | 아래 우선순위로 자동 판별 | — |

### 라우팅 우선순위

```text
1. action 필드 명시 (최우선) — schedules.yml 또는 Telegram 명령에서 직접 지정
2. 키워드 매칭 — description에서 '크롤링', 'crawl' 등 감지
3. URL 감지 — description이 URL로 시작하면 web_crawl로 판별
```

## 동시성 제어

파일 기반 큐에서 동시성 문제 방지:

```typescript
// src/tasks/file_lock.ts

import { open, unlink } from 'fs/promises'

// 파일 잠금: .lock 파일 생성 (atomic)
async function acquire_lock(task_path: string): Promise<boolean> {
  const lock_path = `${task_path}.lock`
  try {
    // O_CREAT | O_EXCL: 파일이 이미 존재하면 에러 (atomic)
    const fd = await open(lock_path, 'wx')
    await fd.writeFile(JSON.stringify({
      locked_by: process.pid,
      locked_at: new Date().toISOString(),
    }))
    await fd.close()
    return true
  } catch {
    return false  // 이미 잠김
  }
}

async function release_lock(task_path: string): Promise<void> {
  await unlink(`${task_path}.lock`).catch(() => {})
}

// Agent Wrapper에서 사용:
// 1. acquire_lock(task_file) → true면 진행
// 2. 태스크 실행
// 3. release_lock(task_file)
// 4. 다른 Wrapper가 같은 파일을 잡으려 하면 lock 실패 → skip
```

## n8n 연동

n8n은 태스크의 **생성자 및 스케줄러** 역할:

```text
n8n 크론 트리거 (schedules.yml 기반)
  → "매 3일 02:00" 트리거 발동
  → Execute Command 노드: 태스크 YAML 파일 생성
  → tasks/pending/ 에 저장
  → Agent Wrapper가 폴링하여 실행
  → 완료 시 tasks/done/ 에 결과 저장
  → n8n Watch Folder 트리거: done/ 감시
  → 결과 파싱 → 알림 전송 (Slack/Telegram/Notion)
```

상세 워크플로우는 [n8n-workflows.md](n8n-workflows.md) 참조.
