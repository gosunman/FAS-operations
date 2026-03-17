# 캐시플로우 & 사업화 파이프라인

## 개요

두 가지 파이프라인:
1. **캐시플로우 발굴**: AI가 자율적으로 소규모 수익 프로젝트를 발굴
2. **아이디어 → 사업화**: 주인님이 아이디어를 주면 AI가 분석 + 문서화 + 구현

## 파이프라인 1: 캐시플로우 프로젝트 발굴

### 발굴 기준

```yaml
cashflow_criteria:
  owner_involvement: minimal        # 주인님 개입 최소
  revenue_type: recurring            # 일회성보다 반복 수익
  implementation: ai_feasible        # AI가 거의 자율적으로 구현 가능
  tech_stack: [web, app, script, api]
  budget: low                        # 초기 투자 최소
  time_to_market: "< 2 weeks"        # 2주 이내 런칭 가능

  examples:
    - 마이크로 SaaS (자동 리포트, 데이터 변환 등)
    - API 서비스 (유료 API wrapping)
    - 디지털 상품 (템플릿, 도구)
    - 자동화 봇 (텔레그램 봇, 슬랙 봇)
    - 크롤링 기반 정보 서비스
    - SEO 콘텐츠 사이트
```

### 발굴 프로세스

```text
SLEEP 모드 (주기: 주 1회)

1. AI 트렌드 + 시장 분석으로 기회 탐색
   - Reddit, Indie Hackers, Product Hunt 분석
   - "사람들이 불편해하는 것" 패턴 감지
   - 기존 서비스의 빈틈 발견

2. 후보 아이디어 3~5개 도출

3. 각 아이디어에 대해 간이 분석:
   - 시장 크기 (TAM/SAM/SOM)
   - 경쟁 상황
   - 구현 난이도
   - 예상 월 수익
   - 주인님 개입 필요도

4. Notion 보고서 생성 → Slack #ideas 전송

5. 주인님 승인 → 파이프라인 2로 진행
```

## 파이프라인 2: 아이디어 → 사업화

### 트리거

주인님이 아이디어를 제시하면 자동으로 분석 시작.

```text
Telegram: /idea "외국인 대상 한국 관광 AI 가이드 앱"
또는
Slack #ideas에 아이디어 텍스트 입력
```

### 분석 단계

```text
Stage 1: 시장 분석 (Gemini A, SLEEP 모드)
├── 시장 규모 (TAM/SAM/SOM)
├── 성장률 & 트렌드
├── 타겟 고객 정의
└── 규제/법적 이슈

Stage 2: 경쟁자 분석 (Gemini A + Deep Research)
├── 기존 서비스 목록
├── 각 서비스의 강점/약점
├── 가격 모델 비교
├── 차별화 포인트 도출
└── NotebookLM으로 팩트 검증

Stage 3: 수익 분석 (Claude Code)
├── 수익 모델 설계 (구독, 광고, 거래 수수료 등)
├── BEP 계산
├── 3년 예상 매출/비용
├── 필요 초기 투자
└── ROI 분석

Stage 4: 마케팅 전략 (Gemini A)
├── 타겟 채널 (SNS, 커뮤니티, 광고)
├── 초기 고객 확보 전략
├── 브랜딩 방향
├── 성장 전략 (그로스 해킹)
└── 비용 계획

Stage 5: 기술 문서 (Claude Code)
├── 기능 명세서 (Feature Spec)
├── 화면 설계 (Wireframe 텍스트)
├── API 설계
├── DB 설계
├── 시스템 아키텍처
├── 기술 스택 추천
└── 개발 일정 (마일스톤)

→ 전체 산출물: Notion 프로젝트 페이지
→ 주인님 검토 → 승인 시 Stage 6
```

### Stage 6: 무중단 구현

```text
승인된 프로젝트를 AI가 거의 자율적으로 구현.

1. 프로젝트 초기화
   - Git 레포 생성
   - 기술 스택 세팅 (TS, Next.js 등)
   - CI/CD 파이프라인 구성
   - CLAUDE.md 작성 (프로젝트별 자율 실행 규칙)

2. 문서화 루틴 (구현 전 필수)
   - README.md: 프로젝트 소개
   - PLAN.md: 구현 계획 (마일스톤별)
   - SPEC.md: 기술 명세
   - API.md: API 문서
   - 주인님 승인 후 구현 시작

3. 구현 (Claude Code, SLEEP/AWAKE)
   - TDD: 테스트 먼저 → 구현
   - 마일스톤별 진행 → 각 마일스톤 완료 시 보고
   - 교차 검증: Gemini B가 코드 리뷰
   - git commit은 자동, push는 승인 후

4. 배포 (AWAKE, 인간 승인 필수)
   - Vercel 또는 자체 서버
   - 도메인 설정
   - 모니터링 구성

5. 운영 모니터링
   - 에러 감지 → 자동 수정 시도
   - 사용자 피드백 수집
   - 성능 모니터링
```

### 산출물 Notion 구조

```text
Ideas & Projects/
├── {프로젝트명}/
│   ├── 📊 시장 분석
│   ├── 🏢 경쟁자 분석
│   ├── 💰 수익 분석
│   ├── 📣 마케팅 전략
│   ├── 🔧 기술 문서
│   │   ├── Feature Spec
│   │   ├── API 설계
│   │   ├── DB 설계
│   │   └── 아키텍처
│   ├── 📋 개발 진행 상황
│   └── 📈 운영 대시보드
```

## 주인님의 기존 아이디어 목록

메모리에서 가져온 목록. 우선순위 결정 후 파이프라인 투입.

```yaml
ideas_backlog:
  saas:
    - "수동→자동 전환 SaaS"
    - "다중 플랫폼 예약 동기화"
  community:
    - "데이팅 앱 / 모임 운영"
    - "독서 모임 운영"
    - "GIST 동문 커뮤니티 앱"
    - "에이즈 환자 커뮤니티"
    - "우울증 환자 커뮤니티"
  edutech:
    - "과학 시뮬레이션 도구"
    - "학생 관리 프로그램"
  entertainment:
    - "중학교 대항 컨테스트 플랫폼"
    - "온라인 보드게임 사이트"
  global:
    - "외국인 대상 한국 관련 사업"
  knowledge:
    - "NVC 코칭 플랫폼"
    - "멘토링/강연 사업화"
```
