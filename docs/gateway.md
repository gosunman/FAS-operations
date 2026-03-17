# 승인 게이트웨이 + Task API

## 개요

Express 서버가 두 가지 역할을 겸한다:
1. **Approval Gateway**: 에이전트 행동의 위험도 분류 + 승인 관리
2. **Task API**: 헌터 ↔ 캡틴 간 태스크 통신

캡틴에서 실행. 포트 3100. Tailscale 내부에서만 접근 가능.

## 서버 구조

```typescript
// src/gateway/server.ts

import express from 'express'

const app = express()
app.use(express.json())

// === Approval Gateway ===
app.post('/api/approvals', create_approval_request)
app.get('/api/approvals/:id', get_approval_status)
app.post('/api/approvals/:id/respond', respond_to_approval)

// === Task API (헌터용) ===
app.get('/api/hunter/tasks/pending', get_hunter_pending_tasks)
app.post('/api/hunter/tasks/:id/result', submit_hunter_result)
app.post('/api/hunter/heartbeat', hunter_heartbeat)

// === 시스템 ===
app.get('/api/health', health_check)
app.get('/api/agents', get_agent_statuses)
app.get('/api/mode', get_current_mode)

app.listen(3100, '0.0.0.0', () => {
  console.log('Gateway + Task API listening on :3100')
})
```

## 위험도 분류

```yaml
# config/risk_rules.yml

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
    reviewer: gemini_b    # 기본 리뷰어
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
    timeout_minutes: null   # 무제한 대기
    on_timeout: reject
    log: true
```

## 승인 플로우 구현

```typescript
// src/gateway/approval_engine.ts

interface approval_request {
  id: string                  // uuid v4
  requester: string           // agent_id
  action_type: string
  action_detail: string
  risk_level: 'low' | 'mid' | 'high' | 'critical'
  context: {
    task_id: string
    files_affected: string[]
    diff_summary?: string
    evidence: string[]
  }
  status: 'pending' | 'approved' | 'rejected' | 'timeout'
  created_at: string
  resolved_at?: string
}

async function process_approval(request: approval_request): Promise<boolean> {
  const rules = load_risk_rules()
  const rule = rules[request.risk_level]

  switch (rule.approval) {
    case 'auto':
      // LOW: 자동 승인, 로그만 기록
      await log_approval(request, 'auto_approved')
      return true

    case 'ai_cross_review':
      // MID: AI 교차 검증
      return await ai_cross_review(request, rule.reviewer)

    case 'human':
      // HIGH: 인간 승인 (Telegram)
      return await request_human_approval(request, rule.timeout_minutes)

    case 'human_required':
      // CRITICAL: 인간 필수 (타임아웃 시 거부)
      return await request_human_approval(request, null)  // 무제한 대기
  }
}

async function ai_cross_review(
  request: approval_request,
  reviewer_id: string,
): Promise<boolean> {
  // 리뷰어 에이전트에게 검증 요청
  const review_prompt = [
    '다음 행동을 검증해주세요:',
    `행동: ${request.action_type}`,
    `상세: ${request.action_detail}`,
    `영향 파일: ${request.context.files_affected.join(', ')}`,
    request.context.diff_summary ? `변경사항:\n${request.context.diff_summary}` : '',
    '',
    '검증 기준:',
    '1. 의도한 대로 동작하는가?',
    '2. 부작용은 없는가?',
    '3. 보안 문제는 없는가?',
    '',
    '응답 형식: APPROVE 또는 REJECT (사유)',
  ].filter(Boolean).join('\n')

  const result = await execute_gemini_oneshot(review_prompt, {
    account: reviewer_id === 'gemini_b' ? 'b' : 'a',
    timeout_ms: 60_000,
  })

  const approved = result.stdout.toUpperCase().includes('APPROVE')

  if (!approved) {
    // AI가 거부 → NotebookLM으로 2차 검증 (헌터 경유)
    const notebook_result = await request_notebooklm_verification(request)
    if (notebook_result.passed) {
      await log_approval(request, 'approved_after_notebooklm')
      return true
    }
    // 둘 다 거부 → 인간 승인으로 에스컬레이션
    return await request_human_approval(request, 30)
  }

  await log_approval(request, 'ai_approved')
  return true
}

async function request_human_approval(
  request: approval_request,
  timeout_minutes: number | null,
): Promise<boolean> {
  // Telegram으로 승인 요청 전송
  const message = format_approval_telegram(request)
  await send_telegram(message, 'approval')

  // 응답 대기
  const response = await wait_for_telegram_response(
    request.id,
    timeout_minutes ? timeout_minutes * 60 * 1000 : null,
  )

  if (response === null) {
    // 타임아웃
    if (request.risk_level === 'critical') {
      await log_approval(request, 'timeout_rejected')
      return false
    } else {
      // HIGH는 안전모드로 전환
      await enter_safe_mode()
      await log_approval(request, 'timeout_safe_mode')
      return false
    }
  }

  await log_approval(request, response ? 'human_approved' : 'human_rejected')
  return response
}
```

## Task API (헌터 통신)

```typescript
// src/gateway/task_api.ts

import { sanitize_task } from './sanitizer'

// 헌터가 폴링하는 엔드포인트
async function get_hunter_pending_tasks(req: Request, res: Response) {
  const pending = await load_tasks_for_agent('openclaw')

  // 개인정보 제거 (산이타이징)
  const sanitized = pending.map(task => sanitize_task(task))

  res.json({ tasks: sanitized })
}

// 헌터가 결과를 보내는 엔드포인트
async function submit_hunter_result(req: Request, res: Response) {
  const { id } = req.params
  const { status, output, files } = req.body

  // 결과 저장
  await update_task(id, {
    status: status === 'success' ? 'done' : 'blocked',
    output: {
      summary: output,
      files_created: files ?? [],
    },
    completed_at: new Date().toISOString(),
  })

  // 알림 전송
  const task = await load_task(id)
  await notify_task_complete(task)

  res.json({ ok: true })
}

// 헌터 heartbeat
let last_hunter_heartbeat: Date | null = null

async function hunter_heartbeat(req: Request, res: Response) {
  last_hunter_heartbeat = new Date()
  res.json({ ok: true, server_time: new Date().toISOString() })
}

// 헌터 연결 상태 확인 (Watchdog에서 호출)
function is_hunter_alive(): boolean {
  if (!last_hunter_heartbeat) return false
  const elapsed = Date.now() - last_hunter_heartbeat.getTime()
  return elapsed < 60_000  // 60초 이내 heartbeat
}
```

## 산이타이징 (개인정보 제거)

```typescript
// src/gateway/sanitizer.ts

import { load as load_yaml } from 'yaml'
import { readFileSync } from 'fs'

// config/personal_filter.yml 에서 패턴 로드
const filter_config = load_yaml(
  readFileSync('config/personal_filter.yml', 'utf-8')
)

function sanitize_task(task: any): any {
  const sanitized = structuredClone(task)

  // 텍스트 필드에서 개인정보 패턴 제거
  const text_fields = ['title', 'description', 'context']
  for (const field of text_fields) {
    if (sanitized[field]) {
      sanitized[field] = sanitize_text(sanitized[field])
    }
  }

  // 개인정보 관련 메타데이터 제거
  delete sanitized.requires_personal_info
  delete sanitized.personal_context

  return sanitized
}

function sanitize_text(text: string): string {
  let result = text

  for (const pattern of filter_config.patterns) {
    const regex = new RegExp(pattern.regex, 'gi')
    result = result.replace(regex, pattern.replacement ?? '[REDACTED]')
  }

  return result
}
```

```yaml
# config/personal_filter.yml

patterns:
  # 한국 이름 (2~4자 한글)
  - regex: "(이름|성명|본명)[:：]\\s*[가-힣]{2,4}"
    replacement: "[이름 제거됨]"

  # 전화번호
  - regex: "01[016789]-?\\d{3,4}-?\\d{4}"
    replacement: "[전화번호 제거됨]"

  # 이메일
  - regex: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}"
    replacement: "[이메일 제거됨]"

  # 주민번호
  - regex: "\\d{6}-?[1-4]\\d{6}"
    replacement: "[주민번호 제거됨]"

  # 주소
  - regex: "(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[시도]?\\s+[가-힣]+[시군구]"
    replacement: "[주소 제거됨]"

  # 계좌번호 (숫자 10~14자리)
  - regex: "\\d{3,4}-\\d{2,6}-\\d{2,6}"
    replacement: "[계좌 제거됨]"

  # 금액 (구체적 자산 정보)
  - regex: "(자산|현금|예금|보증금|연봉|월급)[:：]?\\s*[약~]?\\s*\\d+[만억천]"
    replacement: "[금융정보 제거됨]"
```
