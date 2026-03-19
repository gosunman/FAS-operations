# Watchdog (`src/watchdog/`)

시스템 감시 모듈 — 프로세스 상태, 헌터 연결, 리소스 사용량, 활동 로그를 모니터링.

## 모듈 구성

| 파일 | 역할 |
|------|------|
| `output_watcher.ts` | tmux 세션 출력 감시 — `[BLOCKED]`, `[ERROR]` 등 키워드 감지 시 알림 |
| `hunter_monitor.ts` | 헌터 하트비트 감시 — 2분(WARNING) / 5분(ALERT) 임계값으로 상태 전이 |
| `resource_monitor.ts` | CPU/메모리/디스크 사용량 모니터링 (2분 간격) |
| `activity_logger.ts` | SQLite 기반 감사 추적 로그 (`state/activity.sqlite`) |
| `local_queue.ts` | 네트워크 단절 시 SQLite 백업 큐 — 복구 시 자동 재전송 |

## Output Watcher

`fas-claude` tmux 세션을 감시하여 캡틴 출력에서 특정 패턴을 감지한다.

| 패턴 | 동작 |
|------|------|
| `[APPROVAL_NEEDED]` | Telegram 긴급 알림 |
| `[BLOCKED]` | Telegram 긴급 알림 |
| `[MILESTONE]` | Slack 알림 |
| `[DONE]` | Slack 알림 |
| `[ERROR]` | Slack 경고 |

> 감시 대상 세션은 `main.ts`에서 지정. 존재하지 않는 세션을 감시하면 crash 알림 폭주 위험.

## Hunter Monitor

헌터 머신의 하트비트 파일(`state/hunter_heartbeat.json`) 수정 시간을 30초 간격으로 체크.

| 상태 | 조건 | 동작 |
|------|------|------|
| `healthy` | 하트비트 < 2분 전 | 정상 |
| `warning` | 2분~5분 | 로그 경고 |
| `alert` | > 5분 | Telegram 알림 |

## Resource Monitor

2분 간격으로 시스템 리소스를 체크하여 임계값 초과 시 알림.

## Activity Logger

모든 태스크 상태 변경, 알림 전송, 승인 결과 등을 SQLite에 기록하여 감사 추적 가능.
