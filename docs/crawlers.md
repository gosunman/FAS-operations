# 크롤러 상세 명세

## 실행 방식

크롤러는 두 가지 방식으로 실행된다:

1. **코드 크롤러** (캡틴): Node.js + Puppeteer/Playwright로 직접 크롤링. 안정적인 사이트에 사용.
2. **AI 크롤러** (캡틴): Gemini CLI에게 "검색해서 정리해"라고 시키는 방식. 구조화 어려운 사이트에 사용.
3. **OpenClaw 크롤러** (헌터): 새 사이트 초기 크롤링 코드 작성용. 안정화되면 캡틴으로 이관.

```text
새 사이트 크롤링 프로세스:

1. 헌터(OpenClaw)가 사이트 구조 파악 + 크롤링 코드 작성
2. 헌터에서 테스트 실행
3. 안정적이면 → 코드를 캡틴으로 이관 (Task API 경유)
4. 캡틴에서 코드 크롤러로 정기 실행
5. 사이트 구조 변경 감지 시 → 헌터에게 재작성 요청
```

## 크롤러별 상세

### 1. 창업지원사업 (정부)

```yaml
# config/crawlers.yml 의 startup_gov 섹션

startup_gov:
  schedule: every_3_days
  method: code    # code | ai | openclaw
  targets:
    - name: K-Startup
      url: https://www.k-startup.go.kr/
      pages:
        - path: /homepage/businessManage/g498.do  # 사업공고 목록
          selector: ".board_list table tbody tr"
          fields:
            title: "td:nth-child(2) a"
            category: "td:nth-child(1)"
            period: "td:nth-child(4)"
            status: "td:nth-child(5)"

    - name: 창업진흥원
      url: https://www.kised.or.kr/
      method: ai   # 구조가 자주 바뀌어서 AI 방식
      prompt: |
        창업진흥원(kised.or.kr)에서 현재 접수 중이거나 예정인
        창업지원사업 목록을 찾아서 다음 형식으로 정리해줘:
        - 사업명, 지원 대상, 지원 금액, 접수 기간, URL

    - name: 중소벤처기업부
      url: https://www.mss.go.kr/
      method: ai
      prompt: |
        중소벤처기업부(mss.go.kr)에서 창업 관련 공고를 찾아줘.

    - name: 서울산업진흥원 (SBA)
      url: https://www.sba.seoul.kr/
      method: ai

  # 자격 매칭 기준 (개인정보 — 캡틴에서만 처리)
  matching:
    age: 34
    location: 서울
    startup_stage: 예비창업
    has_team: false
    preferred_fields: [에듀테크, AI, 소셜벤처]
```

### 2. 창업지원사업 (민간)

```yaml
startup_private:
  schedule: every_3_days
  method: ai    # 민간은 구조가 다양해서 AI 방식
  targets:
    - name: Google for Startups
      url: https://startup.google.com/
      prompt: |
        Google for Startups에서 한국/아시아 대상 프로그램 중
        현재 접수 가능하거나 예정인 것을 찾아줘.

    - name: D.CAMP
      url: https://dcamp.kr/
      prompt: |
        D.CAMP에서 현재 접수 중인 프로그램, 데모데이, 지원사업을 찾아줘.

    - name: 기타 민간
      method: ai
      prompt: |
        한국에서 운영 중인 규모 있는 민간 스타트업 지원 프로그램을 조사해줘.
        (TIPS, 마루180, 스파크랩, 프라이머 등)
        현재 접수 중이거나 곧 시작하는 것 위주로.
```

### 3. 로또 청약

```yaml
housing:
  schedule: every_3_days
  method: code
  targets:
    - name: 청약홈
      url: https://www.applyhome.co.kr/
      pages:
        - path: /ai/aia/selectAPTLttotPblancListView.do  # APT 분양
          type: apt_sale
        - path: /ai/aia/selectAPTLttotPblancListView.do  # APT 무순위/잔여
          type: apt_leftover

  analysis:
    # 각 공고에 대해 AI가 분석
    prompt_template: |
      다음 청약 공고를 분석해줘:
      {공고_내용}

      분석 항목:
      1. 위치 및 강남까지 대중교통 시간
      2. 분양가 대비 시세 (수익성)
      3. 경쟁률 예상
      4. 거주의무 기간
      5. 자격 충족 여부 (무주택, 소득 기준 등)
      6. 추천 여부 및 사유

  matching:
    homeless: true
    income_annual: 90000000  # 원천 기준
    preferred_area_min: 50   # 전용 m²
    location_condition: "강남 1시간 이내 or 수익 확실"
```

### 4. 블라인드 인기글

```yaml
blind:
  schedule: daily
  method: ai    # 블라인드 API 없으므로 AI 웹 검색
  target:
    channel: 네이버
    prompt: |
      블라인드 네이버 채널에서 오늘/어제 올라온 인기글을 찾아줘.
      인기글 기준:
      - 댓글 50개 이상 OR 좋아요 100개 이상
      - 또는 키워드: 치정, 불륜, 자살, 괴롭힘, 갑질, 해고, 구조조정,
        연봉, 성과급, 폭로, 내부고발, 임원, 대표
      - 또는 사람들의 흥미를 강하게 끌 만한 자극적/논쟁적 내용

      각 글에 대해:
      - 제목
      - 핵심 요약 (3줄)
      - 댓글 수 / 좋아요 수
      - 원문 링크 (가능하면)

  notification:
    channel: slack
    slack_channel: "#crawl-results"
```

### 5. AI 트렌드 리서치

```yaml
ai_trends:
  schedule: daily
  method: ai
  targets:
    - source: Hacker News
      url: https://news.ycombinator.com/
      prompt: "오늘 HN 프론트페이지에서 AI 관련 주요 글 정리"

    - source: Reddit
      subreddits: [MachineLearning, LocalLLaMA]
      prompt: "오늘 인기글 중 중요한 것 정리"

    - source: arxiv
      categories: [cs.AI, cs.CL, cs.LG]
      prompt: "최근 2일 내 주목할 논문 3~5개 선별 + 요약"

  keyword_filter:
    - 에듀테크
    - NVC
    - 1인창업
    - 자동화
    - 로컬LLM
    - agent
    - Claude
    - Gemini

  output:
    format: notion_page
    slack_channel: "#reports"
```

### 6. 글로벌 빅테크 채용

```yaml
job_openings:
  schedule: every_3_days
  method: ai
  targets:
    tier_1: [Google, Apple, Meta, Amazon, Microsoft, Netflix]
    tier_2: [Stripe, Airbnb, Uber, Databricks, OpenAI, Anthropic, SpaceX, Tesla, Bloomberg]

  search_prompt: |
    다음 회사들의 채용 페이지에서 포지션을 찾아줘:
    {company_list}

    찾을 포지션:
    - fullstack, typescript, frontend, react, next.js, node.js
    - startup 관련 부서
    - international/global operations
    - business development (tech 배경)

    지역: Korea, Remote, 또는 해외 아무 곳

    각 포지션에 대해:
    - 회사명, 포지션명, 지역, 링크
    - 매칭도 (주인님 스펙: TS 풀스택 6년, 물리 석사, 영어 가능)

  matching:
    experience_years: 6
    stack: [TypeScript, Next.js, NestJS, GraphQL, MongoDB]
    education: GIST 물리 석사
    languages: [Korean (native), English (professional)]
    priority: brand_value  # 연봉보다 이름빨
```

### 7. 대학원 / 원격 학위

```yaml
grad_school:
  schedule: weekly
  method: ai

  active_tracking:
    - name: Georgia Tech OMSCS
      url: https://omscs.gatech.edu/
      check: 지원 일정, 마감일, 준비물, 변경사항

    - name: 서울대 GSEP
      url: https://gsep.snu.ac.kr/
      check: 지원 일정, 마감일, 준비물, 변경사항

  research_targets:
    prompt: |
      원격(온라인)으로 수강 가능한 석사 또는 학사 편입 과정 조사:
      - 글로벌 또는 국내 인지도 높은 학교
      - CS, 공학, 경영, 교육학 분야
      - 직장인 병행 가능
      - 조지아텍 OMSCS처럼 원격 완전 이수 가능한 프로그램

  alerts:
    d_30: slack
    d_14: telegram
    d_7: telegram
    d_3: telegram_urgent
```

## 크롤링 결과 저장 포맷

```typescript
// reports/crawl_results/{source}/{date}.json

interface crawl_result {
  source: string
  crawled_at: string
  agent: string
  items: crawl_item[]
  summary: string
}

interface crawl_item {
  title: string
  url?: string
  category?: string
  deadline?: string
  relevance_score?: number    // 0~1, AI가 판단한 관련도
  matched?: boolean           // 주인님 조건에 매칭되는지
  details: Record<string, unknown>
}
```

## Rate Limiting

```yaml
# 사이트별 요청 제한 (IP 차단 방지)

rate_limits:
  default:
    requests_per_minute: 10
    delay_between_requests_ms: 3000

  k-startup.go.kr:
    requests_per_minute: 5
    delay_between_requests_ms: 5000

  applyhome.co.kr:
    requests_per_minute: 3
    delay_between_requests_ms: 10000
    # 청약홈은 봇 감지가 엄격함

  # AI 방식 크롤러는 rate limit 불필요 (검색 엔진 경유)
```
