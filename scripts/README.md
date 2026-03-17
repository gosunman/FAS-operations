# scripts/ — FAS 스크립트

## 스크립트 목록

| 스크립트 | 목적 |
|---------|------|
| `start_captain_sessions.sh` | 캡틴의 모든 tmux 세션 시작 |
| `stop_all.sh` | 모든 FAS 세션 종료 |
| `status.sh` | 시스템 상태 확인 (세션, Gateway, Docker, 리소스) |
| `agent_wrapper.sh` | 에이전트 자동 재시작 래퍼 (지수 백오프) |

## setup/ 디렉토리

| 스크립트 | 목적 |
|---------|------|
| `setup_tmux.sh` | tmux-resurrect 설치, tmux.conf 설정 |
| `setup_colima.sh` | Colima + Docker 설치 (brew) |
| `setup_ai_cli.sh` | AI CLI 인증 상태 확인 가이드 |
| `com.fas.captain.plist` | launchd 자동 시작 설정 |
