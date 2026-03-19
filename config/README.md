# Config (`config/`)

FAS 시스템의 정적 설정 파일 — YAML 기반으로 스케줄, 에이전트, 위험도 규칙을 정의.

## 파일 구성

| 파일 | 용도 |
|------|------|
| `schedules.yml` | 반복 태스크 스케줄 정의 (daily, every_3_days, weekly) |
| `risk_rules.yml` | 위험도 분류 규칙 (LOW/MID/HIGH/CRITICAL → 자동/AI승인/인간승인) |
| `agents.yml` | 에이전트 설정 (캡틴, 헌터, Gemini 역할 및 도구 정의) |
| `tmux.conf` | FAS 전용 tmux 설정 |
| `n8n/` | n8n 워크플로우 관련 설정 |

## schedules.yml

반복 태스크를 정의한다. `planning_loop.ts`가 매일 아침(07:30)/밤(22:50)에 파싱하여 due 태스크를 생성.

```yaml
# 스케줄 타입
# daily        — 매일 실행
# every_3_days — 3일마다 실행
# weekly       — 주 1회 실행

- title: "블라인드 네이버 인기글 모니터링"
  action: chatgpt_task     # OpenClaw 검색엔진 우회 (web_crawl 직접 접근은 안티봇 차단)
  assigned_to: hunter
  schedule: daily
  mode: sleep
  priority: medium
  risk_level: low
```

**에이전트 할당 현황:** 모든 Phase 4 태스크는 `hunter`에 할당. `gemini_a`용 독립 실행기가 미구현이므로, `ai_trends`와 `grad_school_deadlines`도 `hunter` (chatgpt_task)로 재할당됨.

## risk_rules.yml

태스크 위험도에 따른 승인 게이트를 정의한다.

| 위험도 | 승인 방식 | 예시 |
|--------|----------|------|
| `low` | 자동 실행 | 파일 읽기, 웹 검색, 테스트 실행 |
| `mid` | AI 교차 승인 (Gemini CLI) | 파일 쓰기, git commit, 코드 생성 |
| `high` | 인간 승인 (Telegram) | git push, PR 생성, 외부 API 호출 |
| `critical` | 인간 필수 승인 | 프로덕션 배포, 데이터 삭제, 결제 |

## agents.yml

에이전트별 역할, 사용 가능 도구, 모델을 정의한다.
