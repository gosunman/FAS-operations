# n8n Workflow Configuration

FAS n8n 워크플로우 JSON 백업 디렉토리.

## Workflows

| File | Purpose | Trigger |
|------|---------|---------|
| `master_orchestration.json` | Task 생성 → 에이전트 배정 → 알림 | Webhook (POST /webhook/new-task) |
| `health_check.json` | Gateway + Hunter 헬스체크 | 5분마다 |
| `resource_monitor.json` | CPU/RAM/Disk 모니터링 | 10분마다 |
| `token_usage_tracker.json` | Claude/Gemini 토큰 사용량 추적 | 1시간마다 |
| `mentor_recruitment_monitor.json` | 멘토 공고 크롤링 → 키워드 감지 → 텔레그램 알림 | 매일 09:00 KST |

## Import 방법

1. n8n UI 접속: `http://localhost:5678`
2. 좌측 메뉴 → Workflows → Import from File
3. JSON 파일 선택
4. 환경변수 설정 (Settings → Environment Variables)

## 환경변수

docker-compose.yml의 `.env`에서 주입:

| Variable | Description |
|----------|-------------|
| `GATEWAY_URL` | Gateway API URL (default: `http://host.docker.internal:3100`) |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token |
| `TELEGRAM_CHAT_ID` | Telegram chat ID |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL |
| `CLAUDE_DAILY_LIMIT` | Claude daily request limit (default: 1000) |
| `GEMINI_DAILY_LIMIT` | Gemini daily request limit (default: 500) |

## Credentials

| Name | Type | ID | 비고 |
|------|------|----|------|
| Telegram Bot | telegramApi | 57R5OYW9j6khyUXW | FAS 봇 토큰, Mentor Monitor에서 사용 |
