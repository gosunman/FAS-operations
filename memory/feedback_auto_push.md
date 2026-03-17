---
name: auto-push after commit
description: 커밋 후 자동으로 push까지 진행할 것 — 유저에게 물어보지 말고 바로 진행
type: feedback
---

커밋하면 그 다음 push도 알아서 할 것. 커밋 → 푸쉬를 한 흐름으로 처리.

**Why:** 유저가 커밋만 하고 푸쉬를 안 해서 직접 지시해야 했음. 불필요한 왕복.

**How to apply:** 코드 작성 → 테스트 통과 → 커밋 → push까지 한 번에. 단, 유저가 명시적으로 "push하지 마"라고 한 경우는 제외.
