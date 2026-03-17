# OpenClaw Configuration

헌터의 메인 브라우저 엔진(ChatGPT Pro OAuth) 설정 파일.

## 파일

| 파일 | 용도 |
|------|------|
| `system_prompt.md` | OpenClaw 초기 지시문 — 헌터의 정체성, 원칙, 임무, 보안 규칙 |
| `browsing_rules.md` | 브라우징 규칙 — 봇탐지 우회, 사이트 허용/금지, 데이터 수집 규칙 |

## 사용법

이 파일들은 헌터 배포 시 OpenClaw의 시스템 프롬프트와 설정으로 주입된다.
헌터 초기화 후 재배포 시에도 함께 전달된다.
