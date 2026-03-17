# PLAN.md — Fully Automation System 구축 계획

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

### 0-2. tmux 환경 구성
- [ ] 캡틴, 헌터에 tmux 설치
- [ ] 자동 세션 복구 스크립트 (`tmux-resurrect` 또는 커스텀)
- [ ] 세션 네이밍 컨벤션:
  - 캡틴: `fas-claude`, `fas-gemini-a`, `fas-gemini-b`, `fas-n8n`, `fas-gateway`, `fas-watchdog`
  - 헌터: `fas-openclaw`, `fas-watchdog`

### 0-3. 소통 채널 구축
- [ ] **Telegram Bot** 생성 (BotFather) — 긴급 알림 전용
  - Chat ID 확인
  - 알림 전송 모듈 (TypeScript)
  - `send_notification(level: 'info' | 'approval' | 'critical', message: string)`
  - `wait_for_approval(timeout_minutes: number): Promise<boolean>`
  - Galaxy Watch 텔레그램 알림 허용 설정
- [ ] **Slack 워크스페이스** 생성 — 업무 소통
  - 채널 구성: `#captain-logs`, `#hunter-logs`, `#approvals`, `#reports`, `#alerts`
  - Slack Bot 토큰 발급
  - 디바이스별/업무별 채널 그룹핑
- [ ] **Notion** 연동 — 보고서/긴 문서
  - Notion API Integration 생성
  - 보고서 템플릿 데이터베이스 생성
  - 페이지 생성 → URL 전달 자동화

### 0-4. Docker 환경 (캡틴)
- [ ] 캡틴에 Colima 설치
- [ ] n8n Docker Compose 파일 작성
- [ ] 볼륨 매핑: `~/.n8n` → 외장하드 백업 경로

### 0-5. AI CLI 설치 & 인증
- [ ] Claude Code: 캡틴에 OAuth 로그인 (Max 플랜)
- [ ] Gemini CLI: 캡틴에 2개 계정 인증 설정 (프로필 분리)
- [ ] OpenClaw: 헌터에 ChatGPT Pro 연동 (격리 계정)
- [ ] 헌터 별도 구글 계정에 Gemini 플랜 결제 (NotebookLM + Deep Research용)

### 0-6. 헌터 ↔ 캡틴 통신 구축
- [ ] 캡틴에 Task API 서버 구축 (Express, Tailscale 내부만 접근)
  - `POST /tasks` — 캡틴 → 헌터 태스크 전달 (개인정보 제거된 상태)
  - `GET /tasks/pending` — 헌터가 할당된 태스크 폴링
  - `POST /tasks/:id/result` — 헌터 → 캡틴 결과 전달
  - `GET /health` — 헬스체크
- [ ] 개인정보 산이타이징 레이어: 캡틴에서 헌터로 보내기 전 자동 필터링
- [ ] 헌터는 캡틴 파일시스템에 직접 접근 불가 (API 통신만 허용)

---

## Phase 1: 단일 에이전트 자동화

### 1-1. Claude Code 상시 실행 체계 (캡틴)
- [ ] tmux 세션 자동 시작 스크립트 (launchd)
- [ ] Claude Code 출력 감시 → Telegram/Slack 전송 스크립트
  - 승인 요청 패턴 감지: `[APPROVAL_NEEDED]`, `[BLOCKED]`
  - 마일스톤 완료 패턴: `[MILESTONE]`, `[DONE]`
- [ ] 자동 재시작 (크래시 복구): `while true; do claude; sleep 5; done` 래퍼
- [ ] CLAUDE.md에 자율 실행 범위 명시

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

### 1-4. 작업 큐 시스템 (간이)
- [ ] `tasks/` 디렉토리 기반 파일 큐
  - `tasks/pending/`, `tasks/in_progress/`, `tasks/done/`, `tasks/blocked/`
- [ ] 태스크 파일 포맷:
  ```yaml
  id: task_001
  title: "창업지원사업 정보 수집 자동화"
  priority: high
  assigned_to: gemini_a
  mode: sleep  # sleep | awake | recurring
  risk_level: low  # low | mid | high
  requires_personal_info: false  # true면 헌터 배정 금지
  created_at: 2026-03-17
  deadline: null
  depends_on: []
  ```
- [ ] 에이전트별 태스크 폴링 스크립트

---

## Phase 2: 멀티 에이전트 + 교차 승인

### 2-1. 교차 승인 프로토콜 구현
- [ ] 승인 요청 표준 포맷 정의
- [ ] 승인 게이트웨이 서비스 (TypeScript)
  - `LOW` → 즉시 실행, 로그만 기록
  - `MID` → 다른 AI에게 검증 요청 → 승인/거부
  - `HIGH` → Telegram으로 인간에게 전송 → 응답 대기
- [ ] 교차 검증 로직:
  - Claude 작업물 → Gemini가 리뷰 (또는 그 반대)
  - 불일치 시 → NotebookLM(헌터)에게 검증 요청
  - 최종 불일치 시 → 무조건 인간 승인

### 2-2. n8n 워크플로우 설계
- [ ] 마스터 오케스트레이션 워크플로우
- [ ] 에이전트 헬스체크 워크플로우 (5분마다)
- [ ] 리소스 모니터링 워크플로우 (CPU/RAM/디스크)
- [ ] AI 토큰 사용량 추적 워크플로우

### 2-3. 할루시네이션 방지 파이프라인
- [ ] NotebookLM 연동 (헌터의 OpenClaw가 웹 자동화로 실행):
  - 에이전트 산출물을 NotebookLM에 업로드
  - 검증 실패 시 → `blocked` 상태 + 사유 기록
- [ ] Cross-AI 팩트체크 (Claude ↔ Gemini)
- [ ] Deep Research 활용 (헌터의 별도 구글 계정):
  - 새 도메인 진입 시 초기 자료 수집
  - 결과를 `research/` 디렉토리에 구조화 저장

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
- [ ] n8n 크론 트리거: 23:00 → SLEEP, 07:30 → AWAKE
- [ ] 모드 전환 시 현재 작업 저장 + 컨텍스트 핸드오프

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
- [ ] 블라인드 네이버 채널 모니터링
- [ ] 인기글 감지 기준 정의 (좋아요/댓글 수 임계값 — TODO: 기준 확정)
- [ ] 감지 시 → 요약 + 원문 링크 → Slack 보고
- [ ] 단톡방 직접 공유는 주인님이 판단 후 수동 (또는 n8n 카카오톡 연동 시도)

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
- [ ] 주인님이 학생별 키워드/특이사항 제공 → AI가 학부모 문자 초안 생성
- [ ] 톤: 정중하고 전문가적이면서 학생을 애정하는 느낌
- [ ] 주인님 확인 후 발송 (TODO: 발송 수단 확정 — 문자? 카카오?)

### 5-4. 주간 테스트 생성 자동화
- [ ] 과목/단원 지정 → 객관식 위주 시험지 자동 생성
- [ ] 난이도 조절: 일반반 / 오금고반 / 의대반
- [ ] 정답지 + 해설 자동 생성
- [ ] PDF 포맷 출력

---

## Phase 6: 캐시플로우 & 사업화 파이프라인

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

---

## Phase 7: 안정화 + 모니터링 고도화

### 7-1. 로깅 & 감사
- [ ] 모든 에이전트 활동 로그: `logs/{agent}/{date}.log`
- [ ] 승인 이력: `logs/approvals/{date}.json`
- [ ] Slack 채널별 자동 로그 전송

### 7-2. 리소스 모니터링
- [ ] **디바이스 리소스**: CPU/RAM/디스크 사용량 추적
  - 리소스 부족 시 → Telegram 알림 + 구매 제안
- [ ] **AI 토큰 사용량**: 구독별 사용량 대비 잔여량 추적
  - 토큰을 최대한 활용하도록 태스크 배분 최적화
  - 사용량 부족 시 → 추가 태스크 자동 배정
  - 한도 초과 임박 시 → Telegram 알림 + 플랜 업그레이드 제안

### 7-3. 장애 대응
- [ ] 에이전트 크래시 → 자동 재시작 (3회까지)
- [ ] 3회 실패 → 인간 알림 + 해당 에이전트 격리
- [ ] 네트워크 단절 → 로컬 큐에 쌓아두고 복구 후 재개

### 7-4. 보안
- [ ] API 키 관리: macOS Keychain 또는 1Password CLI
- [ ] 헌터 격리 유지 확인 (개인정보 유입 모니터링)
- [ ] 민감 정보 접근 로그 기록
- [ ] 외부 API 호출 화이트리스트

---

## 의존성 그래프

```
Phase 0 ─┬→ Phase 1 ─→ Phase 2 ─→ Phase 3
          │                          ↓
          ├→ Phase 4 (일부 Phase 1 이후 병렬 가능)
          │
          ├→ Phase 5 (Phase 1 이후 병렬 가능)
          │
          └→ Phase 6 (Phase 2 이후)
                                     ↓
                               Phase 7 (지속)
```

## 리스크 & 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 할루시네이션 기반 잘못된 행동 | 신뢰 | NotebookLM(헌터) + 교차검증 2중 체크 |
| Mac Studio 하드웨어 장애 | 가용성 | 핵심 워크플로우는 양쪽에 이중화 |
| Telegram Bot 응답 누락 | 운영 | 타임아웃 → 자동 안전모드 (읽기전용) |
| 헌터 개인정보 유입 | 보안 | Task API 산이타이징 레이어 + 모니터링 |
| AI 서비스 장애 (Claude/Gemini 다운) | 가용성 | 다른 AI로 자동 폴백 |
| 디바이스 리소스 부족 | 성능 | 모니터링 + 주인님에게 구매 제안 |
| AI 토큰 사용량 한도 초과 | 생산성 | 모니터링 + 플랜 업그레이드 제안 |
