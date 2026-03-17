# 소통 채널 명세

## 채널 역할 분담

| 채널 | 용도 | 수신 디바이스 | 알림 소리 |
| --- | --- | --- | --- |
| **Telegram** | 긴급 알림, HIGH/CRITICAL 승인 | Galaxy Watch (진동) + Fold | O (유일) |
| **Slack** | 업무 소통, 로그, MID 승인, 일반 보고 | Fold | X (무음) |
| **Notion** | 보고서, 긴 문서, 리서치 결과 | Fold (URL) | X |

## Telegram Bot

### 설정

```yaml
bot_name: FAS_Bot
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

channels:
  # 시스템
  - name: "#fas-general"
    purpose: "시스템 전체 공지, 모드 전환 알림"

  # 에이전트 로그
  - name: "#captain-logs"
    purpose: "캡틴 에이전트 활동 (Claude, Gemini)"
  - name: "#hunter-logs"
    purpose: "헌터 활동 (OpenClaw, NotebookLM)"

  # 업무
  - name: "#approvals"
    purpose: "MID 승인 요청/결과"
  - name: "#reports"
    purpose: "일일/주간 보고서 Notion URL"
  - name: "#crawl-results"
    purpose: "크롤링 결과 (창업, 청약, 블라인드, 채용)"
  - name: "#academy"
    purpose: "학원 업무 (교재, 시험지, 학부모 문자 초안)"
  - name: "#ideas"
    purpose: "캐시플로우/사업화 아이디어"

  # 경고
  - name: "#alerts"
    purpose: "시스템 경고 (비긴급, 긴급은 Telegram)"
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
