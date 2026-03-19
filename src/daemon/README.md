# FAS Daemon

Claude Code(캡틴)와 독립적으로 실행되는 상시 데몬 프로세스.

## 목적

Claude Code API 사용량이 소진되어 캡틴이 멈추더라도, 주인님이 Telegram을 통해 헌터에게 직접 태스크를 지시할 수 있도록 보장합니다.

## 구성 요소

| 파일 | 역할 |
|------|------|
| `telegram_bot.ts` | Telegram Bot API long polling 기반 명령어 처리 |
| `start.ts` | Gateway HTTP 서버 + Telegram 봇을 동시 실행하는 엔트리포인트 |

## Telegram 명령어

| 명령어 | 설명 |
|--------|------|
| `/hunter <설명>` | 헌터에게 chatgpt_task 배정 |
| `/crawl <URL>` | 웹 크롤링 태스크 생성 |
| `/research <주제>` | Deep Research 태스크 생성 |
| `/status` | 현재 태스크 현황 (대기/진행/완료/차단/격리) |
| `/tasks` | 대기 중인 태스크 목록 (최대 10건) |
| `/cancel <task_id>` | 태스크 취소 |

## 환경 변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `TELEGRAM_BOT_TOKEN` | O | Telegram Bot API 토큰 |
| `TELEGRAM_OWNER_ID` | O | 주인님의 Telegram chat ID (이 ID만 명령 수락) |
| `GATEWAY_PORT` | X | Gateway HTTP 포트 (기본: 3100) |
| `GATEWAY_HOST` | X | Gateway 바인딩 호스트 (기본: 0.0.0.0) |
| `HUNTER_API_KEY` | 조건부 | 헌터 API 인증 키 (dev mode가 아니면 필수) |

## 실행

```bash
# 환경 변수 설정 후
pnpm tsx src/daemon/start.ts
```

## 보안

- **Owner-only**: `TELEGRAM_OWNER_ID`에 설정된 chat ID의 메시지만 처리, 나머지는 무시
- **No PII leak**: 일반 텍스트(비명령어)는 어디로도 라우팅하지 않음 (캡틴 없이 동작하므로)
- **Telegram Bot API**: 외부 라이브러리 없이 native `fetch`로 직접 구현

## 테스트

```bash
pnpm vitest run tests/daemon/telegram_bot.test.ts
```
