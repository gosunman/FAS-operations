# FAS Daemon

Claude Code(캡틴)와 독립적으로 실행되는 상시 데몬 프로세스.

## 목적

Claude Code API 사용량이 소진되어 캡틴이 멈추더라도, 주인님이 Telegram 또는 Slack을 통해 헌터에게 직접 태스크를 지시할 수 있도록 보장합니다. 또한 Gemini CLI 폴백을 통해 캡틴의 핵심 기능을 응급 대행합니다.

## 구성 요소

| 파일 | 역할 |
|------|------|
| `telegram_bot.ts` | Telegram Bot API long polling 기반 자연어 태스크 처리 |
| `slack_bot.ts` | Slack Web API polling 기반 자연어 태스크 처리 (쓰레드 기반 맥락 관리) |
| `gemini_fallback.ts` | Claude Code 소진 시 Gemini CLI로 캡틴 기능 응급 대행 |
| `usage_monitor.ts` | Claude Code 가용성 모니터링 + 자동 모드 전환 (normal/warning/fallback) |
| `start.ts` | Gateway + Telegram + Slack + UsageMonitor + GeminiFallback 통합 엔트리포인트 |

## 모드 전환 시스템

Claude Code의 가용성에 따라 자동으로 모드가 전환됩니다.

### 모드 종류

| 모드 | 상태 | 동작 |
|------|------|------|
| `normal` | Claude Code 정상 | 모든 작업을 Claude Code가 처리 |
| `warning` | 연속 실패 감지 (기본 3회) | 주인님에게 Telegram 경고 알림 |
| `fallback` | 사용량 소진 (기본 5회 연속 실패) | Gemini CLI가 캡틴 역할 대행 |

### 전환 흐름

```
normal → warning   (warning_threshold 도달)
warning → fallback (failure_threshold 도달)
fallback → normal  (Claude Code 성공 응답 감지)
any → any          (force_mode()로 수동 전환)
```

### Gemini 폴백 대행 기능

- 주인님의 Telegram 메시지에 대한 기본 응답
- 헌터 태스크 결과 검토 및 요약
- 긴급 알림 처리
- 간단한 코드 리뷰/분석

## 사용 방법

주인님이 Telegram 또는 Slack에서 아무 메시지나 보내면, 봇이 내용을 분석하여 자동으로 적절한 헌터 태스크로 변환합니다.

### 자동 액션 분류 (Telegram/Slack 공통)

| 조건 | 액션 타입 | 예시 |
|------|-----------|------|
| URL 포함 | `web_crawl` | "https://example.com 이거 봐줘" |
| 리서치 키워드 포함 | `deep_research` | "AI 트렌드 2026 리서치해줘", "경쟁사 분석" |
| 그 외 | `chatgpt_task` (기본) | "블라인드 인기글 긁어와" |

리서치 키워드: 리서치, 조사, 알아봐, 찾아봐, 찾아줘, 검색, 분석, 비교, 살펴봐, research, investigate, analyze, compare

### Telegram 유틸 명령어 (slash)

| 명령어 | 설명 |
|--------|------|
| `/status` | 현재 태스크 현황 (대기/진행/완료/차단/격리) |
| `/tasks` | 대기 중인 태스크 목록 (최대 10건) |
| `/cancel <task_id>` | 태스크 취소 |

### Slack 유틸 명령어 (키워드)

| 키워드 | 설명 |
|--------|------|
| `상태` 또는 `status` | 현재 태스크 현황 |
| `목록` 또는 `tasks` | 대기 중인 태스크 목록 (최대 10건) |
| `취소 <task_id>` 또는 `cancel <task_id>` | 태스크 취소 |

### Slack 쓰레드 기반 맥락 관리

- 주인님이 Slack 채널에 메시지를 보내면 새 태스크 생성 + 해당 메시지의 쓰레드로 확인 메시지
- 헌터 결과가 도착하면 해당 태스크의 원본 메시지 쓰레드에 결과 회신
- 태스크별로 쓰레드가 하나씩 생겨서 맥락 관리가 쉬움

## 환경 변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `TELEGRAM_BOT_TOKEN` | O | Telegram Bot API 토큰 |
| `TELEGRAM_OWNER_ID` | O | 주인님의 Telegram chat ID (이 ID만 명령 수락) |
| `SLACK_BOT_TOKEN` | X | Slack Bot Token (xoxb-...), 설정 시 Slack 봇 활성화 |
| `SLACK_CHANNEL_ID` | 조건부 | 헌터 전용 Slack 채널 ID (SLACK_BOT_TOKEN 설정 시 필수) |
| `GATEWAY_PORT` | X | Gateway HTTP 포트 (기본: 3100) |
| `GATEWAY_HOST` | X | Gateway 바인딩 호스트 (기본: 0.0.0.0) |
| `HUNTER_API_KEY` | 조건부 | 헌터 API 인증 키 (dev mode가 아니면 필수) |
| `GEMINI_TIMEOUT_MS` | X | Gemini CLI 호출 타임아웃 (기본: 120000) |
| `GEMINI_MODEL` | X | Gemini 모델 오버라이드 (기본: CLI 기본값) |
| `CLAUDE_FAILURE_THRESHOLD` | X | 폴백 전환까지의 연속 실패 횟수 (기본: 5) |
| `CLAUDE_WARNING_THRESHOLD` | X | 경고 모드 전환까지의 연속 실패 횟수 (기본: 3) |

## 실행

```bash
# 환경 변수 설정 후
pnpm tsx src/daemon/start.ts
```

## 보안

- **Telegram Owner-only**: `TELEGRAM_OWNER_ID`에 설정된 chat ID의 메시지만 처리, 나머지는 무시
- **Slack Channel-only**: `SLACK_CHANNEL_ID`에 설정된 채널의 메시지만 처리, 봇 메시지는 무시
- **API 직접 구현**: 외부 라이브러리 없이 native `fetch`로 Telegram/Slack API 직접 호출
- **Gemini 격리**: Gemini CLI에는 개인정보나 시크릿을 전달하지 않음, 시스템 컨텍스트만 제공

## 테스트

```bash
npx vitest run tests/daemon/telegram_bot.test.ts
npx vitest run tests/daemon/slack_bot.test.ts
npx vitest run tests/daemon/gemini_fallback.test.ts
```
