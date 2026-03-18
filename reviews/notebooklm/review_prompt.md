# FAS (Fully Automation System) 통합 교차 검증 프롬프트

## 시스템 요약

FAS는 2대의 Mac Studio + 다종 AI 모델을 조합한 24시간 무중단 멀티 에이전트 자동화 시스템입니다.
두 계층으로 분리되어 있습니다:

- **Doctrine** (iCloud claude-config): 클러스터의 정신, 원칙, 정체성, 보안 설계. Source of Truth.
- **Operations** (FAS-operations 레포): Doctrine을 코드로 실현하는 계층. Gateway, 알림, 헌터 클라이언트, 감시 데몬 등.

세 에이전트:
- Captain (뇌): Mac Studio #2, 판단/전략/오케스트레이션, 개인정보 보유
- Hunter (눈): Mac Studio #1, 정보 탐색/크롤링/리서치, 개인정보 완전 차단
- Shadow (손): MacBook Pro, 주인님이 직접 사용, 자율 실행 없음

업로드한 소스 파일:
- 01_doctrine.md — Doctrine 전체 (memory, settings, CLAUDE.md, zone 구조)
- 02_docs_and_config.md — Operations 문서 & 설정
- 03_source_code.md — Operations 소스 코드 (테스트 제외)
- 04_tests_and_scripts.md — Operations 테스트 & 스크립트

---

## 검증 요청

아래 각 항목에 대해 **[안전/주의/위험]** 등급을 매기고, 근거를 구체적으로 제시해주세요.

### 1. Doctrine-Operations 일치 검증 (핵심)

- Doctrine(feedback_tone.md)에 정의된 에이전트 정체성(뇌/눈/손, 이모지, 톤)이 Operations의 CLAUDE.md, agents-charter.md, agents.yml과 일치하는가?
- Doctrine의 보안 정책(feedback_hunter_isolation.md, project_fas_operation_protocol.md)이 Operations 코드(sanitizer.ts, server.ts)에 올바르게 구현되어 있는가?
- Doctrine의 FAS 계층 구분(project_fas_naming.md)이 Operations 문서에 정확히 반영되어 있는가?
- Doctrine memory에 정의된 자율 실행 범위가 Operations CLAUDE.md의 범위와 일치하는가?

### 2. 보안

- 헌터 격리: Task API를 통해서만 통신하는가? PII가 헌터로 전달될 가능성이 있는가?
- PII 산이타이저: 10개 패턴이 충분한가? 우회 가능한 사각지대가 있는가?
- API Key 인증: Hunter API 인증이 올바르게 구현되어 있는가?
- Rate Limiting: 슬라이딩 윈도우 구현이 올바른가?
- Schema Validation: 경로 traversal, 확장자 검증이 완전한가?
- PII Quarantine 전략: 격리 로직에 허점이 있는가?

### 3. 코드 품질

- TypeScript 모범 사례를 따르고 있는가? (ESM, type import, 에러 핸들링)
- FASError 커스텀 에러 타입이 일관되게 사용되고 있는가?
- 알림 모듈의 retry + fallback 로직이 올바른가? 무한 루프나 리소스 누수 가능성은?
- 함수가 단일 책임 원칙을 따르는가?
- 테스트 커버리지가 충분한가? 엣지 케이스가 빠져있는가?

### 4. 아키텍처 일관성

- 문서(architecture.md, devspec.md)와 실제 코드 구조가 일치하는가?
- agents-charter.md에 정의된 통신 구조가 실제 코드에 반영되어 있는가?
- Task API 엔드포인트 목록이 문서와 코드에서 일치하는가?
- PLAN.md의 Phase 0/1 완료 체크리스트가 실제 구현 상태와 맞는가?

### 5. 운영 안정성

- 에이전트 크래시 시 자동 재시작 로직이 올바른가?
- Watchdog의 출력 감시 로직에 누락되는 패턴이 있는가?
- 헌터 폴링 루프의 지수 백오프가 올바르게 구현되어 있는가?
- 알림 실패 시 fallback이 정상 동작하는가?

### 6. 문서 품질

- 문서 간 상호 참조가 올바른가? (깨진 링크 없는가?)
- 문서와 코드 사이에 용어 불일치가 있는가?
- README들이 각 폴더의 목적을 명확히 설명하는가?

---

## 종합 평가

위 6개 영역을 종합하여:
1. 현재 시스템의 전체적인 성숙도를 평가해주세요.
2. **즉시 수정이 필요한 이슈** (위험 등급)를 우선순위로 나열해주세요.
3. **개선하면 좋을 이슈** (주의 등급)를 나열해주세요.
4. 다음 개발 단계(Phase 2: 멀티 에이전트 + 교차 승인)로 넘어가기 전에 반드시 해결할 사항이 있는지 제시해주세요.
