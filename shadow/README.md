# Shadow (그림자) — 주인님의 보좌관

MacBook Pro (M1 Pro / 32GB)에서 주인님이 필요할 때만 수동으로 사용하는 지휘소.

## 목적

주인님이 직접 조종하는 개인 디바이스. AI가 자율 실행하지 않으며,
SSH로 캡틴/헌터에 원격 접근하여 감독하고 NotebookLM 대규모 검증을 수행한다.

## 구조

```
shadow/
├── CLAUDE.md    # 그림자 전용 Claude Code 규칙 (최소한)
└── README.md    # (이 파일)
```

## 역할

- SSH로 캡틴/헌터 상태 확인 및 수동 개입
- NotebookLM 대규모 검증 (마일스톤 완료 시)
- 코드 작성, 설계, 디버깅 시 Claude Code 수동 보조

상세: [docs/agents-charter.md](../docs/agents-charter.md)
