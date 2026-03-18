# Gemini CLI Module

Gemini CLI TypeScript wrapper for FAS.

## Purpose

Gemini CLI를 프로그래밍 방식으로 호출하기 위한 모듈. 교차 승인, 리서치, 팩트체킹에 사용된다.

## Components

| File | Role |
|------|------|
| `types.ts` | 타입 정의 (GeminiConfig, GeminiResponse 등) |
| `cli_wrapper.ts` | Gemini CLI spawn, 출력 파싱, 세션 상태 확인 |
| `index.ts` | Barrel export |

## Usage

```typescript
import { spawn_gemini, check_session_status } from './index.js';

// Spawn Gemini CLI
const response = await spawn_gemini(
  { account: 'a', timeout_ms: 60_000 },
  'Analyze the latest AI trends'
);

// Check tmux session status
const status = check_session_status('a'); // 'running' | 'stopped' | 'crashed'
```

## Account Convention

- **Account A** (`fas-gemini-a`): 리서치, 정보 수집
- **Account B** (`fas-gemini-b`): 교차 검증, 팩트체킹
