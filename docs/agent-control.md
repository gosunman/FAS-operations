# 에이전트 제어 프로토콜

> 이 문서는 FAS의 핵심 — n8n/태스크 시스템이 AI CLI 도구를 **프로그래밍적으로 제어**하는 방법을 정의한다.

## 문제 정의

Claude Code, Gemini CLI는 터미널 CLI 도구다. n8n이나 태스크 시스템이 이들에게 명령을 보내고 결과를 받으려면 **중간 레이어**가 필요하다. 이것이 **Agent Wrapper**다.

## Agent Wrapper 아키텍처

```text
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
```

## 실행 모드

### Mode A: One-shot (비대화형)

단일 태스크를 독립적으로 실행. 컨텍스트 불필요한 작업에 사용.

```typescript
// src/agents/executor.ts

import { spawn } from 'child_process'

interface execution_result {
  exit_code: number
  stdout: string
  stderr: string
  duration_ms: number
}

// Claude Code one-shot 실행
async function execute_claude_oneshot(prompt: string, options?: {
  working_dir?: string
  timeout_ms?: number  // 기본 300_000 (5분)
  max_tokens?: number
}): Promise<execution_result> {
  const start = Date.now()
  const timeout = options?.timeout_ms ?? 300_000

  return new Promise((resolve, reject) => {
    const child = spawn('claude', [
      '--print',            // 비대화형 모드, 결과만 출력
      '--output-format', 'text',
      '-p', prompt,
    ], {
      cwd: options?.working_dir ?? process.cwd(),
      timeout,
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => { stdout += data.toString() })
    child.stderr.on('data', (data) => { stderr += data.toString() })

    child.on('close', (code) => {
      resolve({
        exit_code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        duration_ms: Date.now() - start,
      })
    })

    child.on('error', (err) => {
      reject(err)
    })
  })
}

// Gemini CLI one-shot 실행
async function execute_gemini_oneshot(prompt: string, options?: {
  account?: 'a' | 'b'
  timeout_ms?: number
}): Promise<execution_result> {
  const start = Date.now()
  const timeout = options?.timeout_ms ?? 300_000

  // Gemini CLI 프로필 선택 (계정 분리)
  const env = { ...process.env }
  if (options?.account === 'b') {
    env.GEMINI_PROFILE = 'account_b'
  }

  return new Promise((resolve, reject) => {
    const child = spawn('gemini', [
      '--non-interactive',
      prompt,
    ], {
      timeout,
      env,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => { stdout += data.toString() })
    child.stderr.on('data', (data) => { stderr += data.toString() })

    child.on('close', (code) => {
      resolve({
        exit_code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        duration_ms: Date.now() - start,
      })
    })

    child.on('error', reject)
  })
}
```

### Mode B: Interactive (대화형)

긴 개발 작업, 멀티스텝 태스크에 사용. tmux 세션 내에서 대화형으로 실행.

```typescript
// src/agents/interactive.ts

import { exec } from 'child_process'
import { promisify } from 'util'

const exec_async = promisify(exec)

// tmux 세션에 키 입력 전송
async function tmux_send(session: string, text: string): Promise<void> {
  // 특수문자 이스케이프
  const escaped = text.replace(/"/g, '\\"').replace(/\$/g, '\\$')
  await exec_async(`tmux send-keys -t ${session} "${escaped}" Enter`)
}

// tmux 세션의 현재 출력 캡처
async function tmux_capture(session: string, lines?: number): Promise<string> {
  const line_count = lines ?? 500
  const { stdout } = await exec_async(
    `tmux capture-pane -t ${session} -p -S -${line_count}`
  )
  return stdout.trim()
}

// 특정 패턴이 출력될 때까지 대기
async function tmux_wait_for_pattern(
  session: string,
  pattern: RegExp,
  timeout_ms: number = 600_000  // 10분
): Promise<string> {
  const start = Date.now()
  const poll_interval = 2_000  // 2초마다 체크

  while (Date.now() - start < timeout_ms) {
    const output = await tmux_capture(session)
    const match = output.match(pattern)
    if (match) {
      return output
    }
    await new Promise(r => setTimeout(r, poll_interval))
  }

  throw new Error(`Timeout waiting for pattern: ${pattern}`)
}

// 대화형 Claude Code에 태스크 전송 + 결과 대기
async function send_interactive_task(
  session: string,
  prompt: string,
  timeout_ms?: number,
): Promise<string> {
  // 시작 마커 삽입 (출력에서 결과 구간 식별용)
  const marker = `__FAS_TASK_${Date.now()}__`
  await tmux_send(session, `echo "${marker}_START"`)
  await new Promise(r => setTimeout(r, 500))

  // 프롬프트 전송
  await tmux_send(session, prompt)

  // 완료 패턴 대기
  // Claude Code는 작업 완료 후 프롬프트(`>`)로 돌아옴
  const output = await tmux_wait_for_pattern(
    session,
    /(\[DONE\]|\[BLOCKED\]|\[APPROVAL_NEEDED\]|>\s*$)/,
    timeout_ms,
  )

  // 마커 이후 출력만 추출
  const start_idx = output.indexOf(`${marker}_START`)
  if (start_idx >= 0) {
    return output.substring(start_idx).trim()
  }
  return output
}
```

## Agent Wrapper 메인 루프

```typescript
// src/agents/wrapper.ts

import { readdir, readFile, writeFile, rename } from 'fs/promises'
import { join } from 'path'
import { parse as yaml_parse } from 'yaml'

interface agent_wrapper_config {
  agent_id: string                    // 'claude' | 'gemini_a' | 'gemini_b'
  tmux_session: string
  mode: 'oneshot' | 'interactive'
  poll_interval_ms: number            // 기본 5_000 (5초)
  tasks_dir: string                   // 'tasks/'
  logs_dir: string
}

async function run_agent_wrapper(config: agent_wrapper_config): Promise<void> {
  const { agent_id, poll_interval_ms, tasks_dir } = config

  console.log(`[${agent_id}] Agent Wrapper 시작. 폴링 주기: ${poll_interval_ms}ms`)

  while (true) {
    try {
      // 1. pending 태스크 중 자신에게 배정된 것 찾기
      const pending_dir = join(tasks_dir, 'pending')
      const files = await readdir(pending_dir).catch(() => [])

      for (const file of files) {
        if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue

        const file_path = join(pending_dir, file)
        const content = await readFile(file_path, 'utf-8')
        const task = yaml_parse(content)

        // 자신에게 배정된 태스크인지 확인
        if (task.assigned_to !== agent_id) continue

        console.log(`[${agent_id}] 태스크 발견: ${task.id} - ${task.title}`)

        // 2. in_progress로 이동
        const in_progress_path = join(tasks_dir, 'in_progress', file)
        await rename(file_path, in_progress_path)

        // 3. 태스크 실행
        const result = await execute_task(config, task)

        // 4. 결과 기록
        task.status = result.success ? 'done' : 'failed'
        task.output = {
          summary: result.summary,
          files_created: result.files_created ?? [],
          files_modified: result.files_modified ?? [],
          stdout: result.stdout.substring(0, 10_000),  // 10KB 제한
        }
        task.completed_at = new Date().toISOString()

        // 5. 완료 디렉토리로 이동
        const done_dir = result.success ? 'done' : 'blocked'
        const done_path = join(tasks_dir, done_dir, file)
        await writeFile(done_path, yaml_stringify(task))

        // in_progress에서 삭제
        await unlink(in_progress_path).catch(() => {})

        // 6. 알림 전송
        await notify_task_complete(task, result)
      }
    } catch (err) {
      console.error(`[${agent_id}] 폴링 에러:`, err)
    }

    // 대기
    await new Promise(r => setTimeout(r, poll_interval_ms))
  }
}

async function execute_task(
  config: agent_wrapper_config,
  task: any,
): Promise<{
  success: boolean
  summary: string
  stdout: string
  files_created?: string[]
  files_modified?: string[]
}> {
  // 위험도 확인 → 승인 필요 시 Gateway에 요청
  if (task.risk_level === 'high' || task.risk_level === 'critical') {
    const approved = await request_approval(task)
    if (!approved) {
      return { success: false, summary: '승인 거부됨', stdout: '' }
    }
  }

  // 프롬프트 생성
  const prompt = build_prompt(task)

  // 실행 모드에 따라 분기
  if (config.mode === 'oneshot') {
    const result = await execute_claude_oneshot(prompt, {
      working_dir: task.working_dir,
      timeout_ms: task.timeout_ms ?? 300_000,
    })
    return {
      success: result.exit_code === 0,
      summary: extract_summary(result.stdout),
      stdout: result.stdout,
    }
  } else {
    const output = await send_interactive_task(
      config.tmux_session,
      prompt,
      task.timeout_ms,
    )
    return {
      success: !output.includes('[BLOCKED]'),
      summary: extract_summary(output),
      stdout: output,
    }
  }
}

function build_prompt(task: any): string {
  return [
    `## 태스크: ${task.title}`,
    '',
    task.description,
    '',
    '## 규칙',
    '- 완료 시 [DONE]을 출력하세요',
    '- 막히면 [BLOCKED] {사유}를 출력하세요',
    '- 승인 필요 시 [APPROVAL_NEEDED] {내용}을 출력하세요',
    '',
    task.context ? `## 컨텍스트\n${task.context}` : '',
  ].filter(Boolean).join('\n')
}
```

## 에이전트별 제어 방식

### Claude Code

| 모드 | 명령어 | 용도 |
| --- | --- | --- |
| One-shot | `claude --print -p "prompt"` | 독립적 단일 태스크 (리뷰, 분석, 문서 생성) |
| Interactive | tmux 세션 내 대화 | 장기 개발 작업, 멀티 파일 수정, TDD |

**주의사항:**
- `--print` 모드에서는 도구 사용이 제한될 수 있음 → 파일 수정이 필요한 작업은 interactive 모드
- OAuth 세션 만료 시 자동 재인증 필요 → Watchdog이 감지

### Gemini CLI

| 모드 | 명령어 | 용도 |
| --- | --- | --- |
| One-shot | `gemini --non-interactive "prompt"` | 리서치, 검색, 팩트체크 |
| Batch | 여러 프롬프트를 순차 실행 | 크롤링 결과 분석 |

**계정 분리:**
- Account A (리서치): `GEMINI_PROFILE=account_a`
- Account B (검증): `GEMINI_PROFILE=account_b`

### OpenClaw (헌터)

OpenClaw는 직접 제어하지 않음. Task API를 통해 간접 제어.

```text
캡틴 (Task API) → HTTP → 헌터 (Agent Wrapper) → OpenClaw CLI/API
```

헌터의 Agent Wrapper가 Task API를 폴링하고, OpenClaw에게 작업을 전달.
상세는 [hunter-protocol.md](hunter-protocol.md) 참조.

## 에이전트 생명주기

```text
                    ┌──────────┐
                    │  STOPPED │
                    └────┬─────┘
                         │ start_all.sh / launchd
                         ▼
                    ┌──────────┐
              ┌─────│   IDLE   │←────────────────┐
              │     └────┬─────┘                  │
              │          │ 태스크 배정              │
              │          ▼                         │
              │     ┌──────────┐                   │
              │     │   BUSY   │───────────────────┤ 태스크 완료
              │     └────┬─────┘                   │
              │          │ 에러 발생                │
              │          ▼                         │
              │     ┌──────────┐                   │
              │     │  ERROR   │───────────────────┘ 자동 재시작 (3회까지)
              │     └────┬─────┘
              │          │ 3회 실패
              │          ▼
              │     ┌──────────┐
              └────→│  STOPPED │ → Telegram 긴급 알림
                    └──────────┘
```

## 에이전트 등록 & 디스커버리

```typescript
// src/agents/registry.ts

interface registered_agent {
  id: string
  status: 'idle' | 'busy' | 'error' | 'stopped'
  current_task_id?: string
  last_heartbeat: string
  tasks_completed: number
  tasks_failed: number
  uptime_seconds: number
}

// state/agent_status.json 파일에 저장
// Watchdog이 5초마다 업데이트
// n8n이 이 파일을 읽어 태스크 배정 결정
```

## 크래시 복구

```bash
#!/bin/bash
# scripts/agent_runner.sh — 에이전트 자동 재시작 래퍼

AGENT_ID=$1
MAX_RETRIES=3
RETRY_COUNT=0
RETRY_DELAY=5

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  echo "[$(date)] Starting agent: $AGENT_ID (attempt $((RETRY_COUNT+1))/$MAX_RETRIES)"

  # Agent Wrapper 실행
  node dist/agents/wrapper.js --agent-id "$AGENT_ID"
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date)] Agent $AGENT_ID exited normally"
    break
  fi

  RETRY_COUNT=$((RETRY_COUNT+1))
  echo "[$(date)] Agent $AGENT_ID crashed (exit: $EXIT_CODE). Retry in ${RETRY_DELAY}s..."
  sleep $RETRY_DELAY
  RETRY_DELAY=$((RETRY_DELAY * 2))  # 지수 백오프
done

if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
  echo "[$(date)] Agent $AGENT_ID failed after $MAX_RETRIES retries. Sending alert..."
  # Telegram 긴급 알림
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "text=🚨 Agent ${AGENT_ID} crashed after ${MAX_RETRIES} retries. Manual intervention needed."
fi
```
