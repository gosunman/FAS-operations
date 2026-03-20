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
| `briefing` | X | O | O |
| `approval_high` | O | O | X |
| `discovery` | O | O | O |
| `alert` / `blocked` | X | O | X |
| `crawl_result` | X | O | O |
| `agent_log` / `done` / `error` 등 | X | O | X |

> **헌터 알림**: 헌터의 모든 알림(LOGIN_REQUIRED, BLOCKED, 태스크 완료 등)은 Slack 전용. Telegram으로 전송하지 않음.

## 크롤링 결과 흐름 (Notion → Slack 링크)

`crawl_result` 이벤트는 특별한 라우팅을 따른다:

1. **Notion에 먼저 전송** → 원문 전체를 페이지로 저장, URL 반환
2. **Slack에 요약 + Notion 링크** → 200자 요약 + `📄 Notion에서 원문 보기`
3. Notion 실패 시 → Slack에 원문 그대로 전송 (폴백)

## Notion 속성

모든 페이지 생성 시 **Name (title) 속성만 사용**. 메시지 본문은 2000자 단위로 분할하여 paragraph 블록 생성.

## 폴백 로직

- Telegram 실패 시 → Slack `#alerts`로 폴백
- Slack 실패 시 → dual-route 이벤트만 Telegram 폴백 (slack-only 이벤트는 로그만)
- Notion 실패 시 → fire-and-forget (알림 전송 차단하지 않음)

## Resilient Sender 통합 (Phase 7-3)

`router.ts`에 `queue_dir` 옵션을 전달하면 네트워크 장애 시 자동 큐잉이 활성화된다.

```typescript
const router = create_notification_router(
  { telegram, slack, notion, queue_dir: './state/notification_queue' },
  { retry_interval_ms: 60_000, max_retry_count: 10 },
);

// Graceful shutdown 시 retry loop 정리
router.stop();

// Queue 상태 모니터링
router.get_queue_sizes(); // { telegram: 0, slack: 2, notion: 0 }
```

- 채널별 독립 큐 (`queue_dir/telegram/`, `slack/`, `notion/`)
- 네트워크 에러만 큐잉 (앱 에러는 즉시 throw)
- Notion은 URL 추출을 위해 직접 전송 시도 후 실패 시 resilient 큐잉
- `queue_dir` 미설정 시 기존 동작과 100% 호환
