# PLAN.md — Fully Automation System 구축 계획

## 전체 로드맵

```
Phase 0: 인프라 기반 세팅          (1~2일)
Phase 1: 단일 에이전트 자동화       (3~5일)
Phase 2: 멀티 에이전트 + 교차 승인  (1~2주)
Phase 3: SLEEP/AWAKE 모드 운영     (1주)
Phase 4: 반복 태스크 자동화         (1~2주)
Phase 5: 안정화 + 모니터링 고도화   (지속)
```

---

## Phase 0: 인프라 기반 세팅

### 0-1. Mac Studio 네트워크 세팅
- [ ] Mac Studio #1, #2에 Tailscale 설치 및 연결
- [ ] SSH 키 교환 (MBP ↔ Studio #1 ↔ Studio #2)
- [ ] 고정 Tailscale IP 기록 및 alias 설정
- [ ] 방화벽 규칙: Tailscale 서브넷만 허용

### 0-2. tmux 환경 구성
- [ ] 양쪽 Mac Studio에 tmux 설치
- [ ] 자동 세션 복구 스크립트 (`tmux-resurrect` 또는 커스텀)
- [ ] 세션 네이밍 컨벤션: `fas-claude`, `fas-gemini`, `fas-n8n`, `fas-openclaw`

### 0-3. Telegram Bot 구축
- [ ] Bot 생성 (BotFather)
- [ ] Chat ID 확인
- [ ] 알림 전송 모듈 작성 (TypeScript)
  - `send_notification(level: 'info' | 'approval' | 'critical', message: string)`
  - `wait_for_approval(timeout_minutes: number): Promise<boolean>`
- [ ] Galaxy Watch 텔레그램 알림 허용 설정

### 0-4. Docker 환경
- [ ] Mac Studio #2에 Docker Desktop 또는 Colima 설치
- [ ] n8n Docker Compose 파일 작성
- [ ] 볼륨 매핑: `~/.n8n` → 외장하드 백업 경로

### 0-5. AI CLI 설치 & 인증
- [ ] Claude Code: 이미 설치됨 → Max 플랜 확인
- [ ] Gemini CLI: 2개 계정 인증 설정 (프로필 분리)
- [ ] OpenClaw: Mac Studio #1 격리 계정에 ChatGPT Pro 연동
- [ ] Codex CLI: ChatGPT Pro 계정으로 설치 및 인증

---

## Phase 1: 단일 에이전트 자동화

### 1-1. Claude Code 상시 실행 체계
- [ ] tmux 세션 자동 시작 스크립트 (launchd)
- [ ] Claude Code 출력 감시 → Telegram 전송 스크립트
  - 승인 요청 패턴 감지: `[APPROVAL_NEEDED]`, `[BLOCKED]`
  - 마일스톤 완료 패턴: `[MILESTONE]`, `[DONE]`
- [ ] 자동 재시작 (크래시 복구): `while true; do claude; sleep 5; done` 래퍼
- [ ] CLAUDE.md에 자율 실행 범위 명시

### 1-2. Gemini CLI 상시 실행 체계
- [ ] 계정 A: 리서치 전용 세션
- [ ] 계정 B: 교차 검증 전용 세션
- [ ] 출력 로깅 + Telegram 연동 (Claude와 동일 구조)

### 1-3. OpenClaw 안정화
- [ ] ChatGPT Pro 연동 완료
- [ ] 개인정보 유출 방지 설정 확인
- [ ] 기본 태스크 실행 테스트

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
  created_at: 2026-03-17
  deadline: null
  depends_on: []
  ```
- [ ] 에이전트별 태스크 폴링 스크립트

---

## Phase 2: 멀티 에이전트 + 교차 승인

### 2-1. 교차 승인 프로토콜 구현
- [ ] 승인 요청 표준 포맷 정의:
  ```json
  {
    "request_id": "apr_001",
    "requester": "claude",
    "action": "git push origin main",
    "risk_level": "high",
    "context": "PLAN.md 업데이트 커밋",
    "evidence": ["diff 내용", "테스트 결과"],
    "created_at": "2026-03-17T14:00:00Z"
  }
  ```
- [ ] 승인 게이트웨이 서비스 (TypeScript)
  - `LOW` → 즉시 실행, 로그만 기록
  - `MID` → 다른 AI에게 검증 요청 → 승인/거부
  - `HIGH` → Telegram으로 인간에게 전송 → 응답 대기
- [ ] 교차 검증 로직:
  - Claude 작업물 → Gemini가 리뷰 (또는 그 반대)
  - 불일치 시 → 제3 AI(Codex)에게 판정 요청
  - 3자 불일치 시 → 무조건 인간 승인

### 2-2. n8n 워크플로우 설계
- [ ] 마스터 오케스트레이션 워크플로우:
  - 시간대 확인 → SLEEP/AWAKE 모드 결정
  - 태스크 큐에서 적절한 태스크 배정
  - 에이전트 상태 모니터링
- [ ] 에이전트 헬스체크 워크플로우:
  - 5분마다 각 tmux 세션 alive 확인
  - 죽은 세션 자동 재시작
  - 30분 이상 무응답 시 Telegram 알림

### 2-3. 할루시네이션 방지 파이프라인
- [ ] NotebookLM 연동:
  - 에이전트가 생성한 문서/리서치 결과를 NotebookLM에 업로드
  - 논리적 모순, 출처 불명 주장, 불완전한 정보 감지
  - 검증 실패 시 → 해당 태스크를 `blocked` 상태로 전환 + 사유 기록
- [ ] Cross-AI 팩트체크:
  - AI-A가 생성한 정보를 AI-B가 독립적으로 검증
  - 일치율 80% 미만 → 인간 리뷰 플래그
- [ ] Deep Research 활용:
  - 새로운 도메인 진입 시 초기 자료 수집
  - 결과를 `research/` 디렉토리에 구조화 저장
  - 이후 에이전트들이 참조 소스로 활용

---

## Phase 3: SLEEP/AWAKE 모드 운영

### 3-1. SLEEP 모드 (23:00~07:30)
자동 실행 태스크만 수행, 인간 승인 불필요한 작업 위주.

**허용 활동:**
- 웹 크롤링 / 정보 수집
- Deep Research 실행
- 트렌드 분석 리포트 생성
- 코드 리뷰 (기존 PR)
- 테스트 실행 및 결과 기록
- NotebookLM 검증 실행
- 내일 AWAKE 모드 태스크 준비

**금지 활동:**
- git push / 배포
- 외부 서비스 API 호출 (결제 관련)
- 새 PR 생성
- 인간 승인 필요 태스크

**SLEEP 모드 산출물:**
- `reports/daily/{date}_overnight_report.md`
  - 수집한 정보 요약
  - 발견한 트렌드
  - 내일 처리 필요 사항
  - 승인 대기 목록

### 3-2. AWAKE 모드 (07:30~23:00)
인간 응답 가능 시간. 승인 필요 태스크 집중 처리.

**활동:**
- 개발 작업 (코드 작성, 리팩토링)
- SLEEP 모드 산출물 기반 승인 요청 일괄 전송 (07:30)
- 인간 피드백 반영
- git push, PR 생성, 배포 (승인 후)

**07:30 모닝 브리핑:**
- Telegram으로 밤새 작업 요약 전송
- 승인 대기 목록 + 예상 소요시간
- 오늘의 추천 태스크 우선순위

### 3-3. 모드 전환 자동화
- [ ] n8n 크론 트리거: 23:00 → SLEEP, 07:30 → AWAKE
- [ ] 모드 전환 시 현재 작업 저장 + 컨텍스트 핸드오프
- [ ] `state/current_mode.json`:
  ```json
  {
    "mode": "sleep",
    "switched_at": "2026-03-17T23:00:00+09:00",
    "active_agents": ["gemini_a", "gemini_b"],
    "paused_tasks": ["task_012"],
    "next_switch": "2026-03-18T07:30:00+09:00"
  }
  ```

---

## Phase 4: 반복 태스크 자동화

### 4-1. 창업지원사업 정보 수집 (SLEEP 모드)
- [ ] 크롤링 대상 사이트 목록 정의
  - K-Startup (k-startup.go.kr)
  - 창업진흥원
  - 중소벤처기업부
  - 서울산업진흥원 (SBA)
- [ ] 일일 크롤링 → 신규 공고 감지
- [ ] 마감일 D-7, D-3, D-1 알림
- [ ] 지원 자격 자동 매칭 (주인님 프로필 기반)

### 4-2. 로또 청약 정보 수집 (SLEEP 모드)
- [ ] 청약홈 (applyhome.co.kr) 모니터링
- [ ] 신규 공고 → 분석 보고서 자동 생성
  - 위치, 가격, 경쟁률 예상, 자격 충족 여부
- [ ] 보고서 → Telegram 전송 → 인간 승인 → 청약 실행

### 4-3. 블라인드 네이버 인기글 모니터링 (RECURRING)
- [ ] 블라인드 네이버 채널 모니터링
- [ ] 인기글 감지 기준 정의 (좋아요/댓글 수 임계값)
- [ ] 감지 시 → 요약 + 원문 링크 → 단톡방 공유

### 4-4. AI 트렌드 리서치 (SLEEP 모드)
- [ ] 소스: Hacker News, Reddit (r/MachineLearning, r/LocalLLaMA), arxiv, Twitter/X
- [ ] 일일 트렌드 리포트 생성
- [ ] 주인님 관심 키워드 필터: 에듀테크, NVC, 1인창업, 자동화, 로컬LLM

### 4-5. SEO/성능 측정 (RECURRING, 추후)
- [ ] Lighthouse CI 주기적 실행
- [ ] 성능 저하 감지 시 알림

---

## Phase 5: 안정화 + 모니터링 고도화

### 5-1. 로깅 & 감사
- [ ] 모든 에이전트 활동 로그: `logs/{agent}/{date}.log`
- [ ] 승인 이력: `logs/approvals/{date}.json`
- [ ] 비용 추적: API 호출 횟수 + 예상 비용 일일 리포트

### 5-2. 장애 대응
- [ ] 에이전트 크래시 → 자동 재시작 (3회까지)
- [ ] 3회 실패 → 인간 알림 + 해당 에이전트 격리
- [ ] 네트워크 단절 → 로컬 큐에 쌓아두고 복구 후 재개

### 5-3. 보안
- [ ] API 키 관리: macOS Keychain 또는 1Password CLI
- [ ] 에이전트 격리: 각 에이전트별 별도 macOS 사용자 (선택)
- [ ] 민감 정보 접근 로그 기록
- [ ] 외부 API 호출 화이트리스트

### 5-4. 비용 최적화
- [ ] 모델별 토큰 사용량 모니터링
- [ ] 단순 작업은 저비용 모델로 라우팅 (Haiku 등)
- [ ] 월간 비용 리포트 → Telegram

---

## 의존성 그래프

```
Phase 0 ─┬→ Phase 1 ─→ Phase 2 ─→ Phase 3
          │                          ↓
          └→ Phase 4 (일부 Phase 1 이후 병렬 가능)
                                     ↓
                               Phase 5 (지속)
```

## 리스크 & 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| API 요금 폭발 | 재정 | 일일 비용 상한 설정 + 알림 |
| 할루시네이션 기반 잘못된 행동 | 신뢰 | NotebookLM + 교차검증 2중 체크 |
| Mac Studio 하드웨어 장애 | 가용성 | 핵심 워크플로우는 양쪽에 이중화 |
| Telegram Bot 응답 누락 | 운영 | 타임아웃 → 자동 안전모드 (읽기전용) |
| OpenClaw 개인정보 유출 | 보안 | 격리 계정 + 민감정보 접근 차단 |
| AI 서비스 장애 (Claude/Gemini 다운) | 가용성 | 다른 AI로 자동 폴백 |
