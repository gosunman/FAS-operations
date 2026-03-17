# 감시 & 리소스 모니터링

## Watchdog 데몬

캡틴과 헌터 각각에서 실행. 에이전트 프로세스, 시스템 리소스, 네트워크 상태를 감시.

### 감시 항목

```yaml
checks:
  # 5초마다
  agent_heartbeat:
    interval: 5s
    check: state/agent_status.json의 각 에이전트 last_heartbeat
    warn_after: 300s    # 5분 무응답 → 경고
    critical_after: 900s # 15분 무응답 → 긴급

  # 1분마다
  tmux_sessions:
    interval: 60s
    check: tmux has-session -t {session_name}
    on_missing: 자동 재시작 시도

  # 5분마다
  gateway_health:
    interval: 300s
    check: curl http://localhost:3100/api/health
    on_fail: 자동 재시작

  # 30분마다
  system_resources:
    interval: 1800s
    cpu_warn: 90%       # 3회 연속 초과 시 경고
    ram_warn: 85%
    disk_warn: 10GB     # 잔여 용량

  # 1시간마다
  token_usage:
    interval: 3600s
    check: AI 서비스별 사용량 추적

  # 캡틴 전용: 헌터 상태
  hunter_connection:
    interval: 60s
    check: last_hunter_heartbeat (Task API)
    warn_after: 120s
```

### 구현

```typescript
// src/watchdog/process_monitor.ts

import { exec } from 'child_process'
import { promisify } from 'util'

const exec_async = promisify(exec)

interface health_status {
  agent_id: string
  tmux_alive: boolean
  last_heartbeat: string
  uptime_seconds: number
  status: 'healthy' | 'warning' | 'critical' | 'dead'
}

// tmux 세션 존재 확인
async function check_tmux_session(session: string): Promise<boolean> {
  try {
    await exec_async(`tmux has-session -t ${session} 2>/dev/null`)
    return true
  } catch {
    return false
  }
}

// 시스템 리소스 수집
async function collect_system_resources(): Promise<{
  cpu_percent: number
  ram_used_gb: number
  ram_total_gb: number
  disk_free_gb: number
}> {
  // CPU
  const { stdout: cpu_out } = await exec_async(
    "top -l 1 -n 0 | grep 'CPU usage' | awk '{print $3}' | tr -d '%'"
  )

  // RAM
  const { stdout: ram_out } = await exec_async(
    "vm_stat | awk '/Pages active/ {active=$3} /Pages wired/ {wired=$4} END {printf \"%.1f\", (active+wired)*4096/1073741824}'"
  )

  // 디스크
  const { stdout: disk_out } = await exec_async(
    "df -g / | tail -1 | awk '{print $4}'"
  )

  return {
    cpu_percent: parseFloat(cpu_out.trim()),
    ram_used_gb: parseFloat(ram_out.trim()),
    ram_total_gb: 36,  // M4 Ultra (config에서 읽어야 함)
    disk_free_gb: parseFloat(disk_out.trim()),
  }
}

// 자동 재시작
async function restart_agent(agent_id: string, session: string): Promise<boolean> {
  console.log(`[watchdog] Restarting agent: ${agent_id}`)
  try {
    // 기존 세션 종료 (있으면)
    await exec_async(`tmux kill-session -t ${session} 2>/dev/null`).catch(() => {})

    // 새 세션 시작
    await exec_async(
      `tmux new-session -d -s ${session} "bash scripts/agent_runner.sh ${agent_id}"`
    )

    return true
  } catch (err) {
    console.error(`[watchdog] Failed to restart ${agent_id}:`, err)
    return false
  }
}
```

## AI 토큰 사용량 추적

### 목표

구독 플랜의 토큰을 **기간 내 최대한 활용**. 남으면 추가 태스크 배정, 부족하면 알림.

### 추적 방식

```typescript
// src/watchdog/token_tracker.ts

interface token_usage {
  service: 'claude' | 'gemini_a' | 'gemini_b' | 'chatgpt'
  date: string
  tasks_executed: number
  estimated_tokens_used: number
  plan_limit: number | null         // null = 무제한 (구독)
  plan_period: 'daily' | 'monthly'
}

// Claude Max: 토큰 제한은 없지만 rate limit 있음
// → 실행한 태스크 수와 소요 시간으로 추적
// → rate limit에 여유 있으면 추가 태스크 배정

// Gemini Pro: 분당/일일 요청 제한
// → API 호출 횟수 추적

// ChatGPT Pro (OpenClaw): 웹 사용이라 정확한 추적 어려움
// → 헌터의 태스크 수로 간접 추적

async function check_token_utilization(): Promise<{
  service: string
  utilization_percent: number
  recommendation: 'add_tasks' | 'normal' | 'slow_down' | 'upgrade_needed'
}[]> {
  const today = get_today_usage()

  return today.map(usage => {
    const util = usage.plan_limit
      ? (usage.estimated_tokens_used / usage.plan_limit) * 100
      : estimate_rate_utilization(usage)

    let recommendation: string
    if (util < 50) recommendation = 'add_tasks'       // 활용도 낮음 → 더 시켜
    else if (util < 80) recommendation = 'normal'
    else if (util < 95) recommendation = 'slow_down'   // 한도 임박
    else recommendation = 'upgrade_needed'              // 한도 초과 임박

    return { service: usage.service, utilization_percent: util, recommendation }
  })
}
```

### 토큰 활용 최적화

```text
활용도 < 50% (태스크 추가 배정):
  1. 캐시플로우 프로젝트 리서치 추가
  2. 기존 코드 리팩토링/개선
  3. 문서 품질 향상
  4. 추가 교차 검증 실행
  5. 미래 태스크 선행 리서치

활용도 > 90% (절약 모드):
  1. 단순 작업 우선 (토큰 소모 적은)
  2. 교차 검증 스킵 (LOW 위험도)
  3. Slack #alerts로 보고

활용도 > 95% (업그레이드 제안):
  1. Telegram으로 주인님에게 보고
  2. 구체적 업그레이드 제안
     "Claude Max → Claude Max+로 업그레이드 시 월 $X 추가, 토큰 Y% 증가"
```

## 리소스 모니터링 알림

```typescript
// src/watchdog/alert_manager.ts

async function check_and_alert(): Promise<void> {
  const resources = await collect_system_resources()
  const tokens = await check_token_utilization()

  // RAM 경고
  const ram_percent = (resources.ram_used_gb / resources.ram_total_gb) * 100
  if (ram_percent > 85) {
    await send_telegram(
      `⚠️ 캡틴 RAM 사용량 ${ram_percent.toFixed(0)}%\n`
      + `사용: ${resources.ram_used_gb.toFixed(1)}GB / ${resources.ram_total_gb}GB\n`
      + `조치: 불필요한 프로세스 확인 필요`,
      'alert'
    )
  }

  // 디스크 경고
  if (resources.disk_free_gb < 10) {
    await send_telegram(
      `⚠️ 캡틴 디스크 잔여 ${resources.disk_free_gb}GB\n`
      + `조치: 로그 정리 또는 외장하드 연결 필요`,
      'alert'
    )
  }

  // 토큰 활용도
  for (const t of tokens) {
    if (t.recommendation === 'upgrade_needed') {
      await send_telegram(
        `📊 ${t.service} 토큰 활용도 ${t.utilization_percent.toFixed(0)}%\n`
        + `플랜 업그레이드를 고려해주세요.`,
        'alert'
      )
    } else if (t.recommendation === 'add_tasks') {
      // 태스크 자동 추가 (Slack으로만 알림)
      await send_slack('#fas-general',
        `💡 ${t.service} 활용도 ${t.utilization_percent.toFixed(0)}% — 추가 태스크 배정 중`
      )
      await assign_bonus_tasks(t.service)
    }
  }
}
```

## 로그 관리

```yaml
log_retention:
  agent_logs: 30d       # 30일 후 자동 삭제
  approval_logs: forever # 영구 보존
  resource_logs: 90d
  token_logs: forever
  crawl_results: forever

log_format:
  # JSON Lines (.jsonl)
  example: |
    {"ts":"2026-03-17T14:00:00+09:00","level":"info","agent":"claude","task":"task_001","action":"execute","detail":"시작"}
    {"ts":"2026-03-17T14:05:23+09:00","level":"info","agent":"claude","task":"task_001","action":"complete","detail":"성공"}

log_rotation:
  max_size: 100MB       # 파일당 최대 크기
  compress: true        # 오래된 로그 gzip 압축
```
