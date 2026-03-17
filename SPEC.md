# SPEC.md — 기술 명세 인덱스

> 상세 기술 명세는 `docs/` 디렉토리에 분리되어 있습니다.

## 문서 목록

| 문서                                               | 내용                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)       | 전체 아키텍처, 하드웨어 배치, 디렉토리 구조, 프로세스 시작 순서               |
| [docs/agent-control.md](docs/agent-control.md)     | **핵심** — 에이전트 제어 프로토콜 (Agent Wrapper, tmux, one-shot/interactive) |
| [docs/task-system.md](docs/task-system.md)         | 태스크 큐, 파일 포맷, 배정 알고리즘, 동시성 제어, 스케줄링                    |
| [docs/gateway.md](docs/gateway.md)                 | 승인 게이트웨이, Task API, 위험도 분류, 산이타이징                            |
| [docs/hunter-protocol.md](docs/hunter-protocol.md) | 헌터 격리, 통신 프로토콜, Tailscale ACL                                       |
| [docs/notification.md](docs/notification.md)       | Telegram + Slack + Notion 채널 명세, 라우팅 매트릭스                          |
| [docs/n8n-workflows.md](docs/n8n-workflows.md)     | n8n 워크플로우 상세, docker-compose, schedules.yml                            |
| [docs/crawlers.md](docs/crawlers.md)               | 크롤러별 상세 (창업, 청약, 블라인드, 채용, 대학원, AI 트렌드)                 |
| [docs/academy.md](docs/academy.md)                 | 학원 자동화 (학생 데이터, 학부모 문자, 시험 생성, 교재 제작)                  |
| [docs/pipeline.md](docs/pipeline.md)               | 캐시플로우 발굴, 아이디어→사업화, 무중단 구현 프로세스                        |
| [docs/monitoring.md](docs/monitoring.md)           | Watchdog, 리소스 모니터링, AI 토큰 추적, 로그 관리                            |
| [docs/security.md](docs/security.md)               | 시크릿 관리, 격리, ACL, API 화이트리스트                                      |
| [docs/cost.md](docs/cost.md)                       | 비용 관리, 최적화 전략                                                        |

## 설정 파일

| 파일                                                     | 내용                                    |
| -------------------------------------------------------- | --------------------------------------- |
| [config/agents.yml](config/agents.yml)                   | 에이전트 설정 (역할, 권한, 재시작 정책) |
| [config/schedules.yml](config/schedules.yml)             | 반복 태스크 스케줄                      |
| [config/risk_rules.yml](config/risk_rules.yml)           | 위험도 분류 규칙                        |
| [config/personal_filter.yml](config/personal_filter.yml) | 개인정보 필터링 패턴 (gateway.md 참조)  |
