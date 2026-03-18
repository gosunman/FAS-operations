# Hunter (헌터) 👁️ — 주인님의 눈

Mac Studio #1 (M1 Ultra / 32GB)에서 24/7 무중단 가동. 정보 탐색, 크롤링, 리서치를 담당하는 자율 탐색 에이전트.

## 목적

외부 세계로 나아가 주인님에게 도움될 정보, 트렌드, 기회를 적극적으로 찾는 일꾼.
직접 지시 없이도 주인님의 의중을 파악하여 자율적으로 행동한다.

## 구조

```
hunter/
├── CLAUDE.md              # 헌터 전용 Claude Code 규칙
├── README.md              # (이 파일)
└── openclaw/
    ├── system_prompt.md   # OpenClaw(ChatGPT Pro) 초기 지시문
    └── browsing_rules.md  # 브라우징 규칙, 봇탐지 우회, 사이트 허용/금지 목록
```

## 주요 도구

| 도구 | 용도 |
|------|------|
| OpenClaw (ChatGPT Plus) | 메인 엔진, 브라우저 자동화, 봇탐지 우회 (계정 B) |
| Gemini CLI | 코딩, 소규모 검증, 비크리티컬 결정 대행 (계정 B, Claude Code 임시 대체) |

## 보안

- **개인정보 완전 차단** — 주인님의 개인정보에 접근 불가
- **소스코드 격리** — FAS 소스코드 수신/보유 금지
- **계정 격리** — 계정 B(헌터 전용) 전용

상세: [docs/agents-charter.md](../docs/agents-charter.md)
