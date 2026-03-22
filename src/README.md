# src/ — FAS 소스 코드

## 모듈 구조

| 디렉토리 | 목적 | 상태 |
|---------|------|------|
| [gateway/](gateway/) | Task API 서버 (Express + SQLite) | ✅ 구현 완료 |
| [notification/](notification/) | Telegram + Slack 알림 | ✅ 구현 완료 |
| [watchdog/](watchdog/) | 출력 감시 + 리소스 모니터 + 기기 상태 분류 + 일일 인프라 리포트 | ✅ 구현 완료 |
| [shared/](shared/) | 공유 타입 정의 | ✅ 구현 완료 |
| agents/ | 에이전트 래퍼 | 🔜 Phase 1-2~ |
| orchestrator/ | n8n 커스텀 노드 | 🔜 Phase 2 |
| crawlers/ | 크롤러 | 🔜 Phase 4 |
| academy/ | 학원 자동화 | 🔜 Phase 5 |
| pipeline/ | 사업화 파이프라인 | 🔜 Phase 6 |
| validation/ | 할루시네이션 방지 | 🔜 Phase 2-3 |
