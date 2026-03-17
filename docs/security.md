# 보안 명세

## 시크릿 관리

### 캡틴 시크릿 (.env)

```bash
# .env.example (캡틴)

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Slack
SLACK_BOT_TOKEN=

# Notion
NOTION_API_KEY=

# Gemini
GEMINI_API_KEY_A=
GEMINI_API_KEY_B=

# n8n
N8N_USER=
N8N_PASSWORD=

# Gateway
GATEWAY_PORT=3100

# SMS (학부모 문자, 구매 시)
SMS_API_KEY=
SMS_USER_ID=
SMS_SENDER_NUMBER=

# 프로젝트 경로
PROJECT_DIR=/Users/user/fully-automation-system
```

### 헌터 시크릿

헌터는 캡틴의 .env를 **절대 공유하지 않음**. 헌터 자체 시크릿:

```bash
# 헌터의 .env

# 캡틴 Task API 접속 정보
CAPTAIN_TAILSCALE_IP=
CAPTAIN_API_PORT=3100

# 자체 시크릿은 브라우저 세션으로 관리
# (ChatGPT Pro, Google 계정은 브라우저 로그인 상태)
```

### 시크릿 저장 방식

```bash
# macOS Keychain 사용 (선택)
security add-generic-password -a "fas" -s "TELEGRAM_BOT_TOKEN" -w "토큰값"
security find-generic-password -a "fas" -s "TELEGRAM_BOT_TOKEN" -w

# 또는 .env + dotenv (기본)
# .env는 반드시 .gitignore에 포함
```

## 헌터 격리 상세

[hunter-protocol.md](hunter-protocol.md) 참조.

추가 보안 조치:

```yaml
hunter_security:
  # 캡틴 → 헌터 방향: Task API로만 통신
  # 헌터 → 캡틴 방향: Task API로만 통신
  # SSH: 캡틴 → 헌터만 허용 (긴급 관리용)

  monitoring:
    # 헌터에서 캡틴으로 보내는 데이터에 개인정보 없는지 역검사
    - scan_hunter_results_for_pii: true
    # 헌터의 Task API 요청에 비정상 패턴 감지
    - anomaly_detection: true
```

## Tailscale ACL

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["tag:macbook"],
      "dst": ["tag:captain:*", "tag:hunter:*"]
    },
    {
      "action": "accept",
      "src": ["tag:hunter"],
      "dst": ["tag:captain:3100"]
    },
    {
      "action": "accept",
      "src": ["tag:captain"],
      "dst": ["tag:hunter:22"]
    }
  ]
}
```

## 외부 API 화이트리스트

캡틴에서 호출 허용되는 외부 API:

```yaml
api_whitelist:
  notification:
    - api.telegram.org
    - slack.com
    - api.notion.com

  crawling:
    - k-startup.go.kr
    - applyhome.co.kr
    - dcamp.kr
    - startup.google.com
    - news.ycombinator.com
    - reddit.com
    - arxiv.org

  ai:
    - api.anthropic.com      # Claude (OAuth 경유)
    - generativelanguage.googleapis.com  # Gemini

  sms:
    - apis.aligo.in          # 문자 발송 (구매 시)

  deployment:
    - api.vercel.com
    - github.com
```

## .gitignore

```text
# 시크릿
.env
.env.local

# 런타임 상태
state/
logs/

# 학생 개인정보
data/academy/students/

# OS
.DS_Store

# Node
node_modules/
dist/

# Colima/Docker
.colima/
```
