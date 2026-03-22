# Academy Automation Module

EIDOS SCIENCE 학원 업무 자동화 모듈.

## Quick Start (CLI)

### 1. 학부모 문자 생성

```bash
pnpm run academy:text -- --name "예성" --grade "중2" --topics "힘과 운동,뉴턴 법칙" --performance "적극적 참여" --homework "교재 p.42~44"
```

Options:
- `--name` (required) Student name
- `--grade` (required) Grade (e.g. "고1", "중2")
- `--topics` (required) Comma-separated topics
- `--class-type` Class: regular | ogeum | medical (default: regular)
- `--performance` Comma-separated keywords
- `--homework` Homework description
- `--next-class` Next class note
- `--date` Date YYYY-MM-DD (default: today)
- `--tone` caring | professional | enthusiastic (default: caring)
- `--format` text | json (default: text)

### 2. 객관식 시험지 생성

```bash
pnpm run academy:test -- --subject physics --chapter "역학" --difficulty regular --questions 10
```

Options:
- `--subject` (required) physics | chemistry | biology | earth_science | integrated_science
- `--chapter` (required) Chapter name (e.g. "역학")
- `--difficulty` regular | ogeum | medical (default: regular)
- `--questions` Number, 1-50 (default: 20)
- `--time` Time limit in minutes (default: 40)
- `--no-explanations` Omit answer explanations
- `--format` text | json | pdf (default: text)
- `--output` Output directory for PDF (default: ./output/tests)

Available question banks: `physics:역학` (28 questions across 3 difficulty levels)

### 3. 학생 데이터 관리

```bash
# List all students
pnpm run academy:student -- list
pnpm run academy:student -- list --class-type "의대반" --active

# Add a student
pnpm run academy:student -- add --name "예성" --grade "중2" --class-type "일반반" --phone "010-1234-5678"

# Record a test score
pnpm run academy:student -- score --id "abc123" --test-name "3월 모의" --subject physics --score 85 --total 100

# Generate report (markdown)
pnpm run academy:student -- report --id "abc123"

# View progress summary
pnpm run academy:student -- progress --id "abc123"

# Class rankings
pnpm run academy:student -- ranking --class-type "의대반" --test-id "test-001"
```

## Modules

### parent_message.ts

Template-based parent SMS message generator. No external AI API calls.

- `generate_parent_message()` - Generate structured message from student context + class keywords
- `apply_tone_rules()` - Apply tone transformations (formal/caring/enthusiastic)
- `validate_message()` - Validate completeness, char count (200-500), inappropriate content filter

### test_generator.ts

Weekly test generator with 5-choice multiple-choice questions.

- `generate_test()` - Generate a test from subject/chapter/difficulty config
- `format_test_sheet()` / `format_answer_key()` - Text formatting
- `validate_test()` - Validate generated test integrity

### student_data.ts

Higher-level student management with auto-percentile, progress tracking, and markdown reports.

- `add_student()` / `get_student()` / `list_students()` / `update_student()` - CRUD
- `add_test_score()` - Record score with auto-percentile calculation
- `get_student_progress()` - Progress with trend analysis (improving/declining/stable)
- `generate_student_report()` - Markdown formatted report
- `get_class_rankings()` - Class rankings with tie handling

### student_store.ts

Lower-level student store with subject-specific trend analysis.

### pdf_generator.ts

PDFKit-based PDF generator for test sheets and answer keys. Korean font support (NotoSansKR/AppleGothic).

### google_messages.ts

Playwright-based Google Messages web automation for SMS sending. Persistent Chrome profile with session health checks.

### textbook_generator.ts

Textbook content generator for structured chapter content (concepts, examples, practice problems).

### CLI Tools

- `cli_parent_message.ts` - Parent message generator CLI
- `cli_test_generator.ts` - Test generator CLI
- `cli_student.ts` - Student data management CLI

## Data Storage

Student data is stored as JSON files in `state/academy/`:
- `student_data_students.json` - Student profiles
- `student_data_scores.json` - Test scores

## Class Types

| Code | Name |
|------|------|
| `regular` | 일반반 |
| `ogeum` | 오금고반 |
| `medical` | 의대반 |
