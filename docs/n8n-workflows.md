# n8n Workflows Documentation

FAS 오케스트레이션을 위한 n8n 워크플로우 설계 문서.

## 개요

n8n은 FAS의 **오케스트레이션 엔진**으로, 다음을 담당한다:
- Task 생성 및 에이전트 배정
- 시스템 헬스체크 및 장애 감지
- 리소스 모니터링
- AI 토큰 사용량 추적

## 워크플로우 목록

### 1. Master Orchestration (`master_orchestration.json`)

**역할**: Task 생성 요청을 받아 적절한 에이전트에 배정하고 결과를 추적한다.

**트리거**: Webhook (POST `/webhook/new-task`)

**에이전트 배정 로직**:
- `requires_personal_info=true` → Captain (헌터에 개인정보 전달 금지)
- `risk_level=high|critical` → Captain
- 그 외 → Hunter 배정 가능

**사용 예시**:
```bash
curl -X POST http://localhost:5678/webhook/new-task \
  -H 'Content-Type: application/json' \
  -d '{"title": "웹 크롤링", "risk_level": "low", "requires_personal_info": false}'
```

### 2. Health Check (`health_check.json`)

**역할**: Gateway와 Hunter 상태를 주기적으로 확인한다.

**트리거**: 5분마다 (Schedule)

**장애 감지**: 3회 연속 실패 → Telegram 긴급 알림

### 3. Resource Monitor (`resource_monitor.json`)

**역할**: CPU/RAM/Disk 모니터링

**트리거**: 10분마다 (Schedule)

**임계치**: CPU > 80%, Disk > 90%, Memory pressure != normal

### 4. Token Usage Tracker (`token_usage_tracker.json`)

**역할**: Claude/Gemini 토큰 사용량 추적

**트리거**: 1시간마다

**한도**: Claude 1000/day, Gemini 500/day (환경변수로 설정)

## 환경변수

| Variable | Description | Default |
|----------|-------------|---------|
| `GATEWAY_URL` | Gateway API base URL | `http://host.docker.internal:3100` |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token | (required) |
| `TELEGRAM_CHAT_ID` | Telegram chat ID | (required) |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook | (required) |
| `CLAUDE_DAILY_LIMIT` | Claude daily request limit | `1000` |
| `GEMINI_DAILY_LIMIT` | Gemini daily request limit | `500` |

## Import 방법

1. n8n UI 접속 (`http://localhost:5678`)
2. Workflows → Import from File
3. `config/n8n/*.json` 파일 선택
4. Settings → Environment Variables에서 필수 변수 설정
5. 워크플로우 활성화
