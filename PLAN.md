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
  - 캡틴: `fas-claude`, `fas-gemini-a`, `fas-gemini-b`, `fas-n8n`, `fas-gateway`, `fas-watchdog`
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
- [ ] **Notion** 연동 — 보고서/긴 문서 *(Phase 2에서 구현 예정)*

### 0-4. Docker 환경 (캡틴) ✅

- [x] 캡틴에 Colima + Docker 설치 완료 (Docker 29.2.1)
- [x] n8n Docker Compose 파일 작성 — `docker-compose.yml`
- [x] 볼륨 매핑: tasks, state, reports, config

### 0-5. AI CLI 설치 & 인증 ✅

- [x] 인증 가이드 스크립트 — `scripts/setup/setup_ai_cli.sh`
- [x] Claude Code: 캡틴에 OAuth 로그인 (Max 플랜)
- [x] Gemini CLI: 캡틴에 2개 계정 인증 설정 (v0.33.2)
- [ ] OpenClaw: 헌터에 ChatGPT Pro 연동 *(인간 작업 — 헌터 머신에서 별도 진행)*

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
- [x] 자동 재시작 (크래시 복구) — `scripts/agent_wrapper.sh` (지수 백오프, 최대 3회)
- [x] CLAUDE.md에 자율 실행 범위 명시

### 1-2. Gemini CLI 상시 실행 체계 (캡틴)

- [ ] 계정 A: 리서치 전용 세션
- [ ] 계정 B: 교차 검증 전용 세션
- [ ] 출력 로깅 + Telegram/Slack 연동

### 1-3. OpenClaw 안정화 (헌터)

- [ ] ChatGPT Pro 연동 완료
- [ ] 개인정보 유입 방지 확인
- [ ] 기본 태스크 실행 테스트
- [ ] NotebookLM 웹 자동화 테스트
- [ ] Gemini Deep Research 웹 자동화 테스트

### 1-4. 작업 큐 시스템 ✅

- [x] SQLite 기반 태스크 큐 (`task_store.ts`) — 파일 큐 대신 SQLite로 구현
- [x] 에이전트별 태스크 폴링 — `hunter/poll_loop.ts` (API 기반)

---

## Phase 2: 멀티 에이전트 + 교차 승인

### 2-1. 교차 승인 프로토콜 구현

- [x] 승인 요청 표준 포맷 정의 — `CrossApprovalResult`, `CrossApprovalConfig` 타입 (`src/shared/types.ts`)
- [x] Gemini CLI 교차 승인 모듈 — `src/gateway/cross_approval.ts`
  - `LOW` → 즉시 실행, 로그만 기록
  - `MID` → Gemini CLI spawn → JSON 응답 파싱 → 승인/거부
  - `HIGH` → Telegram으로 인간에게 전송 → 응답 대기
  - 10분 타임아웃 / JSON 파싱 실패 → 자동 거부 (secure by default)
- [ ] 교차 검증 로직 (n8n 워크플로우 통합):
  - Claude 작업물 → Gemini가 리뷰 (또는 그 반대)
  - 불일치 시 → NotebookLM(헌터)에게 검증 요청
  - 최종 불일치 시 → 무조건 인간 승인

### 2-2. n8n 워크플로우 설계

- [ ] 마스터 오케스트레이션 워크플로우
- [x] 에이전트 헬스체크 API — `GET /api/agents/health` (n8n 워크플로우는 세션 C)
- [ ] 리소스 모니터링 워크플로우 (CPU/RAM/디스크)
- [ ] AI 토큰 사용량 추적 워크플로우

### 2-3. 할루시네이션 방지 파이프라인

- [ ] NotebookLM 연동 (구글 계정 2개, 섀도우/캡틴/헌터 모두 사용 가능):
  - 에이전트 산출물을 NotebookLM에 업로드하여 검증
  - 헌터: OpenClaw 웹 자동화로 실행
  - 캡틴/섀도우: Gemini API 또는 웹 자동화 코드로 실행
  - 검증 실패 시 → `blocked` 상태 + 사유 기록
- [ ] Cross-AI 팩트체크 (Claude ↔ Gemini)
- [ ] Deep Research 활용 (구글 계정 2개, 동시 3건 제한):
  - 새 도메인 진입 시 초기 자료 수집
  - 결과를 `research/` 디렉토리에 구조화 저장
  - 사용량 한도 도달 시 → 주인님에게 보고 → 플랜 업그레이드 또는 추가 계정 구매

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

- [x] 모드 전환 API (`POST /api/mode`) — n8n 크론 연동은 세션 C
- [x] ModeManager — SLEEP 시 위험 액션 자동 차단 (`mode_manager.ts`)

---

## Phase 4: 반복 태스크 자동화

### 4-1. 창업지원사업 정보 수집 (3일 주기)

- [ ] 크롤링 대상:
  - **정부**: K-Startup (k-startup.go.kr), 창업진흥원, 중소벤처기업부, 서울산업진흥원 (SBA)
  - **민간**: Google for Startups (startup.google.com), D.CAMP (dcamp.kr), 기타 규모 있는 민간 프로그램
- [ ] 신규 공고 감지 → 자격 자동 매칭 (주인님 프로필 기반)
- [ ] 마감일 D-7, D-3, D-1 알림 (Telegram 긴급)
- [ ] 보고서 → Notion 페이지 생성 → Slack 전달

### 4-2. 로또 청약 정보 수집 (3일 주기)

- [ ] 청약홈 (applyhome.co.kr) 모니터링
- [ ] 신규 공고 → 분석 보고서 자동 생성
  - 위치, 가격, 경쟁률 예상, 자격 충족 여부
- [ ] 보고서 → Notion + Telegram 전송 → 인간 승인 → 직접 청약

### 4-3. 블라인드 네이버 인기글 모니터링 (매일)

- [ ] 블라인드 네이버 채널 모니터링 (RSS/검색엔진 우회 — 직접 크롤링은 안티봇에 차단됨)
- [ ] 인기글 감지 기준: 댓글 50+ OR 좋아요 100+ OR 자극적 키워드 매칭
- [ ] 감지 시 → 요약 + 원문 링크 → Slack 보고
- [ ] 단톡방 공유는 주인님이 직접 (카카오톡 API는 비즈니스 인증 없이 불가)

### 4-4. AI 트렌드 리서치 (SLEEP 모드, 매일)

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

### 5-2. 학생 데이터 관리

- [ ] 학생별 프로필: 학년, 반, 성적 이력, 특이사항
- [ ] 시험 결과 자동 기록 & 성적 추이 분석
- [ ] 학생별 강약점 리포트 자동 생성
- [ ] (TODO: 상세 데이터 항목 확정)

### 5-3. 수업 후 학부모 문자 자동 생성

- [ ] AI가 기존 학생 데이터(성적 추이, 출결, 지난 메모) 기반으로 **선제적 초안 자동 생성**
- [ ] 주인님은 수업 후 키워드만 추가 입력 → 초안 보강 → 승인(Yes/No)만
- [ ] 톤: 정중하고 전문가적이면서 학생을 애정하는 느낌
- [ ] 발송: 문자 발송 API (알리고 등) 또는 Google Messages 웹

### 5-4. 주간 테스트 생성 자동화

- [ ] 과목/단원 지정 → 객관식 위주 시험지 자동 생성
- [ ] 난이도 조절: 일반반 / 오금고반 / 의대반
- [ ] 정답지 + 해설 자동 생성
- [ ] PDF 포맷 출력

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

### 7-1. 로깅 & 감사

- [x] 구조화된 활동 로그 — SQLite `activity_logger.ts` (에이전트/날짜별 조회)
- [x] 승인 이력 — SQLite `approval_history` 테이블 (`activity_logger.ts`)
- [ ] Slack 채널별 자동 로그 전송

### 7-2. 리소스 모니터링

- [x] 디바이스 리소스 모니터링 — `resource_monitor.ts` (CPU/RAM/디스크, 임계값 알림)
  - [ ] 리소스 부족 시 → Telegram 알림 + 구매 제안
- [ ] **AI 토큰 사용량**: 구독별 사용량 대비 잔여량 추적
  - 토큰을 최대한 활용하도록 태스크 배분 최적화
  - 사용량 부족 시 → 추가 태스크 자동 배정
  - 한도 초과 임박 시 → Telegram 알림 + 플랜 업그레이드 제안

### 7-3. 장애 대응

- [x] 크래시 감지 — `output_watcher.ts` crash detection + `POST /api/agents/:name/crash`
- [ ] 3회 실패 → 인간 알림 + 해당 에이전트 격리
- [x] 네트워크 단절 → `local_queue.ts` (SQLite, 자동 재시도 + flush)

### 7-4. 보안

- [ ] API 키 관리: macOS Keychain 또는 1Password CLI
- [ ] 헌터 격리 유지 확인 (개인정보 유입 모니터링)
- [ ] 민감 정보 접근 로그 기록
- [ ] 외부 API 호출 화이트리스트

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
