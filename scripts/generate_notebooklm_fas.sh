#!/usr/bin/env bash
# generate_notebooklm_fas.sh — FAS NotebookLM review file generator
# Generates masked review files for both Doctrine + Operations layers
# Usage: bash scripts/generate_notebooklm_fas.sh

set -euo pipefail

OPS_ROOT="${OPS_ROOT:-$HOME/FAS-operations}"
DOCTRINE_ROOT="$HOME/Library/Mobile Documents/com~apple~CloudDocs/claude-config"
OUTPUT_DIR="$OPS_ROOT/reviews/notebooklm"
MASK_FILE="$OPS_ROOT/.notebooklm-mask"

GREEN='\033[0;32m'
NC='\033[0m'
log() { echo -e "${GREEN}[FAS-NLM]${NC} $1"; }

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

  # Strip code fences (NotebookLM ignores fenced content)
  cat >> "$tmpfile" << 'RULES'
/^```/d
/^````/d
/^`````/d
RULES

  # Mask /Users/<real-user>/
  echo "s|/Users/$(whoami)/|/Users/[MASKED_USER]/|g" >> "$tmpfile"

  # Mask private/Tailscale IPs (BSD sed compatible, no \b)
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

# ── 3. Emit a single file with header + masked content ───────────────
emit_file() {
  local prefix="$1"    # [DOCTRINE] or [OPS]
  local base="$2"      # base dir for relative path
  local filepath="$3"  # absolute path
  local sed_file="$4"

  local rel="${filepath#"$base"/}"

  echo ""
  echo "## 파일: ${prefix} ${rel}"
  echo ""

  # .env files: mask values after = (except empty values and comments)
  if [[ "$(basename "$filepath")" == .env ]] || [[ "$(basename "$filepath")" == .env.local ]]; then
    sed -E 's/^([A-Za-z_]+)=.+$/\1=[MASKED_VALUE]/' "$filepath" | sed -f "$sed_file"
  else
    sed -f "$sed_file" "$filepath"
  fi

  echo ""
  echo "---"
}

# ── 4. Collect and categorize files ──────────────────────────────────
main() {
  log "Starting FAS NotebookLM generation..."

  [[ -d "$OPS_ROOT" ]] || { echo "ERROR: $OPS_ROOT not found"; exit 1; }
  [[ -d "$DOCTRINE_ROOT" ]] || { echo "ERROR: Doctrine not found"; exit 1; }

  mkdir -p "$OUTPUT_DIR"
  archive_previous

  SED_FILE_TMP=$(build_sed_script)
  trap 'rm -f "$SED_FILE_TMP"' EXIT
  local sed_file="$SED_FILE_TMP"

  local mask_count
  mask_count=$(wc -l < "$sed_file")
  log "Masking rules: ${mask_count} patterns"

  # ── Doctrine files ──
  log "Scanning Doctrine..."
  local doctrine_files=()
  while IFS= read -r -d '' f; do
    doctrine_files+=("$f")
  done < <(find "$DOCTRINE_ROOT" -type f \
    \( -name '*.md' -o -name '*.json' -o -name '*.yml' \) \
    -not -name '.DS_Store' \
    -not -path '*/.git/*' \
    -not -path '*/archive/*' \
    -not -name '*conflict*' \
    -not -name '*(1)*' \
    -print0 2>/dev/null | sort -z)

  log "  Doctrine: ${#doctrine_files[@]} files"

  # ── Operations docs & config (everything except src/ and scripts/) ──
  log "Scanning Operations..."
  local ops_docs=()
  while IFS= read -r -d '' f; do
    ops_docs+=("$f")
  done < <(find "$OPS_ROOT" -type f \
    \( -name '*.md' -o -name '*.yml' -o -name '*.yaml' -o -name '*.json' \
       -o -name '*.conf' -o -name '*.plist' -o -name '*.example' \
       -o -name '*.gitignore' -o -name 'docker-compose.yml' \
       -o -name 'tsconfig.json' -o -name 'vitest.config.ts' \
       -o -name 'pnpm-workspace.yaml' \) \
    -not -path '*/node_modules/*' \
    -not -path '*/.git/*' \
    -not -path '*/reviews/notebooklm/archive/*' \
    -not -path '*/dist/*' -not -path '*/logs/*' -not -path '*/state/*' \
    -not -path '*/src/*' -not -path '*/scripts/*' \
    -not -path '*/.claude/*' \
    -not -name 'pnpm-lock.yaml' -not -name '.DS_Store' \
    -print0 2>/dev/null | sort -z)

  log "  Docs & config: ${#ops_docs[@]} files"

  # ── Operations source code (src/**/*.ts, excluding tests) ──
  local ops_src=()
  while IFS= read -r -d '' f; do
    ops_src+=("$f")
  done < <(find "$OPS_ROOT/src" -type f -name '*.ts' -not -name '*.test.ts' \
    -print0 2>/dev/null | sort -z)

  log "  Source code: ${#ops_src[@]} files"

  # ── Operations tests & scripts ──
  local ops_tests=()
  while IFS= read -r -d '' f; do
    ops_tests+=("$f")
  done < <(find "$OPS_ROOT/src" -type f -name '*.test.ts' \
    -print0 2>/dev/null | sort -z)

  local ops_scripts=()
  while IFS= read -r -d '' f; do
    ops_scripts+=("$f")
  done < <(find "$OPS_ROOT/scripts" -type f \
    \( -name '*.sh' -o -name '*.ts' -o -name '*.plist' \) \
    -print0 2>/dev/null | sort -z)

  log "  Tests: ${#ops_tests[@]}, Scripts: ${#ops_scripts[@]}"

  # ── Generate output files ──

  log "Writing 01_doctrine.md..."
  {
    echo "# FAS Doctrine Layer — NotebookLM 교차 검증 소스"
    echo ""
    echo "> Doctrine은 FAS 클러스터의 정신, 원칙, 정체성, 보안 설계를 담당하는 Source of Truth."
    echo "> 생성일: $(date +%Y-%m-%d)"
    for f in "${doctrine_files[@]}"; do
      emit_file "[DOCTRINE]" "$DOCTRINE_ROOT" "$f" "$sed_file"
    done
  } > "$OUTPUT_DIR/01_doctrine.md"

  log "Writing 02_docs_and_config.md..."
  {
    echo "# FAS Operations — 문서 & 설정 — NotebookLM 교차 검증 소스"
    echo ""
    echo "> Operations는 Doctrine(원칙/정체성)을 코드로 실현하는 계층."
    echo "> 생성일: $(date +%Y-%m-%d)"
    for f in "${ops_docs[@]}"; do
      emit_file "[OPS]" "$OPS_ROOT" "$f" "$sed_file"
    done
  } > "$OUTPUT_DIR/02_docs_and_config.md"

  log "Writing 03_source_code.md..."
  {
    echo "# FAS Operations — 소스 코드 — NotebookLM 교차 검증 소스"
    echo ""
    echo "> 소스 코드 (테스트 제외). 생성일: $(date +%Y-%m-%d)"
    for f in "${ops_src[@]}"; do
      emit_file "[OPS]" "$OPS_ROOT" "$f" "$sed_file"
    done
  } > "$OUTPUT_DIR/03_source_code.md"

  log "Writing 04_tests_and_scripts.md..."
  {
    echo "# FAS Operations — 테스트 & 스크립트 — NotebookLM 교차 검증 소스"
    echo ""
    echo "> 테스트 코드와 운영 스크립트. 생성일: $(date +%Y-%m-%d)"
    for f in "${ops_tests[@]}"; do
      emit_file "[OPS]" "$OPS_ROOT" "$f" "$sed_file"
    done
    for f in "${ops_scripts[@]}"; do
      emit_file "[OPS]" "$OPS_ROOT" "$f" "$sed_file"
    done
  } > "$OUTPUT_DIR/04_tests_and_scripts.md"

  # ── Summary ──
  log "Done! Generated files:"
  for f in "$OUTPUT_DIR"/*.md; do
    local lines
    lines=$(wc -l < "$f")
    local name
    name=$(basename "$f")
    log "  $name — ${lines} lines"
  done

  log ""
  log "Next: review_prompt.md will be generated by the LLM."
  log "Then upload all 5 files to NotebookLM."
}

main "$@"
