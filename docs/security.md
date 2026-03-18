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

# Hunter API key — shared secret for app-level auth (Defense in Depth)
HUNTER_API_KEY=

# SMS (학부모 문자, 구매 시)
SMS_API_KEY=
SMS_USER_ID=
SMS_SENDER_NUMBER=

# 프로젝트 경로
PROJECT_DIR=/Users/user/FAS-operations
```

### 헌터 시크릿

헌터는 캡틴의 .env를 **절대 공유하지 않음**. 헌터 자체 시크릿:

```bash
# 헌터의 .env

# 캡틴 Task API 접속 정보
CAPTAIN_API_URL=http://<captain-tailscale-ip>:3100

# Hunter API key — must match captain's HUNTER_API_KEY
HUNTER_API_KEY=

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

  authentication:
    # App-level API key for all /api/hunter/* endpoints (Defense in Depth)
    - hunter_api_key: required
    - header: x-hunter-api-key

  rate_limiting:
    # Sliding window rate limiter on all hunter endpoints
    - window_ms: 60000    # 1 minute window
    - max_requests: 30    # 30 requests per minute

  schema_validation:
    # Strict validation on hunter result submissions
    - max_output_length: 50000   # 50KB text limit
    - max_files_count: 20        # Max files per result
    - max_file_path_length: 500  # Max path length
    - allowed_extensions: [.md, .txt, .json, .csv, .html, .htm, .xml, .yaml, .yml, .log]
    - path_traversal_blocked: true  # Reject ".." and absolute paths

  pii_quarantine:
    # PII detected in hunter output → quarantine (not auto-sanitize)
    - strategy: quarantine       # reject & quarantine for human review
    - response_code: 202         # Accepted but quarantined
    - stored_data: sanitized_preview  # Never store raw PII

  monitoring:
    # 헌터에서 캡틴으로 보내는 데이터에 개인정보 없는지 역검사
    - scan_hunter_results_for_pii: true
    # 헌터의 Task API 요청에 비정상 패턴 감지
    - anomaly_detection: true
```

## PII 산이타이저

### 감지 패턴 (10개)

| # | 패턴 | 설명 | 치환 |
|---|------|------|------|
| 1 | labeled_korean_name | 이름/성명 라벨 + 한국 이름 | [이름 제거됨] |
| 2 | resident_id | 주민등록번호 (13자리) | [주민번호 제거됨] |
| 3 | phone_number | 한국 휴대폰 번호 | [전화번호 제거됨] |
| 4 | email | 이메일 주소 | [이메일 제거됨] |
| 5 | address | 한국 주소 (시도 + 시군구) | [주소 제거됨] |
| 6 | credit_card | 신용카드 번호 (4x4자리) | [카드번호 제거됨] |
| 7 | ip_address | 내부/Tailscale IP 주소 | [IP 제거됨] |
| 8 | bank_account | 은행 계좌번호 | [계좌 제거됨] |
| 9 | financial_amount | 금액 라벨 + 수치 | [금융정보 제거됨] |
| 10 | internal_url | 내부 URL (*.local, *.internal, *.ts.net, localhost) | [내부URL 제거됨] |

### Phase 2 예정 (LLM 기반)

- 라벨 없는 한국 이름 (문맥 기반): "홍길동이 청약했습니다"
- 조직 식별 도메인 (설정 기반 블록리스트)
- 간접 식별 조합 (학번 + 학교명 등)

## Task API 보안 계층

```
[Layer 1] Tailscale VPN    — 네트워크 격리 (헌터 → 캡틴 3100포트만)
[Layer 2] API Key Auth     — 애플리케이션 인증 (x-hunter-api-key 헤더)
[Layer 3] Rate Limiting    — 요청 속도 제한 (30req/min sliding window)
[Layer 4] Schema Validation — 입력 검증 (크기, 타입, 확장자, 경로)
[Layer 5] PII Quarantine   — 결과물 PII 검출 시 격리 (자동저장 금지)
[Layer 6] Whitelist Fields — 태스크 전달 시 화이트리스트 필드만 포함
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
