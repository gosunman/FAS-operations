# Pipeline Module

데이터 수집/변환 파이프라인 모듈. 외부 소스에서 데이터를 가져와 가공/필터링.

## 파일

- `b2b_intent_pipeline.ts` — Crawl4AI 크롤링 → OpenClaw 인텐트 추출 → Clay.com 전송
- `ai_trend_parser.ts` — Hacker News / Reddit / arxiv AI 트렌드 수집 + 키워드 필터링 + 일일 리포트 생성

## AI Trend Parser

캡틴 사이드에서 직접 실행하는 AI 트렌드 리서치 파이프라인.

### 소스
- **Hacker News**: Firebase REST API (`/topstories.json` + `/item/{id}.json`)
- **Reddit**: JSON API (`/r/{subreddit}/hot.json`) — r/MachineLearning, r/LocalLLaMA
- **arxiv**: Atom API (`export.arxiv.org/api/query`)

### 키워드
영어: `edutech`, `nvc`, `automation`, `local llm`, `solopreneur`, `one-person startup`
한국어: `에듀테크`, `1인창업`, `자동화`, `로컬llm`

### 사용법

```typescript
import { run_ai_trend_research } from './ai_trend_parser.js';

// Default keywords
const result = await run_ai_trend_research();
console.log(result.report);
console.log(result.sources_status); // { hackernews: 'ok', reddit: 'ok', arxiv: 'ok' }

// Custom config
const result = await run_ai_trend_research({
  keywords: ['quantum', 'computing'],
  hn_fetch_limit: 50,
  reddit_subreddits: ['physics'],
});
```

### 설계 원칙
- Pure function library (HTTP fetch 외 부수 효과 없음)
- 개별 소스 실패 시 나머지 소스는 정상 동작 (graceful degradation)
- 스케줄링/알림 전송은 캡틴이 별도 연결
