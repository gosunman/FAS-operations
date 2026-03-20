# n8n Workflow Configuration

FAS n8n workflow JSON backup directory.

## Workflows

| File | Purpose | Trigger | Gateway Endpoints |
|------|---------|---------|-------------------|
| `master_orchestration.json` | Cron-based mode transition + planning loop invocation | Cron: 07:30 (morning), 23:00 (night) | `POST /api/mode`, `POST /api/n8n/planning/morning`, `POST /api/n8n/planning/night` |
| `health_check.json` | Gateway health monitoring with failure tracking and recovery alerts | Every 5 minutes | `GET /api/health` |
| `task_result_router.json` | Routes task results to appropriate notification channels | Webhook (POST /webhook/task-result) | `POST /api/n8n/task-result-webhook` |
| `token_usage_tracker.json` | Daily usage report + high usage alerts + underutilization suggestions | Daily at 06:00 KST | `GET /api/n8n/metrics` |
| `resource_monitor.json` | CPU/RAM/Disk monitoring | Every 10 minutes | - |
| `mentor_recruitment_monitor.json` | Mentor program crawling + keyword detection + Telegram alert | Daily at 09:00 KST | - |

## Architecture

```
n8n Cron (07:30) ─→ POST /api/mode {awake} ─→ POST /api/n8n/planning/morning ─→ Slack briefing
n8n Cron (23:00) ─→ POST /api/mode {sleep} ─→ POST /api/n8n/planning/night   ─→ Slack summary
n8n Cron (5min)  ─→ GET /api/health ─→ if fail >= 3 ─→ Telegram critical alert
n8n Webhook      ─→ POST /api/n8n/task-result-webhook ─→ crawl→Slack, error→Slack#alerts, discovery→Telegram
n8n Cron (06:00) ─→ GET /api/n8n/metrics ─→ usage > 80% → Telegram, usage < 30% → Slack suggest
```

## Gateway Webhook Endpoints (n8n Integration)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/n8n/planning/morning` | POST | Trigger morning planning loop — creates tasks from schedules.yml |
| `/api/n8n/planning/night` | POST | Trigger night planning — daily summary + Gemini discovery |
| `/api/n8n/task-result-webhook` | POST | Receive task result notification, route to appropriate channel |
| `/api/n8n/metrics` | GET | System metrics: task counts, mode state, timestamp |

## Import

1. Access n8n UI: `http://localhost:5678`
2. Left menu -> Workflows -> Import from File
3. Select JSON file
4. Configure environment variables (Settings -> Environment Variables)

## Environment Variables

Injected from `.env` via docker-compose.yml:

| Variable | Description |
|----------|-------------|
| `GATEWAY_URL` | Gateway API URL (default: `http://host.docker.internal:3100`) |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token |
| `TELEGRAM_CHAT_ID` | Telegram chat ID |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL |
| `CLAUDE_DAILY_LIMIT` | Claude daily request limit (default: 1000) |
| `GEMINI_DAILY_LIMIT` | Gemini daily request limit (default: 500) |

## Credentials

| Name | Type | ID | Note |
|------|------|----|------|
| Telegram Bot | telegramApi | 57R5OYW9j6khyUXW | FAS bot token, used by Mentor Monitor |
