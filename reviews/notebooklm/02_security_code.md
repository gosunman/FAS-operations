# FAS 보안 핵심 코드 — NotebookLM 검증용

> 이 문서는 보안 감사 대상인 핵심 코드를 포함합니다.

---

## 1. PII 산이타이저 (src/gateway/sanitizer.ts)

캡틴이 헌터에 태스크를 보내기 전 개인정보를 제거하는 모듈입니다.

```typescript
// PII 패턴 목록 (정규식 기반)
const PII_PATTERNS = [
  // 한국 이름 (라벨 포함): "이름: 홍길동" → "이름: [이름 제거됨]"
  { name: 'labeled_korean_name', regex: /(이름|성명|본명)[:：]\s*[가-힣]{2,4}/gi },

  // 주민번호: "900101-1234567" → "[주민번호 제거됨]"
  { name: 'resident_id', regex: /\d{6}-?[1-4]\d{6}/g },

  // 전화번호: "010-1234-5678" → "[전화번호 제거됨]"
  { name: 'phone_number', regex: /01[016789]-?\d{3,4}-?\d{4}/g },

  // 이메일: "user@test.com" → "[이메일 제거됨]"
  { name: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },

  // 한국 주소: "서울시 강남구" → "[주소 제거됨]"
  { name: 'address', regex: /(서울|부산|...|제주)[시도]?\s+[가-힣]+[시군구]/g },

  // 신용카드: "1234-5678-9012-3456" → "[카드번호 제거됨]"
  { name: 'credit_card', regex: /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/g },

  // 내부 IP (10.x, 172.16-31.x, 192.168.x, Tailscale 100.64-127.x)
  { name: 'ip_address', regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|...)\b/g },

  // 계좌번호: "110-123-456789" → "[계좌 제거됨]"
  { name: 'bank_account', regex: /\d{3,4}-\d{2,6}-\d{2,6}/g },

  // 금융정보: "연봉 5000만" → "[금융정보 제거됨]"
  { name: 'financial_amount', regex: /(자산|현금|예금|보증금|연봉|월급)[:：]?\s*[약~]?\s*\d+[만억천]/g },
];
```

### 화이트리스트 방식 sanitize_task

```typescript
// 헌터에 전달되는 필드 (이것만 전달, 나머지는 모두 제거)
type HunterSafeTask = {
  id: string;
  title: string;          // sanitize_text() 적용
  description?: string;   // sanitize_text() 적용
  priority: 'low' | 'medium' | 'high' | 'urgent';
  mode: 'sleep' | 'awake' | 'recurring';
  risk_level: 'low' | 'mid' | 'high' | 'critical';
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  deadline: string | null;
};

// 제외되는 필드: assigned_to, requires_personal_info, depends_on, output, created_at, completed_at
```

---

## 2. Task API 서버 — 헌터 엔드포인트 (src/gateway/server.ts)

### 헌터에 태스크 전달 (산이타이징)

```typescript
// GET /api/hunter/tasks/pending
app.get('/api/hunter/tasks/pending', (_req, res) => {
  const tasks = store.get_pending_for_agent('openclaw');
  const sanitized = tasks
    .filter((t) => !t.requires_personal_info)  // 개인정보 필요 태스크 필터링
    .map(sanitize_task);                        // 화이트리스트 산이타이징
  res.json({ tasks: sanitized, count: sanitized.length });
});
```

### 헌터 결과 수신 (역방향 PII 검사)

```typescript
// POST /api/hunter/tasks/:id/result
app.post('/api/hunter/tasks/:id/result', (req, res) => {
  const { status: result_status, output, files } = req.body;

  // 역방향 PII 검사: 헌터 output에 개인정보가 포함되어 있으면 산이타이징
  let safe_output = output || (result_status === 'success' ? 'Completed' : 'Failed');
  if (contains_pii(safe_output)) {
    console.warn(`[SECURITY] Hunter task ${req.params.id} output contains PII — sanitizing`);
    safe_output = sanitize_text(safe_output);
  }

  if (result_status === 'success') {
    store.complete_task(req.params.id, {
      summary: safe_output,
      files_created: files ?? [],
    });
  } else {
    store.block_task(req.params.id, safe_output);
  }

  res.json({ ok: true });
});
```

---

## 3. 헌터 에이전트 래퍼 (src/hunter/)

헌터 머신에서 실행되는 폴링 클라이언트입니다.

### 설정 (config.ts)

```typescript
// CAPTAIN_API_URL 환경변수 필수 — 하드코딩된 IP 없음
export const load_hunter_config = (): HunterConfig => {
  const captain_api_url = process.env.CAPTAIN_API_URL;
  if (!captain_api_url) {
    throw new Error('CAPTAIN_API_URL environment variable is required');
  }
  return {
    captain_api_url,
    poll_interval_ms: parseInt(process.env.HUNTER_POLL_INTERVAL ?? '10000', 10),
    log_dir: process.env.HUNTER_LOG_DIR ?? './logs',
    device_name: 'hunter',
  };
};
```

### 폴링 루프 (poll_loop.ts)

```
1. heartbeat 전송 → 2. pending 태스크 폴링 → 3. 첫 태스크 실행 → 4. 결과 제출 → 5. 대기
- 정상: 10초 주기
- 연속 실패 시: 지수 백오프 (10s → 20s → 40s → ... 최대 5분)
- 성공 시: 즉시 리셋
```

### 태스크 실행기 (task_executor.ts)

```
태스크 title/description에서 키워드로 액션 라우팅:
- "notebooklm", "verify" → notebooklm_verify
- "deep research" → deep_research
- "crawl", "scrape", "크롤링" → web_crawl
- 기타 → browser_task (기본값)

현재는 모두 스텁 구현. OpenClaw 연동 시 실제 구현으로 교체 예정.
```

---

## 4. 공유 타입 (src/shared/types.ts)

```typescript
type Task = {
  id: string;
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigned_to: string;           // ← 헌터에 전달되지 않음
  mode: 'sleep' | 'awake' | 'recurring';
  risk_level: 'low' | 'mid' | 'high' | 'critical';
  requires_personal_info: boolean; // ← 헌터에 전달되지 않음
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  created_at: string;             // ← 헌터에 전달되지 않음
  deadline: string | null;
  depends_on: string[];           // ← 헌터에 전달되지 않음
  output?: { summary: string; files_created: string[]; }; // ← 헌터에 전달되지 않음
};

type HunterTaskResult = {
  status: 'success' | 'failure';
  output: string;    // ← 캡틴에서 역방향 PII 검사 적용
  files: string[];
};
```
