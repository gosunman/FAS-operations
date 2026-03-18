# scripts/security/

보안 점검 및 정리용 스크립트.

## scan_hunter_pii.sh

헌터 머신에서 주인님 개인정보가 잔존하는지 스캔하는 읽기 전용 스크립트.

```bash
# 헌터에서 직접 실행
bash scripts/security/scan_hunter_pii.sh

# 캡틴에서 SSH로 원격 실행
ssh hunter 'cd ~/FAS-operations && bash scripts/security/scan_hunter_pii.sh'
```

**스캔 항목**: Claude Code 인증, 브라우저 프로필, 셸 히스토리, .env, git config, SSH, iCloud, 파일 내용

**데이터 소스**: `.notebooklm-mask` (주인님 고유 패턴) + `src/gateway/sanitizer.ts` (일반 PII 패턴)

상세: [docs/security.md](../../docs/security.md)
