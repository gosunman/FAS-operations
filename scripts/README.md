# scripts/ — FAS 스크립트

## 핵심 스크립트 (루트)

### 시스템 기동/중지

| 스크립트 | 목적 | 실행 |
|---------|------|------|
| `start_all.sh` | 전체 서비스 5단계 부팅 (Colima → n8n → fas-captain → CC sessions → post-boot 모드전환+알림) | `bash scripts/start_all.sh` |
| `stop_all.sh` | 모든 서비스 안전 중지 | `bash scripts/stop_all.sh` |
| `status.sh` | 전체 시스템 상태 조회 (세션, Gateway, Docker, 리소스) | `bash scripts/status.sh` |
| `mode_switch.sh` | awake/sleep 모드 전환 | `bash scripts/mode_switch.sh awake` or `sleep` |
| `start_captain_sessions.sh` | ~~캡틴 tmux 세션 시작~~ **DEPRECATED** — `start_all.sh`로 대체 | — |

### 에이전트 & 래퍼

| 스크립트 | 목적 | 실행 |
|---------|------|------|
| `agent_wrapper.sh` | 에이전트 자동 재시작 래퍼 (지수 백오프) | `start_all.sh`에서 호출 |
| `gateway_wrapper.sh` | 게이트웨이 래퍼 | `start_all.sh`에서 호출 |
| `gemini_wrapper.sh` | Gemini CLI 래퍼 | `start_all.sh`에서 호출 |
| `env_loader.sh` | 환경변수 로더 (`.env` 파싱, 각 래퍼에서 source) | 다른 스크립트에서 `source` |

### 헌터 관련

| 스크립트 | 목적 | 실행 |
|---------|------|------|
| `hunter_watchdog.sh` | 헌터 자동 재시작 (nvm 로드, OpenClaw health check, 지수 백오프) | 헌터 머신에서 launchd로 실행 |
| `resolve_hunter_login.sh` | 헌터 로그인 감지 해결 | `bash scripts/resolve_hunter_login.sh` |

### 정기 점검

| 스크립트 | 목적 | 실행 |
|---------|------|------|
| `check_macos_update.sh` | macOS 업데이트 감시 (캡틴+헌터, 매일 09:00 launchd) | `bash scripts/check_macos_update.sh` |
| `check_dependencies.sh` | 의존성 점검 (매월 1일 10:00 launchd) | `bash scripts/check_dependencies.sh` |

### 검증 & 리뷰

| 스크립트 | 목적 | 실행 |
|---------|------|------|
| `generate_review_files.ts` | NotebookLM 교차 검증용 리뷰 파일 생성 | `npx tsx scripts/generate_review_files.ts` |
| `generate_notebooklm.sh` | NotebookLM 리뷰 파일 생성 (범용) | `bash scripts/generate_notebooklm.sh` |
| `generate_notebooklm_fas.sh` | NotebookLM 리뷰 파일 생성 (FAS 전용) | `bash scripts/generate_notebooklm_fas.sh` |

### 유틸리티

| 스크립트 | 목적 | 실행 |
|---------|------|------|
| `test_notifications.ts` | 알림 시스템 테스트 | `npx tsx scripts/test_notifications.ts` |
| `send_results_now.ts` | 태스크 결과 즉시 전송 | `npx tsx scripts/send_results_now.ts` |
| `send_task_result.ts` | 개별 태스크 결과 전송 | `npx tsx scripts/send_task_result.ts` |

---

## setup/ — 초기 설정 & LaunchAgent

| 파일 | 목적 |
|------|------|
| `setup_hunter.sh` | 헌터 머신 초기 설정 자동화 |
| `setup_tmux.sh` | tmux-resurrect 설치, tmux.conf 설정 |
| `setup_colima.sh` | Colima + Docker 설치 (brew) |
| `setup_ai_cli.sh` | AI CLI 인증 상태 확인 가이드 |
| `setup_gemini_cli.sh` | Gemini CLI 설정 |

### LaunchAgent plist

| plist | 목적 | 스케줄 |
|-------|------|--------|
| `com.fas.start-all.plist` | 캡틴 자동 기동 (부팅 시 `start_all.sh` 실행) | 부팅/로그인 시 |
| `com.fas.hunter.plist` | 헌터 자동 기동 (부팅 시 watchdog 실행). PATH에 nvm 경로 포함 | 부팅/로그인 시 |
| `com.fas.update-check.plist` | macOS 업데이트 감시 | 매일 09:00 |
| `com.fas.dep-check.plist` | 의존성 점검 | 매월 1일 10:00 |
| `com.fas.captain.plist` | 캡틴 LaunchAgent (레거시) | — |
| `com.fas.gateway.plist` | 게이트웨이 LaunchAgent | — |
| `com.fas.gemini-a.plist` | Gemini CLI LaunchAgent | — |
| `com.fas.awake.plist` | Awake 모드 LaunchAgent | — |
| `com.fas.sleep.plist` | Sleep 모드 LaunchAgent | — |

---

## deploy/ — 헌터 배포

| 스크립트 | 목적 | 실행 |
|---------|------|------|
| `deploy_hunter.sh` | 헌터에 최소 파일만 배포 (git clone 금지) | `bash scripts/deploy/deploy_hunter.sh` |
| `verify_hunter.sh` | 헌터 배포 검증 (API 연결, heartbeat, PII 스캔 등) | `bash scripts/deploy/verify_hunter.sh [captain-api-url] [hunter-api-key]` |
