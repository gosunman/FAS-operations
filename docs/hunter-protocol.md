# 헌터 격리 & 통신 프로토콜

> 에이전트 정체성, 역할, 절대원칙, 관계 등의 원천 문서: [docs/agents-charter.md](agents-charter.md)

## 헌터의 정체성

헌터는 주인님의 **눈** 👁️. 정보 탐색, 크롤링, 리서치를 담당한다. 외부 세계로 나아가 주인님에게 도움될 것을 적극적으로 찾는 일꾼이다.
직접 지시보다 주인님의 의중을 스스로 파악하여 움직이며, 막연한 업무도 자율 해석하여 수행한다.

### 헌터의 자율 탐색 역할
- 최신 정보, 트렌드, 기회를 능동적으로 발굴
- 주인님이 구체화하지 못한 아이디어나 업무를 스스로 파악하여 실행
- 매 작업 후 자기 회고를 통해 성장, 운영 노하우는 캡틴에 보존

## 격리 원칙

헌터(Mac Studio #1)는 **완전 격리된 환경**이다. OpenClaw(ChatGPT Pro)와 Gemini CLI(계정 B, Claude Code 임시 대체)가 실행되며, 개인정보가 유입되면 유출 위험이 있다.

### 격리 항목

| 항목 | 캡틴 | 헌터 | 공유 여부 |
| --- | --- | --- | --- |
| macOS 계정 | user | user | 별도 (같은 이름, 다른 머신) |
| iCloud | 주인님 계정 | 별도 계정 | X |
| Google | 주인님 계정 | 별도 계정 | X |
| ChatGPT | — | 별도 계정 (Pro) | X |
| Claude Code | 주인님 OAuth (계정 A, Max) | ❌ 사용 불가 (전화번호 인증 요건 — 계정 B 미생성) | — |
| Gemini CLI | 계정 A | 계정 B (임시 코딩 대체) | X (별도 계정) |
| Tailscale | 같은 네트워크 | 같은 네트워크 | O (VPN만 공유) |
| 파일시스템 | 직접 접근 불가 | 직접 접근 불가 | X |
| 통신 | Task API 서버 | Task API 클라이언트 | API만 |

### 절대 금지

- 헌터에 주인님 이름, 연락처, 주소, 금융정보 전달
- 헌터에서 캡틴으로 SSH 접속
- 헌터가 캡틴의 파일시스템 마운트
- 캡틴의 .env, secrets를 헌터에 복사

## 통신 아키텍처

### 캡틴 ↔ 헌터 (Task API)

```text
┌─────────────────────┐          HTTP (Tailscale)         ┌──────────────────┐
│       캡틴          │  ────────────────────────────────→ │      헌터         │
│                     │                                    │                  │
│  Task API Server    │ ← POST /api/hunter/tasks/:id/result│  Agent Wrapper   │
│  :3100              │                                    │  (폴링 클라이언트)│
│                     │ ← POST /api/hunter/heartbeat       │                  │
│  산이타이징 레이어   │                                    │  OpenClaw        │
│  (개인정보 제거)     │                                    │  Claude Code x20 │
│                     │                                    │  (실행)          │
└─────────────────────┘                                    └──────────────────┘
```

### 주인님 ↔ 헌터 (직접 소통)

```text
주인님 (그림자/모바일)
  │
  ├── Telegram/Slack ──→ 헌터: 막연한 아이디어, 비구체적 탐색 업무
  │                             ("이런 거 좀 알아봐", "X 관련 최신 동향 찾아줘")
  │
  └── ← Telegram/Slack ── 헌터: 크리티컬 이슈 직접 보고
                                 (보안 위협, 시간 긴급 기회, 차단 에러)
```

주인님이 헌터에게 직접 업무를 지시할 수 있으며, 헌터도 크리티컬한 문제는 캡틴을 거치지 않고 주인님에게 직접 보고한다.

## 헌터 Agent Wrapper

```typescript
// 헌터에서 실행되는 Agent Wrapper
// 캡틴의 Task API를 폴링하여 태스크 수신 + 결과 반환

const CAPTAIN_API = `http://${CAPTAIN_TAILSCALE_IP}:3100`
const POLL_INTERVAL = 10_000  // 10초

async function hunter_wrapper_loop(): Promise<void> {
  console.log('[hunter] Wrapper 시작. 캡틴 API:', CAPTAIN_API)

  while (true) {
    try {
      // 1. heartbeat 전송
      await fetch(`${CAPTAIN_API}/api/hunter/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'openclaw', timestamp: new Date().toISOString() }),
      })

      // 2. pending 태스크 폴링
      const res = await fetch(`${CAPTAIN_API}/api/hunter/tasks/pending`)
      const { tasks } = await res.json()

      // 3. 태스크 실행
      for (const task of tasks) {
        console.log(`[hunter] 태스크 수신: ${task.task_id} - ${task.action}`)
        const result = await execute_hunter_task(task)

        // 4. 결과 반환
        await fetch(`${CAPTAIN_API}/api/hunter/tasks/${task.task_id}/result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(result),
        })
      }
    } catch (err) {
      console.error('[hunter] 에러:', err)
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL))
  }
}

async function execute_hunter_task(task: HunterTask): Promise<HunterResult> {
  switch (task.action) {
    case 'notebooklm_verify':
      return await run_notebooklm_verification(task)

    case 'deep_research':
      return await run_deep_research(task)

    case 'web_crawl':
      return await run_web_crawl_with_openclaw(task)

    case 'browser_task':
      return await run_openclaw_browser_task(task)

    default:
      return { status: 'failed', output: `Unknown action: ${task.action}` }
  }
}

// OpenClaw을 통한 NotebookLM 검증
async function run_notebooklm_verification(task: HunterTask): Promise<HunterResult> {
  // OpenClaw에게 명령:
  // 1. NotebookLM 웹사이트 열기
  // 2. 문서 업로드
  // 3. 검증 질문 실행
  // 4. 결과 수집
  const prompt = [
    'NotebookLM (notebooklm.google.com)에 접속하여:',
    `1. 새 노트북 생성`,
    `2. 다음 내용을 소스로 추가: ${task.payload.document}`,
    `3. 다음 검증 질문 실행:`,
    ...task.payload.verification_questions.map((q: string, i: number) => `   ${i+1}. ${q}`),
    `4. 각 질문에 대한 답변과 신뢰도를 정리하여 반환`,
  ].join('\n')

  const result = await execute_openclaw(prompt, task.timeout_minutes ?? 10)

  return {
    status: result.success ? 'success' : 'failed',
    output: result.output,
    completed_at: new Date().toISOString(),
  }
}

// OpenClaw을 통한 Deep Research
async function run_deep_research(task: HunterTask): Promise<HunterResult> {
  const prompt = [
    'Gemini (gemini.google.com)에 접속하여 Deep Research 모드로:',
    `주제: ${task.payload.topic}`,
    `조사 범위: ${task.payload.scope}`,
    `결과 형식: 개요, 핵심 발견, 출처, 미해결 질문`,
  ].join('\n')

  const result = await execute_openclaw(prompt, task.timeout_minutes ?? 30)

  return {
    status: result.success ? 'success' : 'failed',
    output: result.output,
    completed_at: new Date().toISOString(),
  }
}
```

## 헌터 현재 구현 상태 (2026-03-19 기준)

### 코드 구현 완료 (캡틴 레포에 존재)

| 모듈 | 파일 | 상태 |
|------|------|------|
| 폴링 루프 | `src/hunter/poll_loop.ts` | ✅ 완성 (10초 주기, 지수 백오프) |
| API 클라이언트 | `src/hunter/api_client.ts` | ✅ 완성 (fetch, heartbeat, result) |
| 태스크 실행기 | `src/hunter/task_executor.ts` | ✅ 4개 핸들러 모두 구현 |
| - web_crawl | | ✅ Playwright URL 크롤링 |
| - browser_task | | ✅ 스크린샷 + 텍스트 추출 |
| - deep_research | | ✅ Gemini Deep Research 웹 UI 자동화 |
| - notebooklm_verify | | ✅ NotebookLM 웹 UI 자동화 |
| 브라우저 매니저 | `src/hunter/browser.ts` | ✅ 일반 + persistent context (구글 프로필) |
| 설정 로더 | `src/hunter/config.ts` | ✅ 환경변수 기반 |
| 로거 | `src/hunter/logger.ts` | ✅ 파일+콘솔 듀얼 |
| 진입점 | `src/hunter/main.ts` | ✅ graceful shutdown |
| 셋업 스크립트 | `scripts/setup/setup_hunter.sh` | ✅ 초기 설정 자동화 |
| 로그인 감지 | `detect_login_wall()` | ✅ `[LOGIN_REQUIRED]` 반환 |
| 테스트 | `tests/hunter/`, `src/hunter/*.test.ts` | ✅ 전수 통과 |

### 헌터 머신 실제 상태

| 항목 | 상태 | 비고 |
|------|------|------|
| Tailscale 연결 | ✅ | 캡틴과 VPN 연결 완료 |
| SSH 키 교환 | ✅ | MacBook ↔ 캡틴 ↔ 헌터 |
| Claude Code OAuth | ❌ **사용 불가** | 가입 시 전화번호 인증 필수 → 헌터 전용 계정 B 생성 불가. 임시 대체: Gemini CLI 사용 (아래 참조) |
| 계정 B 생성 | ❌ | Anthropic 가입 프로세스의 전화번호 인증 요건으로 인해 미생성 |
| 구글 프로필 설정 | ❌ | 별도 구글 계정으로 수동 로그인 필요 |
| OpenClaw (ChatGPT Pro) | ✅ | OpenClaw 2026.3.13 설치, ChatGPT Pro OAuth 인증 완료. Gateway 데몬 가동 중 (port 18789) |
| Node.js | ✅ | v22 (OpenClaw 요구사항으로 20 → 22 업그레이드. sharp 빌드 이슈, npm 캐시 권한, nvm prefix 충돌 해결) |
| pnpm | ❓ | 확인 필요 |
| Playwright | ❌ | 미설치 |
| FAS Operations 코드 배포 | ❌ | deploy 스크립트로 최소 파일만 전송 (git clone 금지) |

### Claude Code 사용 불가 사유 및 임시 대체 방안

**사유**: Anthropic 계정 신규 가입 시 전화번호 인증이 필수로 요구된다. 헌터 격리 원칙상 주인님의 개인 전화번호를 헌터 전용 계정(계정 B)에 연결할 수 없으므로, 헌터 머신에서 Claude Code를 독립 계정으로 운용하는 것이 현재 불가능하다.

**임시 대체**: 헌터의 코딩·고지능 작업은 **Gemini CLI(계정 B)**로 임시 대행한다.
- 브라우저 자동화(OpenClaw), 크롤링, 리서치는 기존 계획대로 유지
- 코드 생성·분석·태스크 실행 등 Claude Code가 담당했던 지능 작업 → Gemini CLI로 처리
- 향후 Anthropic이 전화번호 없이 가입 가능한 방법을 제공하거나, 별도 해결책이 마련되면 계정 B를 생성하고 Claude Code로 전환한다

**주의**: 이 대체는 임시(interim) 조치이며, 헌터의 Claude Code 도입 계획 자체는 유효하다.

---

## 구글 계정 세션 관리

구글 서비스(NotebookLM, Deep Research)는 자동화된 브라우저 로그인을 강력히 차단한다(CAPTCHA 등).
매번 로그인하는 방식은 비현실적이므로 **초기 1회 수동 로그인 후 세션 재사용** 방식을 사용한다.

```text
1. 초기 세팅 (수동, 1회):
   - 헌터/캡틴에서 브라우저(Chrome) 실행
   - 구글 계정 수동 로그인
   - 쿠키/세션 데이터를 프로필 디렉토리에 저장
     (Chrome: --user-data-dir=/path/to/fas-google-profile)

2. 자동화 실행 시:
   - 저장된 프로필 디렉토리를 지정하여 브라우저 시작
   - 이미 로그인된 상태이므로 CAPTCHA 없이 접근 가능
   - OpenClaw/Puppeteer/Playwright 모두 --user-data-dir 옵션 지원

3. 세션 만료 시:
   - Watchdog이 "로그인 필요" 화면 감지 → Telegram 알림
   - 주인님이 원격(VNC)으로 재로그인 (수동, 5분 이내)
   - 재로그인 후 세션 자동 갱신

4. 프로필 경로:
   - 헌터: /Users/user/fas-google-profile-hunter/
   - 캡틴: /Users/user/fas-google-profile-captain/
   - 각각 별도 구글 계정
```

## Tailscale ACL 설정

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["tag:macbook"],
      "dst": ["tag:captain:*", "tag:hunter:*"]
    },
    {
      "action": "accept",
      "src": ["tag:hunter"],
      "dst": ["tag:captain:3100"]
    },
    {
      "action": "accept",
      "src": ["tag:captain"],
      "dst": ["tag:hunter:22"]
    }
  ],
  "tagOwners": {
    "tag:macbook": ["autogroup:admin"],
    "tag:captain": ["autogroup:admin"],
    "tag:hunter":  ["autogroup:admin"]
  }
}
```

규칙 요약:
- MacBook Pro → 캡틴/헌터 모든 포트 접근 가능 (SSH, 모니터링)
- 헌터 → 캡틴 3100 포트만 (Task API)
- 캡틴 → 헌터 22 포트만 (SSH, 긴급 관리용)
- 헌터 → 캡틴 파일시스템 접근 불가

---

## Stage 2: 운영

### 모니터링 (Heartbeat Monitor)

캡틴의 `src/watchdog/hunter_monitor.ts`가 헌터의 heartbeat를 주기적으로 감시한다.

| 임계값 | 동작 | 채널 |
|--------|------|------|
| heartbeat 2분 경과 | WARNING 알림 | Slack |
| heartbeat 5분 경과 | ALERT 알림 | Telegram (긴급) |
| heartbeat 복구 | RECOVERY 알림 | Slack |

```typescript
import { start_hunter_monitor, stop_hunter_monitor } from '../watchdog/hunter_monitor.js';

start_hunter_monitor({
  gateway_url: 'http://localhost:3100',
  check_interval_ms: 30_000,
  warning_threshold_ms: 120_000,
  alert_threshold_ms: 300_000,
  notification_router,
});
```

### 자동 재시작 (Hunter Watchdog)

헌터 머신의 `scripts/hunter_watchdog.sh`가 프로세스 크래시 시 자동 재시작한다.

- **nvm 환경 자동 로드**: 비로그인 셸(launchd)에서 실행되므로, 스크립트 시작 시 `$NVM_DIR/nvm.sh`를 명시적으로 source하여 Node.js 환경을 로드한다
- **OpenClaw Gateway health check**: 에이전트 시작 전 최대 60초 대기하며 `http://localhost:18789/health` 응답을 확인한다. Gateway가 준비되지 않으면 에이전트를 시작하지 않는다
- 지수 백오프: `5s → 10s → 20s`
- 최대 3회 연속 재시작 시도
- 60초 이상 정상 실행 후 크래시 → 카운터 리셋
- 최대 재시작 횟수 초과 시:
  - `[BLOCKED]` 로그 출력
  - Telegram 긴급 알림 전송
  - 300초 대기 후 카운터 리셋

### launchd 자동 시작

헌터 머신에서 `com.fas.hunter.plist`를 설치하면 부팅/로그인 시 자동으로 tmux 세션이 시작된다.

**nvm 호환성**: `com.fas.hunter.plist`의 `PATH` 환경변수에 nvm 경로(`$HOME/.nvm/versions/node/v22.x.x/bin`)를 포함한다. 비로그인 셸(launchd)에서는 `.zshrc`/`.bashrc`가 로드되지 않으므로, `hunter_watchdog.sh`가 `$NVM_DIR/nvm.sh`를 명시적으로 source하여 Node.js 환경을 보장한다.

```bash
# 설치
cp scripts/setup/com.fas.hunter.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.fas.hunter.plist

# 제거
launchctl unload ~/Library/LaunchAgents/com.fas.hunter.plist
rm ~/Library/LaunchAgents/com.fas.hunter.plist
```

로그: `~/Library/Logs/fas-hunter.log`

### 배포 검증 (Deployment Verification)

배포 후 `scripts/deploy/verify_hunter.sh`를 실행하여 모든 구성 요소를 검증한다.

```bash
bash scripts/deploy/verify_hunter.sh [captain-api-url] [hunter-api-key]
```

검증 항목:
1. Captain API 연결 테스트 (health endpoint)
2. Heartbeat 전송 및 반영 확인
3. 태스크 생성 → 폴링 → 결과 제출 사이클
4. PII 스캔 (개인정보 잔류 확인)
5. 런타임 환경 (Node.js, pnpm, Playwright, Tailscale)

### 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| Heartbeat ALERT | 헌터 프로세스 다운 | `ssh hunter` → `tmux attach -t fas-hunter` → 로그 확인 |
| 401 Unauthorized | API 키 불일치 | 캡틴/헌터 `.env`의 `HUNTER_API_KEY` 값 비교 |
| 429 Rate Limited | 과도한 요청 | 폴링 주기 확인 (`HUNTER_POLL_INTERVAL`) |
| PII Quarantined | 크롤링 결과에 개인정보 포함 | Gateway 로그에서 quarantine 확인, 수동 검토 |
| Tailscale 미연결 | VPN 끊김 | `tailscale up` → `tailscale status` |
| Playwright 에러 | Chromium 미설치 | `npx playwright install chromium` |
| LOGIN_REQUIRED | Google 세션 만료 | VNC로 헌터 접속 → Chrome 수동 로그인 |
| Watchdog 300s 대기 | 3회 연속 크래시 | 로그 확인: `logs/crashes_hunter.log` |
