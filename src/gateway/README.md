# Gateway Module (`src/gateway/`)

캡틴의 HTTP API 서버 및 태스크 저장소 — 헌터와의 유일한 통신 채널.

## 모듈 구성

| 파일 | 역할 |
|------|------|
| `server.ts` | Express 기반 REST API (포트 3100). 태스크 CRUD, 헌터 전용 엔드포인트(`/api/hunter/*`), 헬스체크, 모드 전환 |
| `task_store.ts` | SQLite 기반 태스크 저장소 (WAL 모드). CRUD, 상태 전환, 통계, 중복 검사. `action` 필드 지원 |
| `sanitizer.ts` | 개인정보 산이타이징 레이어 — 헌터에게 전달되는 태스크에서 PII 제거 |
| `rate_limiter.ts` | API 요청 속도 제한 (sliding window) |
| `cross_approval.ts` | Gemini CLI 교차 승인 — MID 리스크 액션을 Gemini에게 검증 요청 |
| `mode_manager.ts` | SLEEP/AWAKE 모드 상태 관리 |

## 주요 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| `POST` | `/api/tasks` | 태스크 생성 |
| `GET` | `/api/tasks` | 태스크 목록 (상태 필터) |
| `GET` | `/api/hunter/tasks/pending` | 헌터 전용 — 산이타이징된 pending 태스크 |
| `POST` | `/api/hunter/tasks/:id/result` | 헌터 결과 제출 |
| `POST` | `/api/hunter/heartbeat` | 헌터 생존 체크 |
| `GET` | `/api/health` | 헬스체크 |

## 자동 알림 (헌터 태스크 완료 시)

헌터가 `POST /api/hunter/tasks/:id/result`로 결과를 제출하면, Gateway가 자동으로 `crawl_result` 알림을 발송한다:

1. **Notion** — 원문 전체를 페이지로 저장 (URL 반환)
2. **Slack `#fas-general`** — 200자 요약 + `📄 Notion에서 원문 보기` 링크

OpenClaw JSON 응답의 `payloads[].text`를 자동 추출하여 알림 메시지에 사용. Fire-and-forget 방식으로 HTTP 응답을 차단하지 않음.

## 보안

- 헌터는 Task API를 통해서만 캡틴과 통신 (파일시스템 직접 접근 불가)
- Tailscale VPN 내부에서만 접근 허용
- 산이타이저가 모든 헌터 응답에서 PII를 제거
- PII 오탐 방지: 주민번호 정규식에 lookbehind/lookahead 적용 (UUID/타임스탬프 오탐 제거)
