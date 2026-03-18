# Gemini CLI Setup Guide

FAS에서 Gemini CLI를 상시 실행하기 위한 설정 가이드.

## 개요

캡틴(Mac Studio #2)에서 Gemini CLI 2개 세션을 상시 운영한다:
- **Account A** (`fas-gemini-a`): 리서치 전용 — 웹 검색, 트렌드 분석
- **Account B** (`fas-gemini-b`): 교차 검증 전용 — 팩트체킹, AI 산출물 리뷰

## 사전 요구사항

- Gemini CLI v0.33.2+ 설치
- Google 계정 2개 인증 완료
- tmux 설치

## 계정 인증

### Account A (기본)
```bash
gemini auth login
```

### Account B (별도 config 디렉토리)
```bash
GEMINI_CONFIG_DIR=$HOME/.gemini-b gemini auth login
```

## 세션 시작

### 전체 시작
```bash
./scripts/gemini/start_gemini_sessions.sh all
```

### 개별 시작
```bash
./scripts/gemini/start_gemini_sessions.sh a   # Account A만
./scripts/gemini/start_gemini_sessions.sh b   # Account B만
```

## 세션 관리

### 상태 확인
```bash
tmux list-sessions | grep gemini
```

### 세션 접속
```bash
tmux attach -t fas-gemini-a
tmux attach -t fas-gemini-b
```

### 세션 종료
```bash
tmux kill-session -t fas-gemini-a
tmux kill-session -t fas-gemini-b
```

## TypeScript Wrapper

`src/gemini/cli_wrapper.ts`를 통해 프로그래밍 방식으로 Gemini CLI를 호출할 수 있다:

```typescript
import { spawn_gemini } from './src/gemini/index.js';

const response = await spawn_gemini(
  { account: 'a', timeout_ms: 60_000 },
  'Search for latest TypeScript 5.x features'
);

if (response.success) {
  console.log(response.content);
}
```

## 자동 재시작

`gemini_wrapper.sh`가 크래시 시 자동 재시작한다:
- 최대 3회 재시도 (지수 백오프)
- 60초 이상 실행 후 크래시 → 재시도 카운터 리셋
- 3회 초과 → `[BLOCKED]` 패턴 출력 → Watchdog가 Telegram 알림

## 로그

- 실행 로그: `logs/gemini-{a|b}.log`
- 크래시 로그: `logs/crashes_gemini-{a|b}.log`

## 트러블슈팅

### "Command not found"
```bash
which gemini  # PATH 확인
npm install -g @anthropic-ai/gemini-cli  # 재설치
```

### Account B 인증 실패
```bash
GEMINI_CONFIG_DIR=$HOME/.gemini-b gemini auth status
GEMINI_CONFIG_DIR=$HOME/.gemini-b gemini auth login  # 재인증
```

### tmux 세션이 즉시 종료됨
크래시 로그 확인:
```bash
tail -20 logs/crashes_gemini-a.log
```
