# 소통 채널 명세

## 채널 역할 분담

| 채널 | 용도 | 수신 디바이스 | 알림 소리 |
| --- | --- | --- | --- |
| **Telegram** | 긴급 알림, HIGH/CRITICAL 승인 | Galaxy Watch (진동) + Fold | O (유일) |
| **Slack** | 업무 소통, 로그, MID 승인, 일반 보고 | Fold | X (무음) |
| **Notion** | 보고서, 긴 문서, 리서치 결과 | Fold (URL) | X |

## Telegram Bot

### 봇 구성 (에이전트별 격리)

| 봇 | 이름 | 용도 | 환경변수 (토큰) | 환경변수 (Chat ID) |
|---|------|------|-----------------|-------------------|
| **캡틴** | `captain_6239_bot` | 긴급 알림, 승인 요청, 브리핑 | `TELEGRAM_BOT_TOKEN` (캡틴 .env) | `TELEGRAM_CHAT_ID` |
| **헌터** | `hunter_6239_bot` | 헌터 알림, LOGIN_REQUIRED, 태스크 보고 | `HUNTER_TELEGRAM_BOT_TOKEN` (헌터 .env) | `HUNTER_TELEGRAM_CHAT_ID` |

> Chat ID는 동일 (주인님의 Telegram 계정). 봇 토큰만 별도.
> 헌터 봇이 탈취되어도 캡틴 봇은 안전.

### 설정 (캡틴)

```yaml
bot_name: captain_6239_bot
token_env: TELEGRAM_BOT_TOKEN
chat_id_env: TELEGRAM_CHAT_ID
```

### 메시지 유형

| 유형 | 발송 조건 | Watch 진동 | 응답 필요 |
| --- | --- | --- | --- |
| APPROVAL_HIGH | HIGH 위험도 승인 요청 | O (반복) | O (yes/no) |
| APPROVAL_CRITICAL | CRITICAL 위험도 승인 요청 | O (연속) | O (필수) |
| ALERT | 에이전트 크래시, 리소스 부족 | O (연속) | X |
| MORNING_BRIEFING | 매일 07:30 | O | X |
| DEADLINE_REMINDER | 마감 임박 (D-7, D-3) | O | X |
| HUNTER_COMMAND | `/hunter {명령}` 응답 | X | X |

### Bot 커맨드

```text
/status          — 전체 시스템 상태
/agents          — 에이전트별 상태
/approve {id}    — 승인
/reject {id}     — 거부
/pause           — 전체 시스템 일시 중지
/resume          — 시스템 재개
/sleep           — 강제 SLEEP 모드
/awake           — 강제 AWAKE 모드
/hunter {명령}   — 헌터에게 추상적 업무 명령
/cost            — 오늘 비용 현황
```

### Telegram 인바운드 명령 (Command Listener)

아웃바운드 알림과 별도로, `src/captain/telegram_commands.ts`가 Telegram long polling(`getUpdates`)으로 주인님의 명령을 수신한다. 캡틴 `main.ts`에서 Gateway와 함께 기동.

**지원 명령:**

| 명령 | 동작 |
|------|------|
| `/hunter {명령}` | 헌터에게 chatgpt_task 태스크 생성 |
| `/captain {명령}` | 캡틴 태스크 생성 |
| `/crawl {URL}` | 헌터에게 web_crawl 태스크 생성 |
| `/research {주제}` | 헌터에게 deep_research 태스크 생성 |
| `/status` | 태스크 통계 응답 |
| `/tasks` | 대기중 태스크 목록 (최대 10건) |
| `/cancel {id}` | 태스크 취소 (blocked 처리) |
| (일반 텍스트) | 기본적으로 `/hunter`와 동일 처리 |

**보안:** `config.chat_id`와 일치하는 채팅만 수락. 미인가 채팅은 경고 로그 후 무시.

**기존 아웃바운드 모듈과의 분리:** `telegram.ts`(아웃바운드, `polling: false`)와 충돌 없도록 native `fetch`로 구현.

### 구현

```typescript
// src/notification/telegram_bot.ts

import TelegramBot from 'node-telegram-bot-api'

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, { polling: true })
const CHAT_ID = process.env.TELEGRAM_CHAT_ID!

// 메시지 전송
async function send_telegram(
  text: string,
  type: 'info' | 'approval' | 'alert' | 'briefing',
): Promise<number> {
  const message = await bot.sendMessage(CHAT_ID, text, {
    parse_mode: 'Markdown',
    reply_markup: type === 'approval' ? {
      inline_keyboard: [[
        { text: '✅ 승인', callback_data: 'approve' },
        { text: '❌ 거부', callback_data: 'reject' },
      ]]
    } : undefined,
  })
  return message.message_id
}

// 승인 응답 대기
async function wait_for_telegram_response(
  request_id: string,
  timeout_ms: number | null,
): Promise<boolean | null> {
  return new Promise((resolve) => {
    const timer = timeout_ms
      ? setTimeout(() => resolve(null), timeout_ms)
      : null

    bot.on('callback_query', (query) => {
      if (timer) clearTimeout(timer)
      resolve(query.data === 'approve')
      bot.answerCallbackQuery(query.id)
    })
  })
}

// /hunter 커맨드 처리
bot.onText(/\/hunter (.+)/, async (msg, match) => {
  const command = match![1]
  // Task API로 헌터에게 브라우저 태스크 전달
  await create_hunter_task({
    action: 'browser_task',
    description: command,
    timeout_minutes: 30,
  })
  bot.sendMessage(CHAT_ID, `🏹 헌터에게 전달했습니다: ${command}`)
})
```

### 모닝 브리핑 포맷

```text
🌅 FAS 모닝 브리핑 (2026-03-18)

📊 밤새 실행 요약
- 완료: 5건
- 진행중: 2건
- 차단됨: 1건

🔬 주요 발견
- [창업] 예비창업패키지 2차 공고 발견 (D-14)
- [채용] Google Korea 풀스택 포지션 오픈

⏳ 승인 대기 (2건)
1. [HIGH] 에듀테크 MVP PR → /approve apr_001
2. [HIGH] 청약 보고서 확인 → /approve apr_002

📋 오늘 추천
1. 예창패 지원서 초안 검토
2. OMSCS 추천서 준비 시작

Slack에서 상세 확인 →
```

## Slack

### 워크스페이스 구성

```yaml
workspace: fas-automation

apps:
  # 캡틴 앱 (캡틴 .env에 SLACK_BOT_TOKEN)
  - name: "captain"
    channels: [fas-alerts, captain-logs, captain-reports]

  # 헌터 앱 (헌터 .env에 HUNTER_SLACK_WEBHOOK_URL)
  - name: "hunter"
    channels: [fas-alerts, hunter-logs, hunter-reports]

channels:
  # 공통 (시스템 전체)
  - name: "#fas-alerts"
    purpose: "시스템 전체 긴급 알림 (캡틴+헌터 모두 발송)"

  # 캡틴 전용
  - name: "#captain-logs"
    purpose: "캡틴 에이전트 활동 로그 (Claude, Gemini)"
  - name: "#captain-reports"
    purpose: "캡틴 보고서, 브리핑, 승인 요청"

  # 헌터 전용
  - name: "#hunter-logs"
    purpose: "헌터 활동 로그 (크롤링, 브라우저 태스크)"
  - name: "#hunter-reports"
    purpose: "헌터 보고서 (크롤링 결과, Deep Research)"

  # 업무 (향후 추가)
  - name: "#approvals"
    purpose: "MID 승인 요청/결과"
  - name: "#crawl-results"
    purpose: "크롤링 결과 (창업, 청약, 블라인드, 채용)"
  - name: "#academy"
    purpose: "학원 업무 (교재, 시험지, 학부모 문자 초안)"
```

### 구현

```typescript
// src/notification/slack_client.ts

import { WebClient } from '@slack/web-api'

const slack = new WebClient(process.env.SLACK_BOT_TOKEN)

async function send_slack(
  channel: string,
  text: string,
  blocks?: any[],
): Promise<void> {
  await slack.chat.postMessage({
    channel,
    text,
    blocks,
  })
}

// 채널별 라우팅
async function route_notification(event: NotificationEvent): Promise<void> {
  switch (event.type) {
    case 'agent_log':
      const log_channel = event.device === 'captain' ? '#captain-logs' : '#hunter-logs'
      await send_slack(log_channel, event.message)
      break

    case 'crawl_result':
      await send_slack('#crawl-results', event.message)
      break

    case 'approval_mid':
      await send_slack('#approvals', event.message)
      break

    case 'academy':
      await send_slack('#academy', event.message)
      break

    case 'alert':
      await send_slack('#alerts', event.message)
      // 긴급이면 Telegram도
      if (event.severity === 'critical') {
        await send_telegram(event.message, 'alert')
      }
      break
  }
}
```

## Notion

### 데이터베이스 구조

```yaml
databases:
  daily_reports:
    title: "Daily Reports"
    properties:
      - name: Date
        type: date
      - name: Mode
        type: select
        options: [SLEEP, AWAKE]
      - name: Tasks Completed
        type: number
      - name: Tasks Blocked
        type: number
      - name: Summary
        type: rich_text

  research:
    title: "Research"
    properties:
      - name: Topic
        type: title
      - name: Category
        type: select
        options: [AI Trends, Startup, Job, Grad School, Market Analysis]
      - name: Date
        type: date
      - name: Agent
        type: select
      - name: Status
        type: select
        options: [Draft, Verified, Outdated]

  crawl_results:
    title: "Crawl Results"
    properties:
      - name: Source
        type: select
        options: [K-Startup, 청약홈, 블라인드, 채용, D.CAMP]
      - name: Date
        type: date
      - name: Items Found
        type: number
      - name: Action Required
        type: checkbox
```

### 구현

```typescript
// src/notification/notion_client.ts

import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_API_KEY })

async function create_report_page(
  database_id: string,
  title: string,
  content: string,
): Promise<string> {
  const page = await notion.pages.create({
    parent: { database_id },
    properties: {
      title: { title: [{ text: { content: title } }] },
    },
    children: markdown_to_notion_blocks(content),
  })

  return page.url  // 이 URL을 Slack으로 전송
}
```

## Notion Router 연결

`router.ts`에 NotionClient가 연결 완료되었다. `NotificationRouterDeps`에서 `notion: NotionClient | null`로 주입받으며, `ROUTING_MATRIX`에서 `notion: true`인 이벤트(`briefing`, `crawl_result`)는 자동으로 Notion에 전송된다.

- Notion 실패 시 fire-and-forget — 알림 전송을 차단하지 않음
- 환경변수 `NOTION_API_KEY` 미설정 시 `notion: null`로 graceful degradation

## 알림 라우팅 매트릭스

| 이벤트 | Telegram | Slack 채널 | Notion |
| --- | --- | --- | --- |
| 모닝 브리핑 | O (요약) | #fas-general (상세) | O (전체) |
| LOW 태스크 완료 | X | #captain-logs | X |
| MID 승인 요청 | X | #approvals | X |
| HIGH 승인 요청 | O | #approvals | X |
| CRITICAL 승인 요청 | O (반복) | #approvals | X |
| 크롤링 결과 | X | #crawl-results | O |
| 마감 임박 (D-7) | O | #crawl-results | X |
| 에이전트 크래시 | O | #alerts | X |
| 리소스 부족 | O | #alerts | X |
| 학원 문자 초안 | X | #academy | X |
| 시험지 생성 완료 | X | #academy | X |
| 아이디어 분석 완료 | X | #ideas | O |
| Deep Research 완료 | X | #reports | O |
