# Watchdog (`src/watchdog/`)

시스템 감시 모듈 — 프로세스 상태, 헌터 연결, 리소스 사용량, 활동 로그, 기기 상태 분류, 일일 인프라 리포트를 모니터링.

## 모듈 구성

| 파일 | 역할 | 추가 시점 |
|------|------|----------|
| `output_watcher.ts` | tmux 세션 출력 감시 — `[BLOCKED]`, `[ERROR]` 등 키워드 감지 시 알림. Claude AI 추적 연동 | Phase 7 |
| `hunter_monitor.ts` | 헌터 하트비트 감시 — 2분(WARNING) / 5분(ALERT) 임계값으로 상태 전이 | Phase 7 |
| `resource_monitor.ts` | CPU/RAM/디스크/GPU/온도/네트워크 수집 + AI 사용량 추적 + 통합 모니터 | Phase 7 → Plan C 확장 |
| `time_classifier.ts` | 기기 상태 분류 (working/idle/down) — 프로세스 활성 여부 + CPU/heartbeat 기반 | Plan C |
| `daily_aggregator.ts` | 일일 인프라 리포트 집계 — 스냅샷 통계 + 병목 분석 + Telegram 포맷 | Plan C |
| `activity_logger.ts` | SQLite 기반 감사 추적 로그 (`state/activity.sqlite`) | Phase 7 |
| `activity_integration.ts` | 서비스 간 활동 로그 통합 훅 — AI 사용량 추적 연동 | Phase 7 → Plan C 확장 |
| `alert_integration.ts` | crash recovery / Telegram 알림 통합 | Phase 7 |
| `crash_recovery.ts` | 프로세스 크래시 감지 + 복구 | Phase 7 |
| `file_logger.ts` | 파일 기반 로거 | Phase 7 |
| `local_queue.ts` | 네트워크 단절 시 SQLite 백업 큐 — 복구 시 자동 재전송 | Phase 7 |

## 모듈 의존 관계

```
output_watcher.ts ─────────────────────────────────┐
  (Claude [DONE]/[ERROR] 패턴 감지)                 │
                                                    ▼
resource_monitor.ts ──────────────────────► AIUsageTracker
  parse_cpu_usage()                          report_success/failure
  parse_memory_usage()                       (claude, chatgpt, gemini)
  parse_disk_usage()                              │
  parse_gpu_usage()     ← Plan C                  │
  parse_temperature()   ← Plan C                  │
  parse_network_throughput() ← Plan C             │
  │                                               │
  │ take_snapshot() / collect_snapshot()           │
  ▼                                               ▼
time_classifier.ts          activity_integration.ts
  classify()                  log_ai_call()
  get_summary()               → SQLite + AIUsageTracker
  │                                    │
  ▼                                    │
daily_aggregator.ts ◄──────────────────┘
  aggregate_snapshots()
  analyze_bottlenecks()
  build_daily_report()
  format_infra_report_telegram()
  │
  ▼
captain/morning_briefing.ts
  get_infra_report() 콜백 → 모닝 브리핑에 포함
```

## Output Watcher

`config/agents.yml`에서 captain 디바이스의 tmux 세션 목록을 동적 로딩하여 출력을 감시한다. Standalone 모드에서도 동일하게 `agents_config.ts`를 사용.

| 패턴 | 동작 | AI 추적 |
|------|------|---------|
| `[APPROVAL_NEEDED]` | Telegram 긴급 알림 | - |
| `[BLOCKED]` | Telegram 긴급 알림 | - |
| `[MILESTONE]` | Slack 알림 | - |
| `[DONE]` | Slack 알림 | Claude 성공 보고 |
| `[ERROR]` | Slack 경고 | Claude 실패 보고 |

> 감시 대상 세션은 `config/agents.yml`에서 동적 로딩 + 실제 존재하는 tmux 세션만 자동 필터링. `src/shared/agents_config.ts` 참조.

## Hunter Monitor

헌터 머신의 하트비트 파일(`state/hunter_heartbeat.json`) 수정 시간을 30초 간격으로 체크.

| 상태 | 조건 | 동작 |
|------|------|------|
| `healthy` | 하트비트 < 2분 전 | 정상 |
| `warning` | 2분~5분 | 로그 경고 |
| `alert` | > 5분 | Telegram 알림 |

## Resource Monitor + AI Usage Tracker

### 시스템 리소스 모니터 (`create_resource_monitor`)
주기적으로 macOS 시스템 리소스를 체크하여 임계값 초과 시 알림.
- CPU: `top -l 1 -n 0` 파싱
- RAM: `vm_stat` + `sysctl -n hw.memsize` 파싱
- Disk: `df -g /` 파싱
- **GPU** (Plan C): `ioreg -r -d 1 -c IOGPUDevice` — Apple Silicon gpu-core-utilization (millipercent → percent)
- **온도** (Plan C): `ioreg -r -d 1 -c AppleARMIODevice` — die-temp (centi-degrees → Celsius)
- **네트워크** (Plan C): `netstat -ib` — 인터페이스별 bytes sent/recv 합산 (부팅 이후 누적, 델타는 호출자가 계산)
- 임계값: CPU > 90% (sustained 3회), RAM > 85%, Disk > 90%

### Telegram 알림 핸들러 (`create_telegram_alert_handler`)
Resource Monitor의 `on_alert` 콜백으로 사용. CPU sustained 체크, 쿨다운(5분), severity 분류.

### AI 사용량 추적기 (`create_ai_usage_tracker`)
프로바이더별 (Claude/Gemini/ChatGPT) 요청 사용량 추적.
- `report_success(provider)` / `report_failure(provider, reason)` — 성공/실패 기록
- 일일 카운터 자동 리셋 (날짜 변경 감지)
- 플랜 한도 대비 사용률(%) 추정 (기본: Claude 200, Gemini 300, ChatGPT 100 req/day)
- 알림 콜백: 70% warning, 90% critical (severity 전환 시에만 발생, 중복 방지)

### 통합 모니터 (`create_unified_monitor`)
시스템 리소스 + AI 사용량을 하나의 인터페이스로 통합.
- `collect_snapshot()` — ResourceSnapshot 반환 (GPU/온도/네트워크 포함)
- `check_thresholds()` — 시스템 + AI 임계값 위반 목록
- `get_ai_usage_summary()` — 프로바이더별 상세 통계
- `get_ai_tracker()` — 내부 AIUsageTracker 직접 접근 (외부 모듈에서 report_success/failure 호출용)
- `start(interval_ms)` / `stop()` — 주기적 모니터링 루프

## Time Classifier (Plan C)

기기 상태를 `working` / `idle` / `down`으로 분류하고 히스토리를 추적.

### 분류 기준

| 기기 | working | idle | down |
|------|---------|------|------|
| captain | 프로세스(claude, node) 실행 중 + CPU > 10% | 프로세스 실행 중 + CPU ≤ 10% | 프로세스 미실행 |
| hunter | Gateway heartbeat < 2분 | - (working으로 간주) | heartbeat 없음 또는 2분+ |

### API

```typescript
import { create_time_classifier } from './time_classifier.js';

const classifier = create_time_classifier({
  device: 'captain',
  cpu_idle_threshold: 10,        // default: 10%
  process_names: ['claude', 'node'], // default per device
  check_interval_ms: 60_000,     // default: 1분
});

classifier.start();              // 주기적 분류 시작
const result = await classifier.classify(); // { state, cpu_percent, process_active }
const history = classifier.get_history();   // MachineTimeEntry[]
const summary = classifier.get_summary();   // { working_ms, idle_ms, down_ms }
classifier.stop();               // 종료 (마지막 상태 duration 기록)
classifier.reset();              // 히스토리 초기화
```

## Daily Aggregator (Plan C)

ResourceSnapshot 배열과 시간 분류 데이터를 일일 통계로 집계하고, 병목을 분석하여 Telegram 메시지로 포맷.

### 함수 목록

| 함수 | 입력 | 출력 |
|------|------|------|
| `format_duration(ms)` | milliseconds | `"18h 30m"`, `"45m"`, `"0m"` |
| `format_bytes(bytes)` | bytes | `"2.3GB"`, `"150.5MB"`, `"1.2KB"` |
| `aggregate_snapshots(device, date, snapshots, time_summary)` | ResourceSnapshot[] + TimeSummary | DailyMachineStats |
| `analyze_bottlenecks(machines, ai_stats)` | DailyMachineStats[] + DailyAIStats | BottleneckAlert[] |
| `build_daily_report(date, machines, ai_stats)` | 날짜 + 기기 통계 + AI 통계 | DailyInfraReport |
| `format_infra_report_telegram(report)` | DailyInfraReport | 한국어 이모지 Telegram 메시지 |

### 병목 감지 규칙

| 유형 | 조건 | severity |
|------|------|----------|
| `underutilized` | idle 비율 > 60% | warning |
| `cpu_bottleneck` | CPU 평균 > 70% | warning |
| `api_limit` | Claude throttle > 3회 | warning |
| `overheating` | CPU 또는 GPU 최대 온도 > 90°C | critical |
| `memory_pressure` | RAM 최대/총 > 85% | warning |

### 새로운 병목 규칙 추가 방법

`analyze_bottlenecks()` 함수 내에 새 조건을 추가:

```typescript
// Example: GPU bottleneck detection
if (m.gpu_avg > 80) {
  alerts.push({
    type: 'gpu_bottleneck',
    device: m.device,
    message: `${m.device} GPU avg ${m.gpu_avg.toFixed(0)}%`,
    severity: 'warning',
  });
}
```

`BottleneckAlert.type`의 유니온 타입(`src/shared/types.ts`)에 새 유형을 추가해야 한다.

## Activity Integration (Plan C 확장)

서비스 훅 레이어. `create_activity_hooks(logger, ai_tracker?)` 팩토리가 반환하는 훅 함수들:

| 훅 | 호출 위치 | 기록 대상 |
|----|----------|----------|
| `log_task_created` | gateway/server.ts | ActivityLogger |
| `log_task_completed` | gateway/server.ts | ActivityLogger |
| `log_task_failed` | gateway/server.ts | ActivityLogger |
| `log_hunter_heartbeat` | gateway/server.ts | ActivityLogger |
| `log_notification_sent` | notification/router.ts | ActivityLogger |
| `log_telegram_command` | captain/telegram_commands.ts | ActivityLogger |
| `log_error` | 각종 에러 핸들러 | ActivityLogger |
| `log_ai_call` | gateway, task_executor, output_watcher | ActivityLogger **+ AIUsageTracker** |

`log_ai_call`은 Plan C에서 추가된 훅으로, `ai_tracker` 파라미터가 주입된 경우 `report_success()`/`report_failure()`를 동시 호출하여 AI 사용량을 실시간 갱신한다.

### 새로운 메트릭 추가 방법

1. `resource_monitor.ts`에 파서 함수 추가 (e.g., `parse_new_metric()`)
2. `take_snapshot()` / `collect_snapshot()` 반환값에 새 필드 포함
3. `src/shared/types.ts`의 `ResourceSnapshot` 타입에 optional 필드 추가
4. `daily_aggregator.ts`의 `aggregate_snapshots()`에서 새 필드 집계 로직 추가
5. `DailyMachineStats` 타입에 집계 결과 필드 추가
6. `format_infra_report_telegram()`에서 새 메트릭 표시

## Activity Logger

모든 태스크 상태 변경, 알림 전송, 승인 결과 등을 SQLite에 기록하여 감사 추적 가능.
