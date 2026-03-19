# scripts/setup/

FAS 캡틴(Mac Studio #2) 초기 설정 및 자동 기동을 위한 스크립트와 LaunchAgent plist 모음.

## LaunchAgent Plist 파일

| 파일 | Label | 용도 |
|------|-------|------|
| `com.fas.start-all.plist` | `com.fas.start-all` | 로그인 시 `start_all.sh` 실행하여 모든 FAS 서비스 기동 |
| `com.fas.captain.plist` | `com.fas.captain` | 캡틴 tmux 세션 자동 시작 |
| `com.fas.gateway.plist` | `com.fas.gateway` | Gateway 서비스 자동 시작 |
| `com.fas.hunter.plist` | `com.fas.hunter` | 헌터 관련 서비스 자동 시작 |
| `com.fas.gemini-a.plist` | `com.fas.gemini-a` | Gemini CLI 서비스 자동 시작 |
| `com.fas.awake.plist` | `com.fas.awake` | 시스템 깨우기 관련 |
| `com.fas.sleep.plist` | `com.fas.sleep` | 시스템 슬립 관련 |

### 설치 방법

```bash
# plist를 LaunchAgents에 복사
cp scripts/setup/<plist-file> ~/Library/LaunchAgents/

# 로드 (즉시 활성화)
launchctl load ~/Library/LaunchAgents/<plist-file>
```

### 제거 방법

```bash
# 언로드
launchctl unload ~/Library/LaunchAgents/<plist-file>

# 삭제
rm ~/Library/LaunchAgents/<plist-file>
```

## 셋업 스크립트

| 파일 | 용도 |
|------|------|
| `setup_ai_cli.sh` | AI CLI 도구 설치 |
| `setup_colima.sh` | Colima (Docker 런타임) 설치 |
| `setup_gemini_cli.sh` | Gemini CLI 설치 |
| `setup_hunter.sh` | 헌터 머신 초기 설정 |
| `setup_tmux.sh` | tmux 환경 설정 |
