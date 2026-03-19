# Notification Module (`src/notification/`)

통합 알림 시스템 — Telegram, Slack, Notion을 통해 주인님에게 알림 전송.

## 모듈 구성

| 파일 | 역할 |
|------|------|
| `router.ts` | 통합 라우터 — 이벤트 타입에 따라 Telegram/Slack/Notion으로 자동 라우팅. 크로스 채널 폴백 로직 포함 |
| `telegram.ts` | Telegram 아웃바운드 클라이언트 — 긴급 알림, 승인 요청, 브리핑 전송 |
| `slack.ts` | Slack 클라이언트 — 채널별 업무 소통, 로그, 보고 |
| `notion.ts` | Notion 클라이언트 — 보고서 페이지 생성, 태스크 결과 백업, 데일리 브리핑 |
| `index.ts` | 모듈 re-export |

## 라우팅 매트릭스

| 이벤트 | Telegram | Slack | Notion |
|--------|----------|-------|--------|
| `briefing` | O | O | O |
| `approval_high` | O | O | X |
| `alert` / `blocked` | O | O | X |
| `crawl_result` | X | O | O |
| `agent_log` / `done` / `error` 등 | X | O | X |

## 폴백 로직

- Telegram 실패 시 → Slack `#alerts`로 폴백
- Slack 실패 시 → dual-route 이벤트만 Telegram 폴백 (slack-only 이벤트는 로그만)
- Notion 실패 시 → fire-and-forget (알림 전송 차단하지 않음)
