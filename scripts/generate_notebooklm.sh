#!/usr/bin/env bash
# generate_notebooklm.sh — Generic NotebookLM review file generator
# Works for any project. Scans the current project directory.
# Usage: bash scripts/generate_notebooklm.sh [project_root]

set -euo pipefail

PROJECT_ROOT="${1:-$(pwd)}"
OUTPUT_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/FAS-reviews/notebooklm"
MASK_FILE="$PROJECT_ROOT/.notebooklm-mask"

GREEN='\033[0;32m'
NC='\033[0m'
log() { echo -e "${GREEN}[NLM]${NC} $1"; }

# ── 1. Archive previous results ──────────────────────────────────────
archive_previous() {
  if compgen -G "$OUTPUT_DIR"/*.md > /dev/null 2>&1; then
    local ts
    ts=$(date +%Y-%m-%d_%H%M%S)
    local archive="$OUTPUT_DIR/archive/$ts"
    mkdir -p "$archive"
    mv "$OUTPUT_DIR"/*.md "$archive/"
    log "Archived → archive/$ts"
  fi
}

# ── 2. Build sed masking script ──────────────────────────────────────
build_sed_script() {
  local tmpfile
  tmpfile=$(mktemp)

  # Strip code fences
  cat >> "$tmpfile" << 'RULES'
/^```/d
/^````/d
/^`````/d
RULES

  # Mask /Users/<real-user>/
  echo "s|/Users/$(whoami)/|/Users/[MASKED_USER]/|g" >> "$tmpfile"

  # Mask private/Tailscale IPs
  cat >> "$tmpfile" << 'RULES'
s|10\.[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|172\.1[6-9]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|172\.2[0-9]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|172\.3[01]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|192\.168\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|100\.6[4-9]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|100\.[7-9][0-9]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|100\.1[01][0-9]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
s|100\.12[0-7]\.[0-9][0-9]*\.[0-9][0-9]*|[MASKED_IP]|g
RULES

  # Mask token patterns
  cat >> "$tmpfile" << 'RULES'
s|xox[bpas]-[A-Za-z0-9_/\-]*|[MASKED_TOKEN]|g
s|Bearer [A-Za-z0-9._\-][A-Za-z0-9._\-]*|Bearer [MASKED_TOKEN]|g
RULES

  # GitHub username in URLs
  cat >> "$tmpfile" << 'RULES'
s|github\.com/[A-Za-z0-9_\-][A-Za-z0-9_\-]*/|github.com/[MASKED_USER]/|g
RULES

  # Custom masks from .notebooklm-mask (format: pattern|replacement per line)
  if [[ -f "$MASK_FILE" ]]; then
    while IFS='|' read -r pattern replacement; do
      [[ -z "$pattern" ]] && continue
      [[ "$pattern" =~ ^[[:space:]]*# ]] && continue
      pattern=$(echo "$pattern" | xargs)
      replacement=$(echo "$replacement" | xargs)
      echo "s|${pattern}|${replacement}|g" >> "$tmpfile"
    done < "$MASK_FILE"
  fi

  echo "$tmpfile"
}

# ── 3. Emit a single file ────────────────────────────────────────────
emit_file() {
  local base="$1"
  local filepath="$2"
  local sed_file="$3"

  local rel="${filepath#"$base"/}"

  echo ""
  echo "## 파일: ${rel}"
  echo ""

  if [[ "$(basename "$filepath")" == .env ]] || [[ "$(basename "$filepath")" == .env.local ]]; then
    sed -E 's/^([A-Za-z_]+)=.+$/\1=[MASKED_VALUE]/' "$filepath" | sed -f "$sed_file"
  else
    sed -f "$sed_file" "$filepath"
  fi

  echo ""
  echo "---"
}

# ── 4. Main ──────────────────────────────────────────────────────────
main() {
  log "Scanning $PROJECT_ROOT ..."

  [[ -d "$PROJECT_ROOT" ]] || { echo "ERROR: $PROJECT_ROOT not found"; exit 1; }

  mkdir -p "$OUTPUT_DIR"
  archive_previous

  SED_FILE_TMP=$(build_sed_script)
  trap 'rm -f "$SED_FILE_TMP"' EXIT
  local sed_file="$SED_FILE_TMP"

  log "Masking rules: $(wc -l < "$sed_file") patterns"

  # ── Docs & config (non-src, non-scripts) ──
  local docs=()
  while IFS= read -r -d '' f; do
    docs+=("$f")
  done < <(find "$PROJECT_ROOT" -type f \
    \( -name '*.md' -o -name '*.yml' -o -name '*.yaml' -o -name '*.json' \
       -o -name '*.conf' -o -name '*.plist' -o -name '*.example' \
       -o -name '.gitignore' -o -name 'tsconfig.json' \
       -o -name 'vitest.config.ts' -o -name 'pnpm-workspace.yaml' \
       -o -name 'docker-compose.yml' -o -name 'Dockerfile' \) \
    -not -path '*/node_modules/*' -not -path '*/.git/*' \
    -not -path '*/reviews/notebooklm/archive/*' \
    -not -path '*/dist/*' -not -path '*/logs/*' -not -path '*/state/*' \
    -not -path '*/src/*' -not -path '*/scripts/*' \
    -not -path '*/.claude/*' \
    -not -name 'pnpm-lock.yaml' -not -name 'package-lock.json' \
    -not -name '.DS_Store' \
    -print0 2>/dev/null | sort -z)

  log "  Docs & config: ${#docs[@]} files"

  # ── Source code (src/**/*.ts|*.js|*.py, excluding tests) ──
  local src=()
  if [[ -d "$PROJECT_ROOT/src" ]]; then
    while IFS= read -r -d '' f; do
      src+=("$f")
    done < <(find "$PROJECT_ROOT/src" -type f \
      \( -name '*.ts' -o -name '*.js' -o -name '*.py' -o -name '*.tsx' -o -name '*.jsx' \) \
      -not -name '*.test.*' -not -name '*.spec.*' \
      -print0 2>/dev/null | sort -z)
  fi

  log "  Source: ${#src[@]} files"

  # ── Tests & scripts ──
  local tests=()
  if [[ -d "$PROJECT_ROOT/src" ]]; then
    while IFS= read -r -d '' f; do
      tests+=("$f")
    done < <(find "$PROJECT_ROOT/src" -type f \
      \( -name '*.test.*' -o -name '*.spec.*' \) \
      -print0 2>/dev/null | sort -z)
  fi

  local scripts=()
  if [[ -d "$PROJECT_ROOT/scripts" ]]; then
    while IFS= read -r -d '' f; do
      scripts+=("$f")
    done < <(find "$PROJECT_ROOT/scripts" -type f \
      \( -name '*.sh' -o -name '*.ts' -o -name '*.js' -o -name '*.py' \) \
      -print0 2>/dev/null | sort -z)
  fi

  log "  Tests: ${#tests[@]}, Scripts: ${#scripts[@]}"

  # ── Write output ──

  log "Writing 01_docs_and_config.md..."
  {
    echo "# 문서 & 설정 — NotebookLM 교차 검증 소스"
    echo ""
    echo "> 생성일: $(date +%Y-%m-%d)"
    for f in "${docs[@]}"; do
      emit_file "$PROJECT_ROOT" "$f" "$sed_file"
    done
  } > "$OUTPUT_DIR/01_docs_and_config.md"

  log "Writing 02_source_code.md..."
  {
    echo "# 소스 코드 — NotebookLM 교차 검증 소스"
    echo ""
    echo "> 소스 코드 (테스트 제외). 생성일: $(date +%Y-%m-%d)"
    for f in "${src[@]}"; do
      emit_file "$PROJECT_ROOT" "$f" "$sed_file"
    done
  } > "$OUTPUT_DIR/02_source_code.md"

  log "Writing 03_tests_and_scripts.md..."
  {
    echo "# 테스트 & 스크립트 — NotebookLM 교차 검증 소스"
    echo ""
    echo "> 생성일: $(date +%Y-%m-%d)"
    for f in "${tests[@]}"; do
      emit_file "$PROJECT_ROOT" "$f" "$sed_file"
    done
    for f in "${scripts[@]}"; do
      emit_file "$PROJECT_ROOT" "$f" "$sed_file"
    done
  } > "$OUTPUT_DIR/03_tests_and_scripts.md"

  # ── Summary ──
  log "Done! Generated files:"
  for f in "$OUTPUT_DIR"/*.md; do
    log "  $(basename "$f") — $(wc -l < "$f") lines"
  done
  log ""
  log "Next: LLM will generate review_prompt.md"
}

main "$@"
