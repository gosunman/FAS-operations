# 헌터 격리 & 통신 프로토콜

## 격리 원칙

헌터(Mac Studio #1)는 **완전 격리된 환경**이다. OpenClaw(ChatGPT Pro)가 브라우저 세션을 통째로 사용하므로, 개인정보가 유입되면 유출 위험이 있다.

### 격리 항목

| 항목 | 캡틴 | 헌터 | 공유 여부 |
| --- | --- | --- | --- |
| macOS 계정 | user | user | 별도 (같은 이름, 다른 머신) |
| iCloud | 주인님 계정 | 별도 계정 | X |
| Google | 주인님 계정 | 별도 계정 | X |
| ChatGPT | — | 별도 계정 (Pro) | X |
| Claude Code | 주인님 OAuth | — | X (헌터에서 미사용) |
| Tailscale | 같은 네트워크 | 같은 네트워크 | O (VPN만 공유) |
| 파일시스템 | 직접 접근 불가 | 직접 접근 불가 | X |
| 통신 | Task API 서버 | Task API 클라이언트 | API만 |

### 절대 금지

- 헌터에 주인님 이름, 연락처, 주소, 금융정보 전달
- 헌터에서 캡틴으로 SSH 접속
- 헌터가 캡틴의 파일시스템 마운트
- 캡틴의 .env, secrets를 헌터에 복사

## 통신 아키텍처

```text
┌─────────────────────┐          HTTP (Tailscale)         ┌──────────────────┐
│       캡틴          │  ────────────────────────────────→ │      헌터         │
│                     │                                    │                  │
│  Task API Server    │ ← POST /api/hunter/tasks/:id/result│  Agent Wrapper   │
│  :3100              │                                    │  (폴링 클라이언트)│
│                     │ ← POST /api/hunter/heartbeat       │                  │
│  산이타이징 레이어   │                                    │  OpenClaw        │
│  (개인정보 제거)     │                                    │  (실행)          │
└─────────────────────┘                                    └──────────────────┘
```

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
