# CLAUDE.md — Claude Code 자율 실행 규칙

## 프로젝트

Fully Automation System (FAS) — 24시간 무중단 AI 워커 시스템

## 기술 스택

- 언어 우선순위: **TypeScript (최우선)** > Python (필요 시) > Bash (최소한)
- 런타임: Node.js 20+ / Python 3.11+
- 패키지 매니저: pnpm (TS) / uv (Python)
- 코딩 스타일: snake_case, 함수형 프로그래밍, 가독성 최우선
- 주석: 많이 달 것
- 테스트: vitest, TDD 방향
- 프레임워크: Express (Gateway), n8n (오케스트레이션)
- DB: 파일 기반 (JSON/YAML), 추후 필요 시 MongoDB
- 인프라: Docker/Colima, tmux, Tailscale

## 자율 실행 범위

### 자동 허용 (LOW)
- 파일 읽기, 코드 분석
- 웹 검색, 정보 수집
- 리포트 생성 (로컬 파일)
- 테스트 실행
- 로그 확인
- git status, git diff, git log

### AI 교차 승인 필요 (MID)
- 파일 쓰기 (프로젝트 내)
- git commit
- 코드 생성
- 설정 변경

### 인간 승인 필요 (HIGH)
- git push
- PR 생성
- 외부 API 호출
- Docker 컨테이너 조작
- 패키지 설치
- 시스템 설정 변경

### 절대 금지 (CRITICAL — 반드시 인간 승인)
- 프로덕션 배포
- 데이터 삭제
- 계정 관련 행동
- 시크릿/인증 정보 접근
- 결제/금전 관련

## 작업 규칙

1. 실행 전 반드시 계획을 세우고 승인을 받을 것
2. 코드 작성 시 테스트 먼저 작성 (TDD)
3. 한국어로 소통
4. 에러 발생 시 3회까지 자체 해결 시도 → 실패 시 `[BLOCKED]` 출력
5. 마일스톤 완료 시 `[MILESTONE]` 출력
6. 승인 필요 시 `[APPROVAL_NEEDED]` 출력
7. 작업 완료 시 `[DONE]` 출력

## 출력 패턴 (감시 스크립트가 감지)

```
[APPROVAL_NEEDED] {설명}    → Telegram 긴급 알림
[BLOCKED] {설명}             → Telegram 긴급 알림
[MILESTONE] {설명}           → Slack 알림
[DONE] {설명}                → Slack 알림
[ERROR] {설명}               → Slack 경고
```

## 참조 문서

- [docs/architecture.md](docs/architecture.md) — 시스템 아키텍처
- [docs/agent-control.md](docs/agent-control.md) — 에이전트 제어 프로토콜
- [docs/task-system.md](docs/task-system.md) — 태스크 시스템
- [PLAN.md](PLAN.md) — 구축 계획
