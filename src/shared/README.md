# Shared Types (`src/shared/`)

캡틴, 헌터, 게이트웨이, 알림 모듈이 공유하는 TypeScript 타입 정의.

## 파일 구성

| 파일 | 용도 |
|------|------|
| `types.ts` | 모든 공유 타입 정의 |

## 주요 타입

### Notification

| 타입 | 설명 |
|------|------|
| `NotificationLevel` | `'info' \| 'approval' \| 'alert' \| 'briefing' \| 'critical'` |
| `SlackChannel` | Slack 채널명 리터럴 (`#fas-general`, `#captain-logs`, `#alerts` 등) |
| `NotificationEventType` | 이벤트 타입 (`agent_log`, `crawl_result`, `approval_mid`, `briefing` 등 11종) |
| `DeviceName` | `'captain' \| 'hunter'` |
| `NotificationEvent` | 알림 이벤트 (type, message, device, severity?, metadata?) |
| `NotificationResult` | 전송 결과 (channel, success, attempts, error?, url?) — `url`은 Notion 페이지 URL |

### Task

| 타입 | 설명 |
|------|------|
| `Task` | 태스크 (id, title, action, assigned_to, status, risk_level 등) |
| `TaskStatus` | `'pending' \| 'in_progress' \| 'done' \| 'blocked' \| 'quarantined'` |

### Cross-Approval

| 타입 | 설명 |
|------|------|
| `CrossApprovalResult` | Gemini CLI 교차 승인 결과 (approved, reason, responded_at) |

### Error

| 타입 | 설명 |
|------|------|
| `FASError` | 커스텀 에러 클래스 (code, message, status_code) |
