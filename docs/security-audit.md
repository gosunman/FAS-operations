# 보안 감사 보고서 — 헌터 머신 배포 전 점검

> 감사일: 2026-03-17
> 대상: fully-automation-system 전체 코드베이스
> 목적: 헌터(격리 머신)에 코드 배포 시 개인정보/시크릿 유출 위험 평가

---

## 요약

| 심각도 | 발견 건수 | 즉시 조치 필요 |
|--------|----------|---------------|
| CRITICAL | 1 | ✅ |
| HIGH | 6 | ✅ |
| MEDIUM | 3 | ⚠️ |

---

## CRITICAL

### C-1. 대화 로그 내 실제 API 토큰 노출

**상황**: 알림 테스트 실행 시 에러 스택트레이스에 실제 Telegram Bot Token이 포함되어 콘솔에 출력됨.

**위험**: 터미널 로그, tmux 히스토리, 에이전트 출력 감시 등에 토큰이 남을 수 있음.

**조치**:
- [x] `.env`는 `.gitignore`에 포함되어 git에 커밋되지 않음 (확인 완료)
- [ ] Telegram Bot Token 재발급 권장 (BotFather → `/revoke` → `/newbot`)
- [ ] 에러 로깅에서 URL/토큰 마스킹 로직 추가

---

## HIGH

### H-1. Tailscale IP 하드코딩

**위치**:
- `src/hunter/config.ts:12` — 기본값 `http://100.64.0.1:3100`
- `.env.example:24` — `CAPTAIN_API_URL=http://100.64.0.1:3100`
- `src/hunter/api_client.test.ts:12`, `poll_loop.test.ts:15` — 테스트 코드

**위험**: 헌터에 배포 시 캡틴의 Tailscale IP 노출 → 네트워크 토폴로지 매핑 가능

**조치**:
- [ ] `config.ts` 기본값 제거, 환경변수 미설정 시 에러 throw
- [ ] `.env.example`에서 구체적 IP 제거
- [ ] 테스트 코드에서 `localhost` 사용

### H-2. 문서 내 개인 식별 정보 ("sunman")

**위치**:
- `README.md:20` — `HUMAN (sunman)`
- `docs/architecture.md:7` — `Human (sunman)`

**위험**: 닉네임 + 기기 모델(Galaxy Watch/Fold) 조합으로 개인 식별 가능

**조치**:
- [ ] 모든 문서에서 "sunman" → "owner" 또는 "user"로 변경
- [ ] 헌터 배포 패키지에서 docs/ 제외

### H-3. 파일 경로 내 사용자 정보

**위치**:
- `docs/hunter-protocol.md:172-173` — `/Users/user/fas-google-profile-hunter/`
- `scripts/setup/com.fas.captain.plist` — `/Users/user/fully-automation-system/...`

**위험**: macOS 유저명, 디렉토리 구조, Google 프로필 경로 노출

**조치**:
- [ ] 문서에서 절대경로를 `$HOME/...` 또는 `~/...` 형식으로 변경
- [ ] plist는 캡틴 전용이므로 헌터 배포 패키지에서 제외

### H-4. PII 산이타이저 커버리지 부족

**현재 커버**:
- ✅ 한국 이름 (라벨 포함)
- ✅ 주민번호
- ✅ 전화번호
- ✅ 이메일
- ✅ 한국 주소
- ✅ 계좌번호
- ✅ 금융정보

**누락**:
- ❌ 신용카드 번호 (`1234-5678-9012-3456`)
- ❌ URL/도메인 (개인 블로그, GitHub 프로필)
- ❌ IP 주소 (내부 네트워크)
- ❌ 라벨 없는 한국 이름 (문맥 기반 감지 필요 — Phase 2 LLM 검증으로 대응)

**조치**:
- [ ] 신용카드, IP 주소 패턴 추가
- [ ] 테스트 케이스 확장

### H-5. 헌터 결과(reverse) PII 미검증

**위치**: `src/gateway/server.ts:146-159`

**문제**: 헌터가 제출하는 task result의 `output` 필드를 검증 없이 캡틴 DB에 저장.
헌터가 웹 크롤링 중 수집한 개인정보가 캡틴으로 역유입될 수 있음.

**조치**:
- [ ] `/api/hunter/tasks/:id/result` 엔드포인트에 `contains_pii()` 검사 추가
- [ ] PII 감지 시 경고 로그 + 산이타이징 후 저장

### H-6. sanitize_task()가 화이트리스트 방식이 아님

**문제**: 현재 `title`과 `description`만 산이타이징하고 나머지 필드는 그대로 전달.
향후 Task 타입에 필드가 추가되면 산이타이징 누락 가능.

**조치**:
- [ ] 화이트리스트 방식으로 변경: 헌터에 필요한 필드만 명시적으로 포함
  ```
  허용 필드: id, title(산이타이징), description(산이타이징),
             priority, mode, risk_level, status, deadline
  제외 필드: assigned_to, output, depends_on, metadata 등
  ```

---

## MEDIUM

### M-1. 환경변수명이 아키텍처 노출

- `CAPTAIN_API_URL` → "captain" 역할 노출
- `HUNTER_POLL_INTERVAL` → "hunter" 역할 노출

**조치**: 현 단계에서는 수용 가능. 환경변수는 헌터 머신의 `.env`에만 존재하므로 소스코드에 포함되지 않음.

### M-2. 테스트 코드에 인프라 정보

- `api_client.test.ts`, `poll_loop.test.ts`에 IP 주소 하드코딩

**조치**: `localhost`로 변경

### M-3. config/agents.yml에 전체 에이전트 구조

- 모든 에이전트 이름, tmux 세션명, capability 목록 노출

**조치**: 헌터 배포 패키지에서 config/ 제외

---

## 헌터 배포 패키지 구성 (권장)

### 포함할 파일 (최소한)
```
fas-hunter/
├── src/
│   ├── hunter/          # 폴링 클라이언트 (테스트 파일 제외)
│   │   ├── config.ts
│   │   ├── logger.ts
│   │   ├── api_client.ts
│   │   ├── task_executor.ts
│   │   ├── poll_loop.ts
│   │   ├── main.ts
│   │   └── index.ts
│   └── shared/
│       └── types.ts     # 공유 타입만
├── package.json         # 헌터 전용 (최소 의존성)
├── tsconfig.json
└── .env                 # CAPTAIN_API_URL만
```

### 제외할 파일 (절대 포함 금지)
```
❌ .env (캡틴용 — 모든 시크릿 포함)
❌ src/gateway/           (캡틴 서버 코드)
❌ src/notification/      (Telegram/Slack 토큰 참조)
❌ src/watchdog/          (캡틴 전용)
❌ config/                (전체 에이전트 구조)
❌ docs/                  (개인정보 포함 가능)
❌ scripts/               (캡틴 인프라 스크립트)
❌ docker-compose.yml     (캡틴 인프라)
❌ CLAUDE.md              (자율 실행 규칙)
❌ PLAN.md                (전체 사업 계획)
❌ **/*.test.ts           (테스트에 인프라 정보)
```

---

## 배포 프로세스 체크리스트

1. [ ] `scripts/deploy_hunter.sh` 스크립트 생성
2. [ ] 소스 코드에서 하드코딩된 IP 제거
3. [ ] 헌터 전용 `package.json` 생성 (의존성: tsx, typescript만)
4. [ ] 헌터 전용 `.env.hunter` 생성 (`CAPTAIN_API_URL`만)
5. [ ] scp로 최소 패키지만 전송
6. [ ] 전송 후 헌터에서 `contains_pii()` 셀프 체크 실행
7. [ ] 캡틴에서 헌터 heartbeat 수신 확인

---

## NotebookLM 검증 요청 항목

이 보고서를 NotebookLM에 업로드하여 다음을 검증 요청:

1. 산이타이저 패턴이 충분한가? 누락된 한국/글로벌 PII 패턴은?
2. 화이트리스트 vs 블랙리스트 방식의 장단점
3. 헌터 배포 패키지 구성이 적절한가? 누락된 위험 요소는?
4. 역방향 PII 검사(헌터→캡틴) 전략의 적절성
5. 네트워크 레벨 보안 (Tailscale ACL만으로 충분한가?)
