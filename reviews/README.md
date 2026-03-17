# reviews/

외부 AI(NotebookLM 등)를 활용한 검증 리뷰 자료 보관 디렉토리.

## 주의사항

- **이 폴더는 절대 헌터 머신에 배포하지 않습니다.**
- 보안 감사 보고서, 코드 분석 자료 등 민감한 시스템 정보가 포함되어 있습니다.
- 헌터 배포 시 이 디렉토리를 반드시 제외하세요.

## 구조

```
reviews/
└── notebooklm/
    ├── 01_security_audit_report.md  — 보안 감사 보고서
    ├── 02_security_code.md          — 핵심 보안 코드
    └── 03_review_prompt.md          — NotebookLM 검증 프롬프트
```

## 사용법

1. NotebookLM (notebooklm.google.com) 접속
2. 새 노트북 생성
3. `01_security_audit_report.md`, `02_security_code.md`를 소스로 업로드
4. `03_review_prompt.md`에 있는 프롬프트를 채팅창에 붙여넣기
