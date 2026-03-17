# FAS 보안 감사 보고서 — 헌터 머신 배포 전 점검

> 감사일: 2026-03-17
> 대상: Fully Automation System (FAS) — 2대의 Mac Studio 기반 멀티 AI 에이전트 자동화 시스템
> 목적: 격리 머신(헌터)에 코드 배포 시 개인정보/시크릿 유출 위험 평가 및 조치 결과 검증

---

## 시스템 구조 요약

- **캡틴 (Mac Studio #2, M4 Ultra)**: 메인 워커. Claude Code, Gemini CLI, n8n 오케스트레이터, Task API 서버 운영
- **헌터 (Mac Studio #1, M1 Ultra)**: 격리 워커. OpenClaw(ChatGPT Pro 브라우저 자동화)만 실행. **개인정보 접근 완전 차단**
- **통신**: Tailscale VPN 내 HTTP API만 허용. 헌터→캡틴 3100 포트만, 캡틴→헌터 22 포트만
- **산이타이징**: 캡틴이 헌터에 태스크를 보낼 때 PII(개인식별정보)를 제거한 후 전달

## 격리 원칙

| 항목 | 캡틴 | 헌터 | 공유 |
|------|------|------|------|
| macOS 계정 | user | user | 별도 머신 |
| iCloud/Google | 주인 계정 | 별도 계정 | X |
| ChatGPT | — | 별도 계정 (Pro) | X |
| Claude Code | 주인 OAuth | 미사용 | X |
| 파일시스템 | 직접 접근 불가 | 직접 접근 불가 | X |
| 통신 | Task API 서버 | Task API 클라이언트 | API만 |

### 절대 금지 항목
- 헌터에 주인 이름, 연락처, 주소, 금융정보 전달
- 헌터에서 캡틴으로 SSH 접속
- 헌터가 캡틴 파일시스템 마운트
- 캡틴의 .env, secrets를 헌터에 복사

---

## 발견된 보안 이슈 및 조치 현황

### CRITICAL

#### C-1. 에러 로그에 API 토큰 노출 가능성
- **상황**: Telegram API 호출 실패 시 스택트레이스에 Bot Token이 포함되어 콘솔 출력됨
- **위험**: 터미널 로그, tmux 히스토리에 토큰이 남을 수 있음
- **조치**: .env는 .gitignore에 포함되어 git에 커밋되지 않음 (확인 완료). 토큰 재발급 권장.
- **상태**: ⚠️ 부분 완료 (토큰 재발급은 수동 작업 필요)

### HIGH

#### H-1. 코드에 Tailscale IP 하드코딩
- **이전**: `config.ts` 기본값에 `http://100.64.0.1:3100` 하드코딩
- **조치**: 기본값 제거, 환경변수 미설정 시 에러 throw로 변경
- **상태**: ✅ 완료

#### H-2. 문서에 개인 식별 정보
- **이전**: README, architecture.md에 닉네임 "sunman" 포함
- **조치**: 모든 문서에서 "owner"로 변경
- **상태**: ✅ 완료

#### H-3. 파일 경로에 사용자 정보
- **위치**: hunter-protocol.md에 `/Users/user/fas-google-profile-*` 절대경로
- **위험**: macOS 유저명, Google 프로필 구조 노출
- **조치**: 헌터 배포 패키지에서 docs/ 전체 제외
- **상태**: ✅ 설계 완료

#### H-4. PII 산이타이저 커버리지 부족
- **이전 커버**: 한국 이름(라벨), 주민번호, 전화번호, 이메일, 주소, 계좌, 금융정보
- **추가된 패턴**: 신용카드 번호, 내부 IP 주소(10.x, 172.16-31.x, 192.168.x, 100.64-127.x)
- **여전히 누락**: 라벨 없는 한국 이름(문맥 기반), URL/도메인 → Phase 2 LLM 검증으로 대응 예정
- **상태**: ✅ 1차 완료

#### H-5. 헌터 결과 역방향 PII 미검증
- **이전**: 헌터가 제출한 output을 검증 없이 캡틴 DB에 저장
- **위험**: 헌터가 크롤링 중 수집한 개인정보가 캡틴으로 역유입
- **조치**: `/api/hunter/tasks/:id/result` 엔드포인트에 `contains_pii()` 검사 + 자동 산이타이징 추가
- **상태**: ✅ 완료

#### H-6. sanitize_task() 블랙리스트 방식
- **이전**: `title`과 `description`만 산이타이징, 나머지 필드 그대로 전달
- **위험**: Task 타입에 필드가 추가되면 자동으로 헌터에 노출
- **조치**: 화이트리스트 방식으로 변경. 허용 필드만 명시적으로 포함:
  - 허용: `id, title(산이타이징), description(산이타이징), priority, mode, risk_level, status, deadline`
  - 제외: `assigned_to, requires_personal_info, depends_on, output, created_at, completed_at`
- **상태**: ✅ 완료

### MEDIUM

#### M-1. 테스트 코드에 인프라 정보
- **이전**: `api_client.test.ts`, `poll_loop.test.ts`에 `100.64.0.1` 하드코딩
- **조치**: `localhost`로 변경, 테스트 파일 자체는 헌터 배포 패키지에서 제외
- **상태**: ✅ 완료

#### M-2. config/agents.yml에 전체 에이전트 구조
- **위험**: 모든 에이전트 이름, tmux 세션명, capability 목록 노출
- **조치**: 헌터 배포 패키지에서 config/ 제외
- **상태**: ✅ 설계 완료

---

## 헌터 배포 패키지 구성

### 포함 (최소한)
```
fas-hunter/
├── src/hunter/         (폴링 클라이언트 — 테스트 파일 제외)
├── src/shared/types.ts (공유 타입만)
├── package.json        (헌터 전용 최소 의존성)
├── tsconfig.json
└── .env                (CAPTAIN_API_URL만)
```

### 제외 (절대 포함 금지)
```
❌ .env (캡틴용 — Telegram/Slack 토큰 포함)
❌ src/gateway/      (캡틴 서버 코드, DB 스키마)
❌ src/notification/  (Telegram/Slack 토큰 참조)
❌ src/watchdog/      (캡틴 전용)
❌ config/            (전체 에이전트 구조)
❌ docs/              (개인정보 포함 가능)
❌ scripts/           (캡틴 인프라 스크립트)
❌ reviews/           (보안 감사 보고서 — 이 문서 자체!)
❌ docker-compose.yml (캡틴 인프라)
❌ CLAUDE.md          (자율 실행 규칙)
❌ PLAN.md            (전체 사업 계획)
❌ **/*.test.ts       (테스트에 인프라 정보)
```

---

## Tailscale ACL 설계

```json
{
  "acls": [
    { "action": "accept", "src": ["tag:macbook"], "dst": ["tag:captain:*", "tag:hunter:*"] },
    { "action": "accept", "src": ["tag:hunter"], "dst": ["tag:captain:3100"] },
    { "action": "accept", "src": ["tag:captain"], "dst": ["tag:hunter:22"] }
  ]
}
```

- MacBook → 캡틴/헌터 전체 접근 (SSH, 모니터링)
- 헌터 → 캡틴 3100 포트만 (Task API)
- 캡틴 → 헌터 22 포트만 (SSH, 긴급 관리)
- **헌터 → 캡틴 파일시스템: 불가**
