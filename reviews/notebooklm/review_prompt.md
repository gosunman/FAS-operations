# FAS 교차 검증 프롬프트 — NotebookLM용 (2차, 보안 조치 후)

> 이 문서를 NotebookLM에 업로드한 뒤, 아래 질문들을 순서대로 던져주세요.
> 생성일: 2026-03-18 (2차 — 1차 리뷰 피드백 반영 후)

---

## 시스템 개요

**FAS (Fully Automation System)** 는 두 계층으로 구성된 개인 자동화 시스템입니다:

- **Doctrine** (`01_doctrine.md`): 원칙, 정체성, 보안 정책, 에이전트 성격을 정의하는 Source of Truth
- **Operations** (`02~04_*.md`): Doctrine을 코드로 구현하는 계층 (Gateway, Task System, Hunter 통신 등)

**에이전트 구조:**
- **캡틴(Captain)**: Mac Studio에서 24/7 가동. 판단·전략·오케스트레이션 담당. Claude Code 기반.
- **헌터(Hunter)**: 외부 머신. 브라우저 자동화(Playwright) 전용. 캡틴이 Task API로 위임.
- **그림자(Shadow)**: 주인님의 MacBook Pro. 감독·수동 개입용.

---

## 1차 리뷰 이후 변경 사항

### 1차에서 지적된 3가지 개선 필요 항목 대응:

| 지적 | 조치 |
|------|------|
| 1순위: deep_research/notebooklm 스텁 | Playwright + 구글 프로필 기반으로 4개 핸들러 모두 구현 완료 |
| 2순위: 역방향 PII Quarantine | 1차 리뷰 시점에 이미 구현 완료 확인 (server.ts:329-353) |
| 3순위: dev_mode 인증 우회 | NODE_ENV=production 시 dev_mode 강제 차단 가드 추가 |

### 보안 감사 SA-001 발견 및 조치

헌터 머신의 Claude Code가 주인님 개인 계정(계정 A)으로 OAuth 인증됨 → Doctrine의 계정 B(별도 격리 계정) 원칙 위반.

**조치 완료:**
- 헌터에서 `claude logout` 실행, 인증 토큰 제거
- 헌터 전체 PII 스캔 실행 (`scripts/security/scan_hunter_pii.sh`)
- 발견된 잔존 개인정보 삭제: Claude 백업, Gemini 채팅 캐시, Notion 앱 데이터
- 재스캔으로 클린 상태 확인 완료
- `docs/security.md`에 SA-001 감사 기록 + 조치 절차 문서화
- `scripts/setup/setup_hunter.sh`에 계정 격리 검증 가드 (Step 0 + Step 8)
- `PLAN.md`에 SA-001 조치를 CRITICAL 항목으로 추가
- iCloud는 별도 계정(hunteruser6239@gmail.com)으로 확인 — 정상

### AI 플랜 확장 로드맵 추가

비용을 단계적으로 확인하며 증가시키는 3단계 플랜:
- **Stage 1** (현재): 기존 Google B ~$20 플랜 활용, Claude/ChatGPT 미결제 (~$120/월)
- **Stage 2** (운영): Claude Pro + ChatGPT Plus 각 ~$20 추가 (~$160/월)
- **Stage 3** (풀 스케일): Max x20 + ChatGPT Pro 각 $200 (~$520/월)

### 기타 추가 구현:
- Gemini CLI 상시 실행 체계 (launchd plist, gemini_wrapper.sh)
- Watchdog에 `[LOGIN_REQUIRED]`, `[GEMINI_BLOCKED]` 패턴 추가
- 헌터 PII 스캔 스크립트 (`scripts/security/scan_hunter_pii.sh`) — 7단계 검사

---

## 검증 질문

### 1. SA-001 보안 조치 검증 (최우선)

1. **계정 격리 위반의 심각성 평가**: Doctrine에서 규정한 계정 A/B 분리가 코드·문서에 어떻게 명시되어 있는가? 위반 시 실제 위험 시나리오를 구체적으로 설명해주세요.
2. **조치의 충분성**: 실행한 조치(logout, PII 스캔, 잔존물 삭제, 재스캔)가 완전한가? 누락된 단계가 있는가?
3. **셋업 스크립트 가드**: `setup_hunter.sh`의 Step 0 계정 검증이 적절한가? 개선점이 있는가?
4. **PII 스캔 스크립트**: `scan_hunter_pii.sh`의 7단계 검사가 충분한가? 추가해야 할 검사 항목이 있는가?
5. **추가 필요 조치**: 계정 격리 외에 헌터 머신에서 추가로 확인·조치해야 할 보안 사항이 있는가?

### 2. 1차 지적사항 해소 확인

1. `handle_deep_research`와 `handle_notebooklm_verify`의 구현이 적절한가? 로그인 벽 감지가 충분한가?
2. `dev_mode` 강화: `NODE_ENV=production`일 때 `FAS_DEV_MODE=true`가 확실히 차단되는가?
3. PII Quarantine 로직이 실제로 server.ts에 완전하게 연결되어 있는가?

### 3. AI 플랜 확장 로드맵 검증

1. Stage 1 → 2 → 3 단계별 확장 계획이 합리적인가?
2. Stage 1에서 Google B 계정의 기존 ~$20 플랜만으로 검증에 충분한가?
3. 각 Stage의 승격 조건이 명확하고 측정 가능한가?
4. 비용 대비 효용 관점에서 개선할 점이 있는가?

### 4. Doctrine-Operations 일치 재검증

1차에서 [부분일치]였던 **보안 정책** 항목이 개선되었는가? SA-001 조치와 코드 변경을 근거로 재평가해주세요.

### 5. 헌터 구현 상태의 정확성

`docs/hunter-protocol.md`에 새로 추가된 "헌터 현재 구현 상태" 섹션이 실제 코드와 정확히 일치하는가? 코드 구현 완료 vs 헌터 머신 실제 상태의 구분이 명확한가?

### 6. 전체 보안 태세 재평가

1차 리뷰의 보안 점검 + SA-001 조치를 종합하여:

1. **현재 보안 등급**: [안전/주의/위험] 중 하나와 근거
2. **남은 보안 리스크** 우선순위 목록
3. **계정 격리 완료 후** 보안 태세가 어떻게 변하는지 예측

### 7. 종합 재평가

1차 리뷰에서 **[성장]** 단계로 평가했습니다. 이번 변경사항을 반영하여:

1. **개선된 점** 3가지
2. **여전히 남은 개선 필요** 3가지
3. 전체 성숙도 등급 재평가: **[초기/성장/안정/성숙]** 중 하나와 근거

---

## 참고사항

- 이 파일들은 민감정보가 마스킹되어 있습니다 (`[MASKED_*]` 형태)
- 코드 펜스는 NotebookLM 호환을 위해 제거되었습니다
- 1차 리뷰 → 보안 조치(SA-001 해소, PII 정리) → 2차 리뷰 순서입니다
