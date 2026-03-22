# MVP Selection Analysis — Revenue Scout 16 Projects

**작성일**: 2026-03-22
**분석 대상**: Hunter Revenue Scout가 발굴한 16개 프로젝트
**목적**: 다음 MVP 개발 후보 Top 3 선정

---

## 주인님 컨텍스트 요약

- **본업**: 네이버 개발자(평일) + EIDOS SCIENCE 과학학원 강사(주말)
- **가용 시간**: 극히 제한 (평일 13h 네이버, 주말 15.5h 학원)
- **기존 자산**: GrantCraft MVP 완성(미배포), EIDOS SCIENCE 플랫폼(Vercel 라이브), FAS 인프라(n8n, Hunter, Captain)
- **기술 스택**: TypeScript / Next.js / Vercel / Claude API
- **핵심 원칙**: 속도 최우선, 1인 개발, AI 활용 극대화
- **월 고정 수입**: 기본 800만 + 소마/한이음 추가
- **AI 구독료**: 월 ~90만원 (Claude Max x2 + ChatGPT Pro + Gemini Pro x2)

---

## 16개 프로젝트 전체 목록

### 명시적으로 확인된 프로젝트 (11개)

| # | 프로젝트명 | 카테고리 | 현재 상태 |
|---|-----------|----------|----------|
| 1 | Korean AI Proposal Generator for Agencies | micro_saas | **MVP 완료** (GrantCraft) |
| 2 | MoneyPrinterV2 Korean Adaptation | youtube_shorts_automation | deployed |
| 3 | Korean AI Website Funnel Auditor | micro_saas | discovered |
| 4 | Academy Enrollment Pipeline CRM Lite | micro_saas | discovered |
| 5 | GitHub Trending Korea Business Signal Digest | github_trending_service | discovered |
| 6 | Korean Naver SEO Content Workflow Engine | blog_seo_auto_content | discovered |
| 7 | Korean AI Contract Clause Explainer | micro_saas | discovered |
| 8 | Korean Community Trend Radar for Operators | info_brokerage | discovered |
| 9 | Korean AI Intake-to-Estimate Builder for Freelancers | micro_saas | discovered |
| 10 | Korean AI Study Sheet Generator for Teachers | micro_saas | discovered |
| 11 | Korean AI Public Tender Summary and Match Alerts | info_brokerage | discovered |

### 추정 프로젝트 (5개, "외 5개"로 언급)

야간 보고서에서 "외 5개"로 축약된 프로젝트들. Revenue Scout의 탐색 패턴(GitHub Trending, ProductHunt, IndieHackers, AI 트렌드)과 카테고리 분포를 기반으로 추정:

| # | 프로젝트명 (추정) | 카테고리 | 근거 |
|---|------------------|----------|------|
| 12 | Korean AI Blog Auto-Writer | blog_seo_auto_content | Scout의 7대 카테고리 중 미발견 카테고리 |
| 13 | Korean Print-on-Demand Niche Finder | print_on_demand | Scout의 7대 카테고리 중 미발견 카테고리 |
| 14 | Korean AI Resume/Cover Letter Optimizer | micro_saas | test fixture에 "AI Resume Optimizer SaaS" 등장 |
| 15 | Korean AI Short Video Generator | youtube_shorts_automation | test fixture에 "AI Short Video Generator" 등장 |
| 16 | Korean GitHub Trending Newsletter | github_trending_service | test fixture에 "GitHub Trending Newsletter" 등장 |

> 참고: #12~#16은 Hunter DB(SQLite)가 원격 머신에 있어 직접 조회 불가. 실제 프로젝트명은 다를 수 있음.

---

## 평가 기준 (각 1~10점)

| 기준 | 설명 | 가중치 |
|------|------|--------|
| 구현 난이도 (낮을수록 좋음) | 1~2일 MVP 가능성, 복잡한 통합 필요 여부 | x1.5 |
| 수익 잠재력 | 명확한 수익 경로, 한국 TAM | x1.5 |
| 시너지 | FAS/GrantCraft/Academy 기존 자산 활용도 | x1.2 |
| 시장 타이밍 | 현재 수요 긴급성, 계절성 | x1.0 |
| 경쟁 강도 (낮을수록 좋음) | 한국 시장 경쟁 수준 | x0.8 |

### 점수 산정 방식
- 구현 난이도: 10 = 하루 만에 완성 가능, 1 = 몇 주 필요
- 수익 잠재력: 10 = 월 300만+ 가능, 1 = 수익화 불투명
- 시너지: 10 = 기존 코드/인프라 90% 재활용, 1 = 완전 새 스택
- 시장 타이밍: 10 = 지금 당장 수요 폭발, 1 = 타이밍 무관
- 경쟁 강도: 10 = 한국 경쟁자 없음, 1 = 레드오션

---

## 스코어링 매트릭스

| # | 프로젝트 | 난이도 | 수익 | 시너지 | 타이밍 | 경쟁(역) | 가중합 | 순위 |
|---|---------|--------|------|--------|--------|---------|--------|------|
| 1 | AI Proposal Generator (GrantCraft) | 10 | 8 | 9 | 9 | 7 | **53.4** | - (완료) |
| 10 | **AI Study Sheet Generator for Teachers** | 9 | 7 | 10 | 8 | 8 | **50.5** | **1** |
| 4 | **Academy Enrollment Pipeline CRM Lite** | 8 | 7 | 10 | 7 | 7 | **47.2** | **2** |
| 11 | **AI Public Tender Summary and Match Alerts** | 7 | 8 | 8 | 9 | 7 | **47.0** | **3** |
| 7 | AI Contract Clause Explainer | 7 | 7 | 5 | 7 | 8 | **41.0** | 4 |
| 9 | AI Intake-to-Estimate Builder | 7 | 7 | 5 | 6 | 7 | **38.6** | 5 |
| 5 | GitHub Trending Business Signal Digest | 8 | 5 | 6 | 5 | 6 | **36.6** | 6 |
| 6 | Naver SEO Content Workflow Engine | 5 | 7 | 5 | 6 | 4 | **33.6** | 7 |
| 8 | Community Trend Radar for Operators | 6 | 6 | 4 | 6 | 7 | **34.8** | 8 |
| 3 | AI Website Funnel Auditor | 6 | 6 | 4 | 5 | 5 | **31.8** | 9 |
| 14 | AI Resume Optimizer (추정) | 7 | 6 | 3 | 5 | 3 | **30.4** | 10 |
| 2 | MoneyPrinterV2 Korean Adaptation | 4 | 5 | 3 | 5 | 5 | **27.2** | 11 |
| 16 | GitHub Trending Newsletter (추정) | 8 | 4 | 5 | 4 | 5 | **31.4** | 12 |
| 12 | AI Blog Auto-Writer (추정) | 6 | 5 | 3 | 5 | 3 | **27.2** | 13 |
| 15 | AI Short Video Generator (추정) | 3 | 6 | 2 | 5 | 4 | **24.8** | 14 |
| 13 | Print-on-Demand Niche Finder (추정) | 5 | 4 | 2 | 4 | 5 | **24.0** | 15 |

> 가중합 = 난이도x1.5 + 수익x1.5 + 시너지x1.2 + 타이밍x1.0 + 경쟁x0.8

---

## Top 3 상세 분석

---

### 1위: Korean AI Study Sheet Generator for Teachers (가중합 50.5)

#### 개요
교사가 단원/주제를 입력하면 AI가 학습지(문제+풀이+해설)를 자동 생성하는 SaaS. 한국 교육과정 기반, PDF/HTML 출력.

#### 높은 점수 이유

**구현 난이도 (9/10)**: 이미 FAS에 textbook_generator와 test_generator가 구현되어 있음. Claude API + PDF 생성 파이프라인이 검증 완료. Next.js + Vercel로 1일 내 MVP 가능.

**수익 잠재력 (7/10)**: 한국 사교육 시장 26조원. 학원 강사 약 30만명, 개인 과외 교사 수십만명. 월 9,900~29,900원 구독 모델. 한 교사가 주 5~10시간 자료 제작에 쓰는 시간을 30분으로 단축.

**시너지 (10/10)**:
- 본인이 과학 강사로서 도메인 전문가 (최고 점수)
- EIDOS SCIENCE 교재 제작 워크플로우 이미 존재 (textbook 스킬)
- test_generator.ts 코드 재활용 가능
- Claude API 연동 코드 GrantCraft에서 복사 가능
- 학원 동료 강사/학부모 네트워크로 즉각 피드백

**시장 타이밍 (8/10)**: 새 학기 시작 직후(3월). 1학기 중간고사 준비 시즌(4~5월). 교사들이 자료 제작에 가장 바쁜 시기.

**경쟁 강도 (8/10, 낮은 편)**: 족보닷컴/수박씨닷컴은 기출문제 DB 중심이지, AI 생성형 학습지는 아님. AI 기반 학습지 생성기는 한국에서 아직 초기 시장.

#### 기술 스택
- Next.js 16 + TypeScript + TailwindCSS 4
- Claude API (Haiku for bulk, Sonnet for quality)
- PDFKit 또는 Puppeteer (PDF 생성)
- Vercel (배포)
- 토스페이먼츠 (결제)

#### MVP 타임라인 (1일)
1. GrantCraft 코드베이스 fork (Claude API 연동, rate limiting, UI 구조)
2. 과목/단원 선택 UI
3. 프롬프트 엔지니어링 (한국 교육과정 기반 문제 생성)
4. PDF 다운로드 기능
5. 랜딩 페이지 + 가격 표시

#### 수익화 전략
- **무료**: 월 3회 생성, 워터마크 포함
- **Basic**: 월 9,900원, 월 30회 생성, 워터마크 없음
- **Pro**: 월 29,900원, 무제한 생성 + 과목별 커스텀 템플릿
- API 비용: Haiku 기준 1회 생성 ~50원 이하 → 마진 95%+

#### 첫 10명 사용자 확보 계획
1. 본인 학원(가디언)에서 직접 사용 + 동료 강사 3명 배포
2. 학원 강사 커뮤니티 (네이버 카페 "학원 강사 모여라", "과학교사 커뮤니티")
3. 인디스쿨 / 참쌤스쿨 교사 커뮤니티
4. 카카오톡 과외 교사 단톡방 (5~10개)
5. 실사용 후기 스크린샷 + 블로그 포스팅

---

### 2위: Academy Enrollment Pipeline CRM Lite (가중합 47.2)

#### 개요
소규모 학원(1~3인 운영)을 위한 초경량 CRM. 학생 관리, 학부모 소통 기록, 상담/등록 파이프라인, 결제 현황 추적.

#### 높은 점수 이유

**구현 난이도 (8/10)**: 이미 student_data.ts (CRUD, 성적 추적, 순위, 보고서)가 FAS에 구현되어 있음. Google Messages 자동화도 구현 완료. 이를 웹 UI로 감싸면 MVP 완성.

**수익 잠재력 (7/10)**: 한국 학원 약 7.5만개, 그중 소규모(10인 이하) 약 60%. 기존 학원 CRM(아이쌤, 클래스팅 등)은 대형 학원 대상. 소규모 학원장이 엑셀/수기로 관리하는 시장이 타겟. 월 19,900~49,900원.

**시너지 (10/10)**:
- 본인이 소규모 학원 강사 (도메인 전문가)
- student_data.ts, google_messages.ts 코드 직접 재활용
- 학부모 문자 자동 생성 기능 이미 구현
- 학원 업계 인맥으로 직접 피드백 가능

**시장 타이밍 (7/10)**: 새 학기 시작 후 학부모 상담 시즌. 여름방학 전 등록 캠페인 시기(5~6월).

**경쟁 강도 (7/10)**: 아이쌤, 클래스팅 등 기존 업체가 있지만, "소규모 학원 전용 + AI 학부모 문자 자동 생성"은 차별화 포인트.

#### 기술 스택
- Next.js 16 + TypeScript + TailwindCSS 4
- Supabase (DB + Auth)
- Vercel (배포)
- 토스페이먼츠 (결제)

#### MVP 타임라인 (2일)
1. Day 1: student_data.ts 로직을 웹 UI로 래핑, 학생 CRUD + 대시보드
2. Day 2: 학부모 문자 생성 AI (Claude API), 상담 파이프라인 (칸반 뷰)

#### 수익화 전략
- **무료**: 학생 5명까지, 기본 관리
- **Standard**: 월 19,900원, 학생 30명, AI 문자 생성
- **Premium**: 월 49,900원, 무제한 학생, 성적 분석 리포트, 학부모 앱

#### 첫 10명 사용자 확보 계획
1. 본인 학원(가디언)에서 직접 사용 (자체 독식 테스트)
2. 학원장 네이버 카페 ("학원 운영 노하우", "학원 창업 카페")
3. 주변 소규모 학원 직접 방문 (송파구/강남구)
4. "무료로 한 달 써보세요" 프로모션
5. 학원 운영 유튜버/블로거 리뷰 요청

---

### 3위: Korean AI Public Tender Summary and Match Alerts (가중합 47.0)

#### 개요
정부/공공기관 입찰 공고를 AI로 요약하고, 사용자 프로필(업종, 규모, 기술)에 맞는 공고를 자동 매칭하여 알림 발송.

#### 높은 점수 이유

**구현 난이도 (7/10)**: FAS에 이미 startup_grants.ts (K-Startup 크롤러 + 매칭), grant_notifier.ts (Notion 포맷 + 알림), grant_parsers.ts가 구현되어 있음. 나라장터 API가 공개되어 있어 데이터 수집 용이.

**수익 잠재력 (8/10)**: 한국 공공조달 시장 200조원+. 중소기업 약 400만개. 기존 서비스(비드프로, 인포빌)가 월 5~15만원 구독. AI 요약 + 매칭은 프리미엄 기능으로 차별화 가능.

**시너지 (8/10)**:
- GrantCraft(정부과제 사업계획서)와 완벽한 시너지 — 공고 발견 → 사업계획서 자동 생성 파이프라인
- grant_parsers.ts, grant_notifier.ts 코드 재활용
- n8n 워크플로우로 크롤링 자동화 이미 구축
- startup_grants.ts 매칭 알고리즘 활용

**시장 타이밍 (9/10)**: 2026 상반기 정부 창업지원사업 공고 러시. 예비창업패키지, 초기창업패키지, TIPS 등 3~4월 집중 공고. 공공조달은 연중 상시.

**경쟁 강도 (7/10)**: 비드프로, 인포빌이 기존 강자이나 AI 기반 요약/매칭은 미제공. "AI로 30초 만에 내 업종에 맞는 공고 찾기"는 강력한 차별점.

#### 기술 스택
- Next.js 16 + TypeScript + TailwindCSS 4
- Claude API (공고 요약 + 매칭)
- 나라장터 Open API + K-Startup 크롤링 (기존 코드)
- Supabase (사용자 프로필 + 알림 설정)
- Vercel (배포)
- 알리고/카카오 알림톡 (알림 발송)

#### MVP 타임라인 (2일)
1. Day 1: 기존 grant_parsers.ts 확장 → 나라장터 API 연동, AI 요약 파이프라인
2. Day 2: 사용자 프로필 입력 UI, 매칭 알고리즘, 이메일/카카오 알림

#### 수익화 전략
- **무료**: 주 3개 매칭 알림, 기본 요약
- **Pro**: 월 29,900원, 무제한 알림 + 상세 AI 분석 + 지원 가이드
- **Business**: 월 99,000원, 팀 공유 + GrantCraft 사업계획서 연동 + API 접근
- **크로스셀**: Pro 사용자에게 GrantCraft 번들 할인 (합산 월 49,900원)

#### 첫 10명 사용자 확보 계획
1. GrantCraft 사용자 풀에서 크로스셀 (이미 정부과제에 관심 있는 유저)
2. 스타트업 커뮤니티 (디캠프, 판교밸리, 스타트업 얼라이언스)
3. 소상공인진흥공단 / 중소벤처기업부 관련 네이버 카페
4. 창업지원사업 관련 유튜브 채널 ("정부지원금", "창업패키지") 댓글 마케팅
5. 소마/한이음 멘티 네트워크 배포

---

## 전략적 권장 사항

### 즉시 실행 (이번 주)
1. **GrantCraft Vercel 배포** (5분) — 이미 MVP 완성, 즉시 라이브
2. **AI Study Sheet Generator 개발 시작** (1일) — GrantCraft 코드베이스 fork

### 단기 (1~2주)
3. **Academy CRM Lite** — 본인 학원에서 먼저 사용, 피드백 수집

### 중기 (1~2개월)
4. **Public Tender Alerts** — GrantCraft와 번들로 "정부과제 올인원" 포지셔닝

### 포트폴리오 시너지 맵

```
[AI Study Sheet Generator] ← 교사/강사 유입
         ↓
[Academy CRM Lite] ← 학원 운영자 유입
         ↓
[GrantCraft] ← 창업자/중소기업 유입
         ↓
[Public Tender Alerts] ← 기존 유저 크로스셀
         ↓
[EIDOS SCIENCE Platform] ← 교육 브랜드 강화
```

이 5개 제품이 모두 **교육 + 정부과제** 도메인에서 시너지를 형성하며, 주인님의 핵심 역량(과학 교육 + 풀스택 개발 + 정부과제 경험)과 정확히 일치합니다.

---

## 결론

**1순위 추천: Korean AI Study Sheet Generator for Teachers**

이유:
- 주인님이 직접 사용할 수 있는 제품 (Dog-fooding)
- 기존 코드 재활용 극대화 (textbook_generator, test_generator, Claude API)
- 1일 내 MVP 완성 가능
- 새 학기 시작 + 중간고사 시즌이라는 완벽한 타이밍
- GrantCraft에 이어 "교육 AI 도구" 브랜드 구축의 두 번째 제품

**MoneyPrinterV2는 권장하지 않음**: deployed 상태이지만, YouTube 수익화에는 구독자 1000명 + 시청시간 4000시간이 필요하여 즉각적 수익이 불가능. 콘텐츠 품질 관리 부담도 큼.

---

*이 분석은 Revenue Scout DB, 야간 세션 보고서, FAS 코드베이스, 메모리 프로필을 종합하여 작성되었습니다.*
