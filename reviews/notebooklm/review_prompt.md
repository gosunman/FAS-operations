# FAS 교차 검증 프롬프트 — NotebookLM용

> 생성일: 2026-03-18
> 대상: FAS (Fully Automation System) 전체 — Doctrine + Operations

---

## 시스템 개요

FAS는 2대의 Mac Studio와 1대의 MacBook Pro로 구성된 24/7 멀티 에이전트 자동화 시스템입니다.

- **Doctrine** (01_doctrine.md): 클러스터의 정신, 원칙, 정체성, 보안 설계. Source of Truth.
- **Operations** (02~04 파일): Doctrine을 코드로 실현하는 계층. Gateway, Hunter, Captain, Notification, Watchdog, Gemini 모듈로 구성.

### 에이전트 구조

| 에이전트 | 기기 | 역할 |
|---------|------|------|
| **캡틴 (Captain)** | Mac Studio #2 (M4 Ultra) | 뇌 — 판단, 전략, 오케스트레이션, 메인 워커 |
| **헌터 (Hunter)** | Mac Studio #1 (M1 Ultra) | 눈 — 브라우저 자동화, 크롤링, 외부 정보 수집 |
| **그림자 (Shadow)** | MacBook Pro (M1 Pro) | 손 — 주인님 직접 사용, 감독 인터페이스 |

### 핵심 모듈

- **Gateway**: Express Task API 서버. 태스크 CRUD, 승인 프로토콜, PII 산이타이징
- **Hunter**: 폴링 기반 태스크 클라이언트. 격리된 환경에서 브라우저 작업 수행
- **Captain**: 자율 스케줄링(planning_loop), Gemini 교차 승인, 피드백 추출
- **Notification**: Telegram(긴급), Slack(일상), Notion(문서화) 통합 라우터
- **Watchdog**: tmux 출력 감시, 리소스 모니터링
- **Gemini**: Gemini CLI 래퍼. 리서치, 교차 검증, 팩트체킹

---

## 검증 요청 항목

아래 각 항목에 대해 **[안전] / [주의] / [위험]** 등급으로 평가하고, 구체적 근거를 제시해 주세요.

---

### 1. Doctrine-Operations 일치 검증 (최우선)

Doctrine(01_doctrine.md)에 선언된 원칙이 Operations 코드(02~04)에 실제로 구현되어 있는지 확인하세요.

- **에이전트 정체성**: 캡틴/헌터/그림자 각각의 역할이 Doctrine 정의와 코드 구현에서 일치하는가?
- **보안 정책 구현**: 다음이 코드에 반영되어 있는가?
  - 헌터 격리: 소스코드/아키텍처 문서가 헌터에 전달되지 않는가?
  - PII 산이타이징: 헌터로 보내는 태스크에서 개인정보가 제거되는가?
  - 승인 프로토콜: LOW/MID/HIGH/CRITICAL 4단계가 구현되어 있는가?
  - Gemini 교차 승인: MID 레벨 태스크에 대한 AI 교차 승인이 동작하는가?
- **톤/호칭 규칙**: Doctrine에 정의된 커뮤니케이션 규칙이 알림 메시지 등에 반영되어 있는가?
- **자율 실행 범위**: Doctrine에 정의된 LOW/MID/HIGH/CRITICAL 범위가 코드 권한과 일치하는가?

### 2. 보안 분석

- 시크릿/토큰 관리: 하드코딩된 시크릿이 없는가? .env 패턴이 올바르게 사용되는가?
- 네트워크 보안: Tailscale 기반 통신, 외부 노출 포인트 검토
- 헌터 격리 완전성: 헌터가 접근할 수 있는 정보의 범위가 Doctrine 정의와 일치하는가?
- 입력 검증: 외부 입력(API 요청, 헌터 응답)에 대한 검증이 충분한가?

### 3. 아키텍처 일관성

- 모듈 간 의존 관계가 명확하고 순환 의존이 없는가?
- 데이터 흐름이 문서(architecture.md)와 실제 코드에서 일치하는가?
- 에러 핸들링 전략이 일관적인가?
- SQLite WAL 모드 사용, 동시성 처리가 적절한가?

### 4. 코드 품질

- TypeScript 컨벤션 준수: ESM, type import, as const, 화살표 함수 등
- 테스트 커버리지: 핵심 모듈(gateway, hunter, notification)에 테스트가 있는가?
- 테스트 패턴: Given-When-Then 패턴이 준수되는가?
- DRY 원칙: 불필요한 중복 코드가 없는가?

### 5. 운영 안정성

- 24/7 무중단 운영에 필요한 요소가 갖춰져 있는가?
  - 프로세스 재시작 (launchd/tmux)
  - 리소스 모니터링 (watchdog)
  - 에러 알림 경로
- 운영 모드(AWAKE/SLEEP) 전환 로직이 구현되어 있는가?

### 6. 구축 계획 대비 진행 상태

- PLAN.md의 Phase 0~7 중 현재 어디까지 완료되었는가?
- 미완료 항목 중 블로커(차단 요소)가 있는가?
- 의존성 그래프에 맞는 순서로 구현이 진행되고 있는가?

---

## 종합 평가 요청

위 6개 항목을 종합하여 다음을 제시해 주세요:

1. **전체 등급**: [안전] / [주의] / [위험]
2. **가장 시급한 개선 사항** 3가지 (우선순위 순)
3. **Doctrine-Operations 간 불일치** 목록 (있다면)
4. **보안 취약점** 목록 (있다면)
5. **다음 단계 권장사항**: 현재 진행 상태를 고려한 구체적 다음 작업 제안
