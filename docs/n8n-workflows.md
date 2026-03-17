# n8n 워크플로우 상세

## 개요

n8n은 캡틴에서 Colima(Docker)로 실행. 태스크 생성, 스케줄링, 모드 관리, 알림 라우팅의 **중앙 허브**.

n8n은 에이전트를 직접 제어하지 않는다. 대신:
1. 태스크 파일을 `tasks/pending/`에 생성
2. Agent Wrapper가 태스크를 폴링하여 실행
3. 완료 시 `tasks/done/`에 결과 저장
4. n8n이 `done/` 디렉토리를 감시하여 후속 처리

## docker-compose.yml

```yaml
# docker-compose.yml

version: '3.8'

services:
  n8n:
    image: n8nio/n8n:latest
    restart: unless-stopped
    ports:
      - "5678:5678"     # Tailscale 내부에서만 접근
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=${N8N_USER}
      - N8N_BASIC_AUTH_PASSWORD=${N8N_PASSWORD}
      - GENERIC_TIMEZONE=Asia/Seoul
      - TZ=Asia/Seoul
      - N8N_LOG_LEVEL=info
    volumes:
      - n8n_data:/home/node/.n8n
      # 프로젝트 디렉토리 마운트 (태스크 파일 접근용)
      - ${PROJECT_DIR}/tasks:/data/tasks
      - ${PROJECT_DIR}/state:/data/state
      - ${PROJECT_DIR}/reports:/data/reports
      - ${PROJECT_DIR}/config:/data/config:ro

volumes:
  n8n_data:
    driver: local
```

## 워크플로우 목록

### WF-1: 마스터 스케줄러

태스크를 주기적으로 생성하는 메인 워크플로우.

```text
트리거: 매 5분 크론
  │
  ├─→ [Read] config/schedules.yml
  │
  ├─→ [Code] 현재 시간 기준 실행할 스케줄 계산
  │   - 각 스케줄의 next_run과 현재 시간 비교
  │   - SLEEP/AWAKE 모드 확인
  │   - 실행 대상 스케줄 목록 생성
  │
  ├─→ [Loop] 각 스케줄에 대해:
  │   ├─→ [Code] 태스크 YAML 생성
  │   ├─→ [Write File] tasks/pending/{task_id}.yml
  │   └─→ [Code] 다음 실행 시간 계산 & schedules.yml 업데이트
  │
  └─→ [Slack] #fas-general에 생성된 태스크 목록 알림 (있을 때만)
```

### WF-2: 결과 수집기

완료된 태스크를 감지하여 후속 처리.

```text
트리거: Watch Folder (tasks/done/, 새 파일 감지)
  │
  ├─→ [Read File] 완료된 태스크 YAML 읽기
  │
  ├─→ [Switch] 알림 채널 분기
  │   ├─→ notification.on_complete === 'slack'
  │   │   └─→ [Slack] 해당 채널에 결과 요약 전송
  │   │
  │   ├─→ notification.on_complete === 'telegram'
  │   │   └─→ [Telegram] 긴급 알림 전송
  │   │
  │   └─→ notification.report_format === 'notion_page'
  │       └─→ [HTTP] Notion API 호출 → 페이지 생성
  │           └─→ [Slack] #reports에 Notion URL 전송
  │
  ├─→ [Code] 반복 태스크면 다음 실행 태스크 생성
  │   └─→ [Write File] tasks/pending/{next_task_id}.yml
  │
  └─→ [Code] state/agent_status.json 업데이트 (에이전트 idle로)
```

### WF-3: 모드 전환

```text
트리거: 크론 (23:00 → SLEEP, 07:30 → AWAKE)
  │
  ├─→ [Code] state/current_mode.json 업데이트
  │   {
  │     "mode": "sleep",
  │     "switched_at": "2026-03-17T23:00:00+09:00",
  │     "next_switch": "2026-03-18T07:30:00+09:00"
  │   }
  │
  ├─→ [Switch] 모드별 분기
  │   ├─→ SLEEP 진입:
  │   │   ├─→ [Code] AWAKE 전용 in_progress 태스크 → 일시중지 (blocked로 이동, 사유: mode_switch)
  │   │   └─→ [Slack] #fas-general "🌙 SLEEP 모드 진입"
  │   │
  │   └─→ AWAKE 진입:
  │       ├─→ [HTTP] 모닝 브리핑 생성 트리거 (WF-4)
  │       ├─→ [Code] mode_switch로 blocked된 태스크 → pending으로 복원
  │       └─→ [Slack] #fas-general "☀️ AWAKE 모드 진입"
  │
  └─→ [Telegram] 모드 전환 알림
```

### WF-4: 모닝 브리핑

```text
트리거: WF-3에서 AWAKE 진입 시 호출 (또는 매일 07:30)
  │
  ├─→ [Read] 밤새 완료된 태스크 목록 (tasks/done/ 중 오늘 날짜)
  ├─→ [Read] 현재 blocked 태스크 목록
  ├─→ [Read] 현재 pending 승인 목록
  ├─→ [Read] 크롤링 결과 요약 (reports/crawl_results/)
  │
  ├─→ [Code] 브리핑 텍스트 생성
  │   - 완료 건수, 차단 건수
  │   - 주요 발견 (창업, 채용, 청약 등)
  │   - 승인 대기 목록
  │   - 오늘 추천 태스크
  │
  ├─→ [Telegram] 요약 전송 (Galaxy Watch 진동)
  ├─→ [Slack] #fas-general 상세 전송
  └─→ [HTTP] Notion 전체 리포트 페이지 생성
```

### WF-5: 에이전트 헬스체크

```text
트리거: 매 5분 크론
  │
  ├─→ [Code] state/agent_status.json 읽기
  │   - 각 에이전트의 last_heartbeat 확인
  │   - 5분 이상 무응답 → 경고
  │   - 15분 이상 무응답 → 위험
  │
  ├─→ [HTTP] Task API /api/health 호출 (Gateway 살아있는지)
  │
  ├─→ [Code] 헌터 heartbeat 확인
  │   - Task API의 last_hunter_heartbeat
  │   - 60초 이상 없으면 → 경고
  │
  ├─→ [Switch] 문제 있으면
  │   ├─→ [Execute Command] tmux 세션 확인: tmux has-session -t {session}
  │   ├─→ 세션 없으면: [Execute Command] 재시작 스크립트 실행
  │   └─→ 3회 실패: [Telegram] 긴급 알림
  │
  └─→ [Code] state/agent_status.json 업데이트
```

### WF-6: 리소스 모니터링

```text
트리거: 매 30분 크론
  │
  ├─→ [Execute Command] 캡틴 리소스 수집
  │   - CPU: top -l 1 | grep "CPU usage"
  │   - RAM: vm_stat | memory pressure
  │   - 디스크: df -h /
  │
  ├─→ [HTTP] 헌터 리소스 수집 (SSH 경유 또는 Task API 확장)
  │
  ├─→ [Code] 임계값 체크
  │   - RAM 사용률 > 85% → 경고
  │   - 디스크 잔여 < 10GB → 경고
  │   - CPU 지속 > 90% (3회 연속) → 경고
  │
  ├─→ [Switch] 임계값 초과 시
  │   ├─→ [Telegram] 긴급 알림 + 구매 제안
  │   └─→ [Slack] #alerts 상세 정보
  │
  └─→ [Code] logs/resource/{date}.json에 기록
```

### WF-7: 차단 태스크 에스컬레이션

```text
트리거: Watch Folder (tasks/blocked/, 새 파일 감지)
  │
  ├─→ [Read File] 차단된 태스크 YAML
  │
  ├─→ [Code] 차단 사유 분석
  │   - approval_rejected → 인간에게 보고
  │   - agent_error → 재시도 가능한지 확인
  │   - mode_switch → 무시 (모드 전환 시 자동 복원)
  │   - dependency → 선행 태스크 상태 확인
  │
  ├─→ [Switch] 사유별 분기
  │   ├─→ 재시도 가능: 태스크를 pending으로 되돌리기 (retry_count 증가)
  │   ├─→ 인간 개입 필요: [Telegram] 알림
  │   └─→ 자동 해결 불가: [Slack] #alerts
  │
  └─→ [Code] 차단 로그 기록
```

## schedules.yml

```yaml
# config/schedules.yml

schedules:
  # === 정보 수집 ===
  startup_crawl:
    title: "창업지원사업 크롤링"
    type: every_3_days
    time: "02:00"
    mode: sleep
    template: startup_crawl
    agent: gemini_a

  housing_crawl:
    title: "로또 청약 모니터링"
    type: every_3_days
    time: "02:30"
    mode: sleep
    template: housing_crawl
    agent: gemini_a

  blind_monitor:
    title: "블라인드 네이버 인기글 감지"
    type: daily
    time: "03:00"
    mode: recurring
    template: blind_monitor
    agent: gemini_a

  ai_trends:
    title: "AI 트렌드 리서치"
    type: daily
    time: "01:00"
    mode: sleep
    template: ai_trends
    agent: gemini_a

  job_openings:
    title: "글로벌 빅테크 채용 체크"
    type: every_3_days
    time: "03:30"
    mode: sleep
    template: job_openings
    agent: gemini_a

  grad_school:
    title: "대학원 일정 체크"
    type: weekly
    day: monday
    time: "04:00"
    mode: sleep
    template: grad_school
    agent: gemini_a

  # === 시스템 ===
  morning_briefing:
    title: "모닝 브리핑"
    type: daily
    time: "07:30"
    mode: awake
    workflow: WF-4

  mode_sleep:
    title: "SLEEP 모드 전환"
    type: daily
    time: "23:00"
    workflow: WF-3

  mode_awake:
    title: "AWAKE 모드 전환"
    type: daily
    time: "07:30"
    workflow: WF-3
```
