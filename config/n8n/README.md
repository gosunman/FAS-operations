# n8n Workflow Configuration

FAS n8n 워크플로우 JSON 백업 디렉토리.

## Workflows

| File | Purpose | Trigger |
|------|---------|---------|
| `master_orchestration.json` | Task 생성 → 에이전트 배정 → 알림 | Webhook (POST /webhook/new-task) |
| `health_check.json` | Gateway + Hunter 헬스체크 | 5분마다 |
| `resource_monitor.json` | CPU/RAM/Disk 모니터링 | 10분마다 |
| `token_usage_tracker.json` | Claude/Gemini 토큰 사용량 추적 | 1시간마다 |

## Import 방법

1. n8n UI 접속: `http://localhost:5678`
2. 좌측 메뉴 → Workflows → Import from File
3. JSON 파일 선택
4. 환경변수 설정 (Settings → Environment Variables):
   - `GATEWAY_URL`: Gateway API URL (default: `http://host.docker.internal:3100`)
   - `TELEGRAM_BOT_TOKEN`: Telegram Bot API token
   - `TELEGRAM_CHAT_ID`: Telegram chat ID
   - `SLACK_WEBHOOK_URL`: Slack incoming webhook URL

## 환경변수

docker-compose.yml에서 주입되는 변수:

```env
GATEWAY_URL=http://host.docker.internal:3100
TELEGRAM_BOT_TOKEN=<bot-token>
TELEGRAM_CHAT_ID=<chat-id>
SLACK_WEBHOOK_URL=<webhook-url>
CLAUDE_DAILY_LIMIT=1000
GEMINI_DAILY_LIMIT=500
```
