# PLAN.md — FAS Operations 구축 계획

## 전체 로드맵

```
Phase 0: 인프라 기반 세팅               (1~2일)
Phase 1: 단일 에이전트 자동화            (3~5일)
Phase 2: 멀티 에이전트 + 교차 승인       (1~2주)
Phase 3: SLEEP/AWAKE 모드 운영          (1주)
Phase 4: 반복 태스크 자동화              (1~2주)
Phase 5: 학원 업무 자동화                (1~2주)
Phase 6: 캐시플로우 & 사업화 파이프라인   (지속)
Phase 7: 안정화 + 모니터링 고도화        (지속)
```

---

## Phase 0: 인프라 기반 세팅

### 0-1. Mac Studio 네트워크 세팅 ✅

- [x] 캡틴, 헌터에 Tailscale 설치 및 연결
- [x] SSH 키 교환 (MacBook Pro ↔ 캡틴 ↔ 헌터)
- [x] 고정 Tailscale IP 기록 및 alias 설정
- [x] 방화벽 규칙: Tailscale 서브넷만 허용

### 0-2. tmux 환경 구성 ✅

- [x] 캡틴, 헌터에 tmux 설치
- [x] 자동 세션 복구 스크립트 (`tmux-resurrect` 또는 커스텀)
- [x] 세션 네이밍 컨벤션:
  - 캡틴: `fas-claude`, `fas-gemini-a`, `fas-n8n`, `fas-gateway`, `fas-watchdog`
  - 헌터: `fas-openclaw`, `fas-watchdog`

### 0-3. 소통 채널 구축 ✅

- [x] **Telegram Bot** 코드 구현 — 긴급 알림 전용
  - [x] 알림 전송 모듈 (TypeScript) — `src/notification/telegram.ts`
  - [x] `send(text, type)` + `wait_for_approval(request_id, timeout_ms)`
  - [x] BotFather에서 실제 봇 생성 + Chat ID 확인
  - [x] Galaxy Watch 텔레그램 알림 허용 설정
- [x] **Slack** 코드 구현 — 업무 소통
  - [x] 채널 라우팅 모듈 — `src/notification/slack.ts`
  - [x] 통합 라우터 — `src/notification/router.ts`
  - [x] Slack 워크스페이스 생성 + Bot 토큰 발급
- [x] **Notion** 연동 — 보고서/긴 문서:
  - [x] Notion 클라이언트 구현 — `src/notification/notion.ts` (create_page, send_notification, daily_briefing)
  - [x] 태스크 결과 Notion 백업 파이프라인 — `server.ts`에서 fire-and-forget 백업 (NOTION_TASK_RESULTS_DB)
  - [x] Notion API Key 발급 + DB 4개 생성 완료 (DAILY_REPORTS, RESEARCH, CRAWL_RESULTS, TASK_RESULTS)
  - [x] `.env`에 `NOTION_API_KEY` + 4개 DB ID 설정 완료
  - [x] 라우터(`router.ts`)에 NotionClient 연결
  - [x] 모닝 브리핑 → Notion 페이지 자동 생성 — `morning_briefing.ts`
  - [x] 크롤링 결과 자동 알림: Notion 원문 → Slack 요약 + Notion 링크 (2026-03-19)
  - [x] Notion 페이지 Name 속성만 사용 (Type/Timestamp 제거, DB 호환성 강화)
  - [x] 메시지 2000자 청크 분할 (Notion API 제한 대응)

### 0-4. Docker 환경 (캡틴) ✅

- [x] 캡틴에 Colima + Docker 설치 완료 (Docker 29.2.1)
- [x] n8n Docker Compose 파일 작성 — `docker-compose.yml`
- [x] 볼륨 매핑: tasks, state, reports, config

### 0-5. AI CLI 설치 & 인증 ✅

- [x] 인증 가이드 스크립트 — `scripts/setup/setup_ai_cli.sh`
- [x] Claude Code: 캡틴에 OAuth 로그인 (Max 플랜)
- [x] Gemini CLI: 캡틴에 2개 계정 인증 설정 (v0.33.2)
- [x] ~~**⚠️ SA-001**: 헌터 Claude Code 세션 로그아웃~~ — Claude Code 가입 시 전화번호 인증 필수로 별도 계정 B 생성 불가. 헌터의 코딩/고지능 분석 작업은 Gemini CLI로 임시 대체.
- [ ] 헌터 AI 플랜 단계별 확장 (아래 "AI 플랜 확장 로드맵" 참조)
- [ ] 헌터 머신 초기 세팅 — `scripts/setup/setup_hunter.sh` 실행 *(인간 작업)*

### 0-6. 헌터 ↔ 캡틴 통신 구축 ✅

- [x] 캡틴에 Task API 서버 구축 (Express, 포트 3100) — `src/gateway/server.ts`
  - `POST /api/tasks` — 태스크 생성
  - `GET /api/tasks` — 태스크 목록 (상태 필터)
  - `GET /api/hunter/tasks/pending` — 헌터 전용 (산이타이징된 태스크)
  - `POST /api/hunter/tasks/:id/result` — 헌터 결과 제출
  - `POST /api/hunter/heartbeat` — 헌터 생존 체크
  - `GET /api/health` — 헬스체크
- [x] 개인정보 산이타이징 레이어 — `src/gateway/sanitizer.ts`
- [x] SQLite 태스크 저장소 — `src/gateway/task_store.ts`
- [x] 헌터는 캡틴 파일시스템에 직접 접근 불가 (API 통신만 허용)

---

## Phase 1: 단일 에이전트 자동화

### 1-1. Claude Code 상시 실행 체계 (캡틴) ✅

- [x] tmux 세션 자동 시작 스크립트 (launchd) — `scripts/setup/com.fas.captain.plist`
- [x] Claude Code 출력 감시 → Telegram/Slack 전송 스크립트 — `src/watchdog/output_watcher.ts`
  - 승인 요청 패턴 감지: `[APPROVAL_NEEDED]`, `[BLOCKED]`
  - 마일스톤 완료 패턴: `[MILESTONE]`, `[DONE]`, `[ERROR]`
  - [x] NotificationRouter 연동 완료 — 패턴 감지 → 자동 Telegram/Slack 라우팅
- [x] 자동 재시작 (크래시 복구) — `scripts/agent_wrapper.sh` (지수 백오프, 최대 3회)
- [x] CLAUDE.md에 자율 실행 범위 명시
- [x] 통합 캡틴 진입점 — `src/captain/main.ts` (Gateway + Watcher + Planning Loop 통합 기동, `pnpm captain`)

### 1-2. Gemini CLI 상시 실행 체계 (캡틴) ✅

- [x] 계정 A: 리서치 + 교차 검증 통합 세션 — `scripts/setup/com.fas.gemini-a.plist`
- [x] ~~계정 B~~ 제거 — 캡틴은 계정 A만 사용 (계정 B는 헌터 전용)
- [x] 자동 재시작 래퍼 — `scripts/gemini_wrapper.sh` (지수 백오프, 최대 3회)
- [x] 출력 로깅 + Telegram/Slack 연동 — `[GEMINI_BLOCKED]` 패턴 감지
- [ ] 실제 계정 인증 실행 *(인간 작업 — `scripts/setup/setup_gemini_cli.sh` 실행)*

### 1-3. OpenClaw 안정화 (헌터)

- [x] ChatGPT Pro 연동 완료 — OpenClaw 2026.3.13 설치, OAuth 인증 완료 (2026-03-19)
- [x] 개인정보 유입 방지 확인 — Quarantine 로직 구현 완료
- [x] 기본 태스크 실행 테스트 — web_crawl(HN 크롤링 성공), chatgpt_task(OpenClaw 텍스트 리서치 + 브라우저 모드 성공) 확인 (2026-03-19)
- [x] OpenClaw tools profile → `full` (브라우저 도구 포함), `openclaw browser start` 완료
- [x] OpenClaw CLI 호출 방식 변경: `openclaw agent --agent main -m "prompt" --json`
- [x] NotebookLM 웹 자동화 코드 — `handle_notebooklm_verify` (Playwright + 구글 프로필)
- [x] Gemini Deep Research 웹 자동화 코드 — `handle_deep_research` (Playwright + 구글 프로필)
- [x] 구글 로그인 감지 → `[LOGIN_REQUIRED]` → Telegram 긴급 알림
- [x] Node.js 22 업그레이드 (20 → 22, OpenClaw 요구사항) — sharp 빌드 이슈, npm 캐시 권한, nvm prefix 충돌 해결
- [x] OpenClaw Gateway 데몬 가동 확인 (port 18789)
- [ ] 헌터 머신 초기 세팅 *(인간 작업 — `scripts/setup/setup_hunter.sh` 실행)*

### 1-4. 작업 큐 시스템 ✅

- [x] SQLite 기반 태스크 저장소 — `src/gateway/task_store.ts` (WAL 모드, CRUD, 트랜잭션)
- [x] Gateway Task API — `src/gateway/server.ts` (REST CRUD + 필터링 + 통계)
- [x] 헌터 태스크 폴링 — `GET /api/hunter/tasks/pending` (PII 제거 후 전달)
- [x] 반복 스케줄 정의 — `config/schedules.yml` (Phase 4 태스크 6개 + 시스템 워크플로우 3개)
- [x] Planning Loop — `src/captain/planning_loop.ts` (스케줄 기반 자동 태스크 생성 + Gemini 동적 발견)

---

## Phase 2: 멀티 에이전트 + 교차 승인

### 2-1. 교차 승인 프로토콜 구현 ✅

- [x] 승인 요청 표준 포맷 정의 — `CrossApprovalResult`, `CrossApprovalConfig` 타입 (`src/shared/types.ts`)
- [x] Gemini CLI 교차 승인 모듈 — `src/gateway/cross_approval.ts`
  - `LOW` → 즉시 실행, 로그만 기록
  - `MID` → Gemini CLI spawn → JSON 응답 파싱 → 승인/거부
  - `HIGH` → Telegram으로 인간에게 전송 → 응답 대기
  - 10분 타임아웃 / JSON 파싱 실패 → 자동 거부 (secure by default)
- [x] **5단계 보안 검수 모듈** — `src/gateway/security_validator.ts` (2026-03-22)
  - [x] 프롬프트 인젝션 검사 (5패턴)
  - [x] 악성코드/RCE 검사 (7패턴)
  - [x] 역방향 정보 수집 검사 (7패턴)
  - [x] 데이터 무결성 검사 (3패턴)
  - [x] server.ts 헌터 결과 엔드포인트 통합
- [ ] 교차 검증 로직 (n8n 워크플로우 통합):
  - Claude 작업물 → Gemini가 리뷰 (또는 그 반대)
  - 불일치 시 → NotebookLM(헌터)에게 검증 요청
  - 최종 불일치 시 → 무조건 인간 승인

### 2-2. 에이전트 모니터링 ✅

- [x] 헌터 Heartbeat 모니터 — `src/watchdog/hunter_monitor.ts`
  - 30초 주기 헬스체크 폴링
  - 2분 미응답 → WARNING (Slack), 5분 미응답 → ALERT (Telegram)
  - 복구 시 RECOVERY 알림
  - 캡틴 main.ts에 통합, graceful shutdown 포함
- [x] 활동 로거 — `src/watchdog/activity_logger.ts`
- [x] 리소스 모니터 — `src/watchdog/resource_monitor.ts`
- [x] n8n 워크플로우 통합 (Phase 2 후반): (2026-03-21)
  - [x] 마스터 오케스트레이션 워크플로우 — `config/n8n/master_orchestration.json` (Cron 기반 모드 전환 + planning loop)
  - [x] AI 토큰 사용량 추적 워크플로우 — `config/n8n/token_usage_tracker.json` (Daily 06:00)
  - [x] 태스크 결과 라우팅 — `config/n8n/task_result_router.json` (신규)
  - [x] n8n webhook 연동 — `src/gateway/n8n_webhooks.ts` (4개 엔드포인트)

### 2-3. 할루시네이션 방지 파이프라인

- [ ] NotebookLM 연동 (구글 계정 2개, 섀도우/캡틴/헌터 모두 사용 가능):
  - 에이전트 산출물을 NotebookLM에 업로드하여 검증
  - 헌터: OpenClaw 웹 자동화로 실행
  - 캡틴/섀도우: Gemini API 또는 웹 자동화 코드로 실행
  - 검증 실패 시 → `blocked` 상태 + 사유 기록
- [x] **Thunderbolt Bridge pf 방화벽** — 40Gbps JACCL 분산 추론용 (2026-03-22)
  - [x] 캡틴/헌터 pf 규칙 파일 (`fas-thunderbolt.captain.conf`, `fas-thunderbolt.hunter.conf`)
  - [x] 멱등 설치 스크립트 (`setup_pf_firewall.sh`)
  - [x] 케이블 연결 검증 스크립트 (`verify_cable_connection.sh`)
  - [x] start_all.sh Phase 0 방화벽 검증 통합
  - [x] verify_hunter.sh [6/6] pf 상태 검증 추가
  - [ ] 실제 Thunderbolt 케이블 연결 + 검증 *(인간 작업)*
- [ ] Cross-AI 팩트체크 (Claude ↔ Gemini)
- [ ] Deep Research 활용 (구글 계정 2개, 동시 3건 제한):
  - 새 도메인 진입 시 초기 자료 수집
  - 결과를 `research/` 디렉토리에 구조화 저장
  - 사용량 한도 도달 시 → 주인님에게 보고 → 플랜 업그레이드 또는 추가 계정 구매

### 2-4. 헌터 운영 인프라 ✅

- [x] 헌터 배포 스크립트 — `scripts/deploy/deploy_hunter.sh`
- [x] 배포 후 검증 스크립트 — `scripts/deploy/verify_hunter.sh` (5단계: API 연결, heartbeat, 태스크 라이프사이클, PII 스캔, 런타임)
- [x] 헌터 watchdog — `scripts/hunter_watchdog.sh` (지수 백오프, Captain 크래시 보고, Telegram 알림)
- [x] 헌터 launchd — `scripts/setup/com.fas.hunter.plist` (KeepAlive, 로그)
- [x] 통합 테스트 — `tests/integration/captain_hunter.test.ts`
- [x] com.fas.start-all.plist — 캡틴 로그인 시 전체 서비스 자동 기동
- [x] com.fas.update-check.plist — macOS 업데이트 감시 (매일 09:00)
- [x] com.fas.dep-check.plist — 의존성 점검 (매월 1일)
- [x] start_all.sh 5단계 기동 순서 구현
- [x] stop_all.sh / status.sh 신 아키텍처 반영
- [x] start_captain_sessions.sh deprecated 처리
- [x] hunter_watchdog.sh nvm 로드 + OpenClaw health check 추가
- [x] com.fas.hunter.plist PATH 수정 (nvm 경로 추가)
- [x] openclaw-gateway ThrottleInterval 1→30 수정

---

## Phase 3: SLEEP/AWAKE 모드 운영

### 3-1. SLEEP 모드 (23:00~07:30)

자동 실행 태스크만 수행, 인간 승인 불필요한 작업 위주.

**허용 활동:**

- 웹 크롤링 / 정보 수집
- Deep Research 실행 (헌터)
- 트렌드 분석 리포트 생성
- 코드 리뷰 (기존 PR)
- 테스트 실행 및 결과 기록
- NotebookLM 검증 실행 (헌터)
- 내일 AWAKE 모드 태스크 준비

**금지 활동:**

- git push / 배포
- 외부 서비스 API 호출 (결제 관련)
- 새 PR 생성
- 인간 승인 필요 태스크

**SLEEP 모드 산출물:**

- `reports/daily/{date}_overnight_report.md`
- Notion 페이지로 생성 → Slack으로 URL 전달

### 3-2. AWAKE 모드 (07:30~23:00)

**07:30 모닝 브리핑 (Telegram + Slack):**

- Telegram: 핵심 요약 + 승인 대기 목록 (Galaxy Watch 진동)
- Slack: 상세 내용
- Notion: 밤새 작업 전체 리포트

**활동:**

- 개발 작업 (코드 작성, 리팩토링)
- 인간 피드백 반영
- git push, PR 생성, 배포 (승인 후)

### 3-3. 모드 전환 자동화

- [x] launchd 크론 트리거: 23:00 → SLEEP (`com.fas.sleep.plist`), 07:30 → AWAKE (`com.fas.awake.plist`)
- [x] `scripts/mode_switch.sh` — Gateway API 호출로 모드 전환 + 로깅
- [x] 모드 전환 시 현재 작업 저장 + 컨텍스트 핸드오프 — `src/captain/context_handoff.ts` (2026-03-21)
  - [x] HandoffStore: 파일 기반 JSON 스냅샷 저장/복원 (30개 retention)
  - [x] build_snapshot: TaskStore → HandoffSnapshot 생성
  - [x] format_briefing: SLEEP↔AWAKE 전환 브리핑 포맷

---

## Phase 4: 반복 태스크 자동화

### 4-1. 창업지원사업 정보 수집 (3일 주기) — 파서 구현 완료 ✅

- [x] K-Startup 구조화 파서 — `src/hunter/startup_grants.ts` (2026-03-21)
  - [x] `parse_grant_announcements`: HTML 테이블 파싱
  - [x] `detect_new_grants`: seen_grants.json 기반 신규 감지
  - [x] `match_grant_to_profile`: 자격 자동 매칭 (high/medium/low/skip)
  - [x] `calculate_deadline_alerts`: D-7/D-3/D-1 마감 알림
  - [x] `generate_grant_report`: 구조화 리포트
  - [x] `handle_web_crawl` 통합: k-startup URL 자동 분기
- [ ] 크롤링 대상 확장:
  - **정부**: 창업진흥원, 중소벤처기업부, 서울산업진흥원 (SBA)
  - **민간**: Google for Startups (startup.google.com), D.CAMP (dcamp.kr)
- [ ] 마감일 알림 → Telegram 연동
- [ ] 보고서 → Notion 페이지 생성 → Slack 전달

### 4-2. 로또 청약 정보 수집 (3일 주기)

- [ ] 청약홈 (applyhome.co.kr) 모니터링
- [ ] 신규 공고 → 분석 보고서 자동 생성
  - 위치, 가격, 경쟁률 예상, 자격 충족 여부
- [ ] 보고서 → Notion + Telegram 전송 → 인간 승인 → 직접 청약

### 4-3. 블라인드 네이버 인기글 모니터링 (매일)

- [x] 스케줄 등록: `chatgpt_task`로 변경 (web_crawl 직접 접근 → 안티봇 차단 → OpenClaw 검색엔진 우회로 전환)
- [ ] 블라인드 네이버 채널 모니터링 (RSS/검색엔진 우회 — 직접 크롤링은 안티봇에 차단됨)
- [ ] 인기글 감지 기준: 댓글 50+ OR 좋아요 100+ OR 자극적 키워드 매칭
- [ ] 감지 시 → 요약 + 원문 링크 → Slack 보고
- [ ] 단톡방 공유는 주인님이 직접 (카카오톡 API는 비즈니스 인증 없이 불가)

### 4-4. AI 트렌드 리서치 (SLEEP 모드, 매일)

- [x] 스케줄 등록: `hunter` (chatgpt_task)로 재할당 (gemini_a 실행기 미구현 → 당장 hunter로 처리)
- [ ] 소스: Hacker News, Reddit (r/MachineLearning, r/LocalLLaMA), arxiv, Twitter/X
- [ ] 일일 트렌드 리포트 생성
- [ ] 관심 키워드 필터: 에듀테크, NVC, 1인창업, 자동화, 로컬LLM
- [ ] Notion 페이지 생성 → Slack 전달

### 4-5. 글로벌 빅테크 취업 공고 체크 (3일 주기)

- [ ] 대상: Google, Meta, Apple, Amazon, Microsoft, Netflix 등 글로벌 인지도 높은 기업
- [ ] 조건 필터: 주인님 스펙 기반 (TS 풀스택 6년, 석사, 영어 가능)
- [ ] 한국 오피스 + 해외 포지션 모두 체크 (TODO: 조건 상세 확정)
- [ ] 매칭되는 공고 발견 시 → Notion 보고서 + Telegram 알림

### 4-6. 대학원 지원 일정 알림

- [x] 스케줄 등록: `hunter` (chatgpt_task)로 재할당 (gemini_a → hunter)
- [ ] **조지아텍 OMSCS**: 지원 일정, 준비물, 마감일 추적
- [ ] **서울대 GSEP**: 지원 일정, 준비물, 마감일 추적
- [ ] 마감 D-30, D-14, D-7, D-3 단계별 알림 (Telegram)
- [ ] 준비 체크리스트 자동 생성

### 4-7. 원격 학위 과정 조사 (초기 리서치 → 이후 주기적 갱신)

- [ ] 원격 석사/학사 편입 과정 조사 (해외 유명 대학 위주)
- [ ] 조건: 원격 수업 가능, 인지도 높은 학교
- [ ] Deep Research(헌터)로 초기 포괄 조사 → 보고서

### 4-8. SEO/성능 측정 (RECURRING, 추후)

- [ ] Lighthouse CI 주기적 실행
- [ ] 성능 저하 감지 시 알림

---

## Phase 5: 학원 업무 자동화

### 5-1. 공통과학 자체 교재 제작 (EIDOS SCIENCE)

- [ ] 기존 교재 구조 분석 (하이탑 레벨 기준)
- [ ] 단원별 콘텐츠 생성: 개념 설명 + 예제 + 연습문제
- [ ] 교재 디자인: 검정/골드/화이트 (EIDOS SCIENCE 브랜드)
- [ ] 주인님 검수 → 최종 PDF 생성

### 5-2. 학생 데이터 관리 — 구현 완료 ✅

- [x] 학생별 프로필 CRUD — `src/academy/student_store.ts` (2026-03-21)
  - [x] 파일 기반 JSON 저장 (MongoDB 교체 가능한 인터페이스)
  - [x] 학생 생성/조회/수정/삭제 + 필터링 (학년/반 유형)
- [x] 시험 결과 자동 기록 & 성적 추이 분석
  - [x] `record_score`, `get_score_history` (과목별 필터)
  - [x] `analyze_trends`: 선형회귀 기반 추세 분석 (improving/declining/stable)
- [x] 학생별 강약점 리포트 자동 생성
  - [x] `generate_student_report`: 과목별 강점/약점 + 추천사항

### 5-3. 수업 후 학부모 문자 자동 생성 — 초안 생성 구현 완료 ✅

- [x] 템플릿 기반 초안 자동 생성 — `src/academy/parent_message.ts` (2026-03-21)
  - [x] `generate_parent_message`: 학생 컨텍스트 + 키워드 → 200-500자 메시지
  - [x] `apply_tone_rules`: formal/caring/enthusiastic 톤 변환
  - [x] `validate_message`: 글자수/섹션/부적절 표현 검증
  - [x] 반 유형별(일반/오금고/의대) 맞춤 문구
- [ ] 발송: 문자 발송 API (알리고 등) 또는 Google Messages 웹 연동

### 5-4. 주간 테스트 생성 자동화 — 생성기 구현 완료 ✅

- [x] 객관식 시험지 생성 — `src/academy/test_generator.ts` (2026-03-21)
  - [x] `create_question_bank`: 물리/역학 28문항 (난이도별)
  - [x] `generate_test`: 난이도 필터링 + 셔플 + 메타데이터
  - [x] `format_test_sheet`: EIDOS SCIENCE 인쇄용 포맷
  - [x] `format_answer_key`: 정답 그리드 + 해설
  - [x] `validate_test`: 구조 무결성 검증
- [x] PDF 포맷 출력 — `src/academy/pdf_generator.ts` (2026-03-21)
  - [x] PDFKit 기반 A4 레이아웃, EIDOS SCIENCE 브랜딩
  - [x] 한국어 NotoSansKR 폰트 지원
  - [x] 시험지 + 정답지 + combined 생성

---

## Phase 6: 캐시플로우 & 사업화 파이프라인

### 6-0. 개발 인프라

- [ ] **웹 개발 보일러플레이트**: 정형화된 웹 프로젝트를 빠르게 생성하는 템플릿
  - Next.js + TypeScript + TailwindCSS + Vercel 배포
  - API: NestJS or Next.js API Routes
  - DB: MongoDB (기본) / Supabase (대안)
  - 인증, SEO, 모니터링 기본 포함
  - `npx create-fas-app` 수준의 CLI 도구화
- [ ] **SEO/GEO 최적화 컨설팅 자동화**:
  - 대상 사이트 URL 입력 → Lighthouse + Core Web Vitals 자동 분석
  - GEO(Generative Engine Optimization) 점수 측정
  - 개선 사항 자동 리포트 생성 (Notion)
  - 주기적 재측정 → 변화 추적
  - 향후 유료 컨설팅 서비스로 확장 가능

### 6-0b. B2B 인텐트 크롤링

- [x] **B2B 인텐트 크롤링 파이프라인** — Crawl4AI + OpenClaw + Clay.com (2026-03-22)
  - [x] `src/pipeline/b2b_intent_pipeline.ts` 구현
  - [x] schedules.yml에 b2b_intent_crawl 등록 (04:30, hunter)
  - [ ] Crawl4AI Docker 실행 + Clay.com webhook URL 설정 *(인간 작업)*

### 6-1. 캐시플로우 프로젝트 발굴

- [ ] AI가 주기적으로 수익 가능한 마이크로 프로젝트 발굴
  - 조건: 주인님 개입 최소, 꾸준한 소액 수입, 웹/앱/스크립트로 구현 가능
- [ ] 발굴된 아이디어 → 타당성 분석 보고서 (Notion)
  - 시장 규모, 경쟁 상황, 예상 수익, 구현 난이도
- [ ] 주인님 승인 시 → Phase 6-3으로 진행

### 6-2. 아이디어 → 사업화 파이프라인

주인님이 아이디어를 제시하면 자동으로:

- [ ] **시장 분석**: 시장 규모, 트렌드, 성장성
- [ ] **경쟁자 분석**: 기존 서비스, 강약점, 차별화 포인트
- [ ] **수익 분석**: 수익 모델, BEP, 3년 예상 매출
- [ ] **마케팅 전략**: 타겟 고객, 채널, 초기 전략
- [ ] **기술 문서**: 앱 개발팀에 전달할 수준의 상세 기획서
  - 기능 명세, 화면 설계, API 설계, DB 설계
- [ ] 전체 산출물 → Notion 프로젝트 페이지

### 6-3. 무중단 구현 프로세스

승인된 프로젝트를 AI가 거의 자율적으로 구현:

- [ ] **문서화 루틴**: 프로젝트별 완벽한 설명/기획/상세 문서 작성
  - README, PLAN, SPEC, API 문서, 테스트 계획
- [ ] **구현**: Claude Code + Gemini 교차 검증으로 코드 작성
- [ ] **테스트**: TDD 기반, 자동 테스트 실행
- [ ] **배포**: 승인 후 Vercel/자체 서버 배포
- [ ] **모니터링**: 배포 후 상태 감시

### 6-4. 마케팅 & 트래픽 자동화 (Sales Pipeline)

개발/기획은 AI가 해내지만, 팔려면 마케팅이 필요하다.

- [ ] **SEO 블로그 자동 포스팅**: 학원 홍보, 개발 블로그, 기술 글 → AI 작성 → SEO 최적화 → 자동 발행
- [ ] **소셜 미디어 자동 홍보**: X(Twitter), LinkedIn에 개발 중인 서비스 홍보 봇
- [ ] **이메일 마케팅**: 리드 수집 → 자동 시퀀스 발송

### 6-5. 학원 IP 수익화

교재/시험지를 학원 내부용으로만 쓰지 않고 패시브 인컴 창출.

- [ ] 완성된 교재/기출 요약 → PDF 자동 포매팅
- [ ] 크몽(Kmong), 전자책 플랫폼에 자동 업로드
- [ ] 판매 현황 모니터링 → Slack 보고

### 6-6. B2B SaaS 전환 (무인 결제 → 자동 리포트)

컨설팅 형태는 주인님 시간이 들어감. 완전 무인 SaaS로 확장.

- [ ] SEO/GEO 분석 서비스: 고객이 웹에서 결제 → FAS가 백그라운드 분석 → 리포트 이메일 자동 발송
- [ ] 결제 연동: Stripe 또는 Toss Payments API
- [ ] 리포트 자동 생성 + 발송 파이프라인
- [ ] 고객 대시보드 (Next.js)

---

## Phase 7: 안정화 + 모니터링 고도화

### 7-1. 로깅 & 감사 — 구현 완료 ✅

- [x] 파일 기반 활동 로그 — `src/watchdog/file_logger.ts` (2026-03-21)
  - [x] 에이전트별 로그: `logs/{agent}/{date}.log`
  - [x] 승인 감사 로그: `logs/approvals/{date}.json` (JSONL)
  - [x] 30일 자동 정리 (log rotation)
- [ ] Slack 채널별 자동 로그 전송

### 7-2. 리소스 모니터링

- [ ] **디바이스 리소스**: CPU/RAM/디스크 사용량 추적
  - 리소스 부족 시 → Telegram 알림 + 구매 제안
- [ ] **AI 토큰 사용량**: 구독별 사용량 대비 잔여량 추적
  - 토큰을 최대한 활용하도록 태스크 배분 최적화
  - 사용량 부족 시 → 추가 태스크 자동 배정
  - 한도 초과 임박 시 → Telegram 알림 + 플랜 업그레이드 제안

### 7-3. 장애 대응 — 크래시 복구 구현 완료 ✅

- [x] 에이전트 크래시 모니터 — `src/watchdog/crash_recovery.ts` (2026-03-21)
  - [x] 크래시 기록 + 자동 재시작 (3회까지)
  - [x] 3회 초과 → 재시작 차단 (격리)
  - [x] `state/crash_history.json`에 영구 저장
- [ ] 크래시 시 인간 알림 (Telegram) 연동
- [ ] 네트워크 단절 → 로컬 큐에 쌓아두고 복구 후 재개

### 7-3b. 데이터 내구성

- [x] 태스크 결과 Notion 백업 파이프라인 구현 — `server.ts`에서 fire-and-forget
- [ ] Notion DB 생성 + API Key 설정 (인간 작업)
- [x] SQLite 정기 백업 — `scripts/backup_sqlite.sh` + `com.fas.sqlite-backup.plist` (2026-03-21)
  - [x] WAL-safe sqlite3 .backup → iCloud + 외장 6TB
  - [x] 30일 retention, 자동 정리
  - [x] launchd daily 04:00 트리거
- [x] 백업 무결성 검증 — `scripts/verify_backup_integrity.ts` (2026-03-21)
  - [x] integrity_check, task count 비교, CLI 실행 가능

### 7-4. 보안 — API 화이트리스트 + PII 모니터 구현 완료 ✅

- [ ] API 키 관리: macOS Keychain 또는 1Password CLI
- [x] 헌터 격리 유지 확인 — `src/gateway/pii_monitor.ts` (2026-03-21)
  - [x] 기존 sanitizer.ts PII 패턴 재활용
  - [x] 헌터 바운드 데이터 PII 탐지 + 콜백 감사 로깅
- [x] 민감 정보 접근 로그 기록 — pii_monitor + file_logger 연동
- [x] 외부 API 호출 화이트리스트 — `src/gateway/api_whitelist.ts` (2026-03-21)
  - [x] 도메인/경로 기반 허용 목록 (Telegram/Slack/Notion/K-Startup 등)
  - [x] 승인 요구 여부 + 리스크 레벨 포함

---

## 추천 구현 순서 (가장 빠른 가치 창출)

핵심 페인 포인트: "평일 회사, 주말 학원 → 개인 시간 거의 0"
→ 가장 먼저 **시간을 벌어주는 태스크**부터 구현.

```text
Phase 0 (인프라)
  → Phase 1 (단일 에이전트 — 필수 뼈대)
    → Phase 5 부분 (학원: 학부모 문자 + 주간 테스트 — 즉시 시간 회수)
      → Phase 4 (크롤러 — SLEEP 모드로 정보 탐색 제로화)
        → Phase 2 & 3 (멀티 에이전트, 교차 검증 — 안정성 확보)
          → Phase 6 (수익화 — 확보된 시간으로 본격 투자)
            → Phase 7 (지속 안정화)
```

## 의존성 그래프

```text
Phase 0 ─┬→ Phase 1 ─→ Phase 2 ─→ Phase 3
          │                          ↓
          ├→ Phase 4 (Phase 1 이후 병렬 가능)
          │
          ├→ Phase 5 (Phase 1 이후 병렬 가능, 우선 착수 권장)
          │
          └→ Phase 6 (Phase 2 이후)
                                     ↓
                               Phase 7 (지속)
```

## AI 플랜 확장 로드맵

비용을 단계적으로 증가시키며 시스템 안정성을 검증한 후 상위 플랜으로 전환한다.
"잘 돌아가는 것을 확인한 뒤 투자"가 원칙.

### Stage 1: 검증 단계 ✅ (완료)

시스템 세팅 + 통신 검증. 이미 보유한 리소스 활용.

| 에이전트 | 플랜 | 월 비용 | 비고 |
|---------|------|---------|------|
| 캡틴 Claude Code | Max (계정 A) | $100 | 이미 사용 중 |
| 캡틴 Gemini CLI | 계정 A (무료 or 기존 플랜) | $0 | 이미 사용 중 |
| 헌터 Google AI | **계정 B Google AI ~$20 플랜 (보유)** | $20 | Gemini CLI, NotebookLM, Deep Research, Antigravity 사용 가능 |
| 헌터 Claude Code | ~~미결제~~ — 계정 B 생성 불가 (전화번호 인증 필수). 코딩 태스크는 Gemini CLI로 임시 대체 | $0 | — |
| 헌터 ChatGPT | ~~미결제~~ → Pro 구독 완료 | ~~$0~~ → $200 | OpenClaw 2026.3.13 설치, OAuth 인증 완료 (Stage 2에서 완료) |
| **월 합계** | | **~$120** | |

**이 단계의 목표:**
- 헌터 ↔ 캡틴 Task API 통신 안정성 확인
- Playwright 기반 web_crawl, browser_task 정상 실행 확인
- 헌터 Google B 계정으로 NotebookLM, Deep Research 기본 동작 확인

**승격 조건:** Task API 연속 3일 무장애, 핸들러 4종 정상 동작 확인

### Stage 2: 운영 단계 (현재 — OpenClaw 설치 완료, 헌터 머신 세팅 대기)

저가 AI 플랜으로 실제 업무를 돌리며 안정성 체감.

**Stage 2 인프라 구현 현황:**
- [x] 반복 스케줄 시스템 (`config/schedules.yml` + Planning Loop)
- [x] SLEEP/AWAKE 자동 전환 (launchd + mode_switch.sh)
- [x] 헌터 Heartbeat 모니터 (2분 WARNING, 5분 ALERT, RECOVERY)
- [x] 캡틴 통합 진입점 (`pnpm captain` — Gateway + Watcher + Planning + Hunter Monitor)
- [x] 헌터 배포/검증 스크립트
- [x] 헌터 watchdog (자동 재시작 + 크래시 보고)
- [x] 통합 테스트 (캡틴 ↔ 헌터 왕복 15건)
- [x] 활동 로거 + 리소스 모니터
- [x] Persona Injector — PII-free 사용자 컨텍스트 주입 (`src/captain/persona_injector.ts`)
- [x] Telegram Command Listener — 인바운드 명령 수신 (`src/captain/telegram_commands.ts`)
- [x] VNC Restorer — 헌터 로그인 화면 복구 스크립트 (`scripts/resolve_hunter_login.sh`)
- [x] Feedback Extractor — 나이트 사이클에서 교훈 추출 통합 (`main.ts`)
- [x] Notion Router 연결 — `router.ts`에 NotionClient 연결 완료
- [x] `action` 필드 — Task 타입에 추가, schedules.yml → TaskStore → Hunter 전달
- [x] 확장 스케줄 — `edutech_competitors`, `blind_nvc_monitor` 추가; `bigtech_jobs`, `lotto_housing` chatgpt_task로 업그레이드
- [x] OpenClaw 설치 완료 — Node.js 22 업그레이드, OpenClaw 2026.3.13, ChatGPT Pro OAuth 인증, Gateway 데몬 가동 (2026-03-19)
- [x] Telegram 인바운드 라우팅 보안 수정 — 일반 텍스트 기본 라우팅을 `hunter` → `captain`으로 변경 (PII 보호)
- [x] 독트린 ↔ 로컬 심링크 정비 — 메모리 6개 파일 독트린 병합, hooks 확장 및 독트린 이전
- [ ] **인간 작업**: 헌터 머신 초기 세팅 (`setup_hunter.sh` 실행)
- [x] **인간 작업**: ChatGPT Pro 구독 + OpenClaw OAuth 인증 완료
- [ ] **인간 작업**: Notion API Key 발급 + DB 생성

| 에이전트 | 플랜 | 월 비용 | 비고 |
|---------|------|---------|------|
| 캡틴 Claude Code | Max (계정 A) | $100 | 유지 |
| 캡틴 Gemini CLI | 유지 | $0 | 유지 |
| 헌터 Google AI | 계정 B (~$20 플랜) | $20 | 유지 |
| 헌터 Claude Code | ~~Pro (계정 B)~~ — 계정 B 생성 불가. Gemini CLI로 임시 대체 | $0 | — |
| 헌터 ChatGPT | **Pro** ($200) | **$200** | OpenClaw 2026.3.13 설치 완료, OAuth 인증 완료 |
| **월 합계** | | **~$320** (Claude Code 항목 제외) | |

**이 단계의 목표:**
- SLEEP 모드 야간 자동 크롤링 실운영
- 교차 검증 파이프라인 (Claude ↔ Gemini ↔ NotebookLM) 실운영
- 헌터 태스크 처리량과 품질 측정
- 병목 지점 식별 (토큰 한도, 속도, 품질)

**승격 조건:** 주인님이 "이제 진짜 잘 돌아간다"고 판단

### Stage 3: 풀 스케일

검증된 시스템에 최대 화력 투입.

| 에이전트 | 플랜 | 월 비용 | 비고 |
|---------|------|---------|------|
| 캡틴 Claude Code | Max (계정 A) | $100 | 유지 |
| 캡틴 Gemini CLI | 유지 | $0 | 유지 |
| 헌터 Google AI | 계정 B (유지 or 업그레이드) | $20+ | 유지 |
| 헌터 Claude Code | ~~Max x20 (계정 B)~~ — 계정 B 생성 불가. 대안 검토 필요 | TBD | — |
| 헌터 ChatGPT | **Pro** ($200) | **$200** | Deep Research 무제한 |
| **월 합계** | | **~$320+** (Claude Code TBD 별도) | |

**이 단계의 목표:**
- 24시간 무중단 멀티 에이전트 풀 가동
- Phase 4 (반복 크롤러), Phase 5 (학원 자동화), Phase 6 (사업화) 본격 진행
- Deep Research 대량 실행, NotebookLM 자동 검증
- 주인님 개인 시간 극대화

---

## 리스크 & 대응

| 리스크                              | 영향   | 대응                                  |
| ----------------------------------- | ------ | ------------------------------------- |
| 할루시네이션 기반 잘못된 행동       | 신뢰   | NotebookLM(헌터) + 교차검증 2중 체크  |
| Mac Studio 하드웨어 장애            | 가용성 | Telegram 즉시 알림 → 수동 복구 (캡틴이 SPOF이므로 이중화 미지원, 현실적 대응) |
| Telegram Bot 응답 누락              | 운영   | 타임아웃 → 자동 안전모드 (읽기전용)   |
| 헌터 개인정보 유입                  | 보안   | Task API 산이타이징 레이어 + 모니터링 |
| AI 서비스 장애 (Claude/Gemini 다운) | 가용성 | 다른 AI로 자동 폴백                   |
| 디바이스 리소스 부족                | 성능   | 모니터링 + 주인님에게 구매 제안       |
| AI 토큰 사용량 한도 초과            | 생산성 | 모니터링 + 플랜 업그레이드 제안       |
