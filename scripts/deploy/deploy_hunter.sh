#!/usr/bin/env bash
# Deploy hunter-only files to hunter machine via SSH
# Respects Doctrine source code isolation: NEVER send captain code, docs, or config
#
# Usage:
#   bash scripts/deploy/deploy_hunter.sh [hunter-ssh-host]
#   bash scripts/deploy/deploy_hunter.sh hunter        # default: "hunter"

set -euo pipefail

HUNTER_HOST="${1:-hunter}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_DIR="/Users/user/fas-hunter-agent"
TEMP_DIR=$(mktemp -d)
BUNDLE="$TEMP_DIR/hunter-bundle"

echo "=== FAS Hunter Deployment ==="
echo "Source: $PROJECT_ROOT"
echo "Target: $HUNTER_HOST:$DEPLOY_DIR"
echo ""

# === Step 1: Assemble hunter-only files ===
echo "[1/4] Assembling hunter bundle (source code isolation)..."

mkdir -p "$BUNDLE/src/hunter"
mkdir -p "$BUNDLE/src/shared"

# Hunter source code — the only src/ we send
cp "$PROJECT_ROOT/src/hunter/"*.ts "$BUNDLE/src/hunter/"

# Shared types — needed for compilation
cp "$PROJECT_ROOT/src/shared/types.ts" "$BUNDLE/src/shared/"

# Build config
cp "$PROJECT_ROOT/package.json" "$BUNDLE/"
cp "$PROJECT_ROOT/tsconfig.json" "$BUNDLE/"
cp "$PROJECT_ROOT/pnpm-lock.yaml" "$BUNDLE/" 2>/dev/null || true

# Hunter .env template (NOT captain .env!)
cat > "$BUNDLE/.env.example" << 'ENV'
# === Hunter Agent Configuration ===
# Captain Task API (Tailscale IP)
CAPTAIN_API_URL=http://100.64.0.1:3100

# Hunter API key — must match captain's HUNTER_API_KEY
HUNTER_API_KEY=

# Google Chrome profile for session reuse
GOOGLE_PROFILE_DIR=./fas-google-profile-hunter

# Timeouts
DEEP_RESEARCH_TIMEOUT_MS=300000
NOTEBOOKLM_TIMEOUT_MS=180000

# Logging
HUNTER_LOG_DIR=./logs
HUNTER_POLL_INTERVAL=10000

# Browser
HUNTER_HEADLESS=true

# === Autonomous Mode (Revenue Projects) ===
# SQLite project pipeline database
HUNTER_DB_PATH=./data/hunter_projects.db
# Reports directory
HUNTER_REPORTS_DIR=./reports
# Revenue scout cycle interval (6 hours = 21600000ms)
HUNTER_SCOUT_INTERVAL_MS=21600000
# Captain health check interval (30 seconds)
CAPTAIN_HEALTH_CHECK_INTERVAL_MS=30000
# Consecutive failures before autonomous switch
CAPTAIN_FAILURE_THRESHOLD=3

# === Notification (Optional — hunter works without these) ===
# Hunter's own Telegram bot token (separate from captain)
HUNTER_TELEGRAM_BOT_TOKEN=
# Owner's Telegram chat ID
HUNTER_TELEGRAM_CHAT_ID=
# Hunter's own Slack incoming webhook URL
HUNTER_SLACK_WEBHOOK_URL=
ENV

# Hunter-specific package.json (strip captain-only scripts)
python3 -c "
import json
with open('$BUNDLE/package.json') as f:
    pkg = json.load(f)
# Keep only hunter-relevant scripts
scripts = pkg.get('scripts', {})
hunter_scripts = {k: v for k, v in scripts.items() if 'hunter' in k.lower() or k in ['build', 'typecheck']}
hunter_scripts['start'] = 'npx tsx src/hunter/main.ts'
pkg['scripts'] = hunter_scripts
# Remove devDependencies that are captain-only (keep test/build tools)
with open('$BUNDLE/package.json', 'w') as f:
    json.dump(pkg, f, indent=2)
"

# Hunter operational scripts
mkdir -p "$BUNDLE/scripts/setup"
mkdir -p "$BUNDLE/scripts/deploy"
mkdir -p "$BUNDLE/scripts/security"

cp "$PROJECT_ROOT/scripts/setup/setup_hunter.sh" "$BUNDLE/scripts/setup/" 2>/dev/null || true
cp "$PROJECT_ROOT/scripts/deploy/verify_hunter.sh" "$BUNDLE/scripts/deploy/" 2>/dev/null || true
cp "$PROJECT_ROOT/scripts/security/scan_hunter_pii.sh" "$BUNDLE/scripts/security/" 2>/dev/null || true
cp "$PROJECT_ROOT/scripts/hunter_watchdog.sh" "$BUNDLE/scripts/" 2>/dev/null || true

# Hunter docs (non-sensitive)
mkdir -p "$BUNDLE/hunter"
cp "$PROJECT_ROOT/hunter/"*.md "$BUNDLE/hunter/" 2>/dev/null || true

# NOTE: .notebooklm-mask contains PII patterns — do NOT send to hunter
# PII scanning runs on captain side only (scan_hunter_pii.sh uses SSH)

# Count what we're sending
FILE_COUNT=$(find "$BUNDLE" -type f | wc -l | tr -d ' ')
echo "  ✓ Bundle: $FILE_COUNT files (hunter code + shared types + build config only)"
echo ""

# === Step 2: Verify no PII leak ===
echo "[2/4] Verifying no PII in bundle..."

# Load mask patterns if available
LEAK_FOUND=0
if [ -f "$PROJECT_ROOT/.notebooklm-mask" ]; then
  while IFS='|' read -r pattern _; do
    [[ "$pattern" =~ ^#.*$ ]] && continue
    [[ -z "$pattern" ]] && continue
    if grep -rl "$pattern" "$BUNDLE" 2>/dev/null | head -1 > /dev/null 2>&1; then
      matches=$(grep -rl "$pattern" "$BUNDLE" 2>/dev/null)
      if [ -n "$matches" ]; then
        echo "  ⚠️  PII LEAK: pattern '$pattern' found in bundle!"
        echo "$matches" | while read -r f; do echo "    → $f"; done
        LEAK_FOUND=1
      fi
    fi
  done < "$PROJECT_ROOT/.notebooklm-mask"
fi

if [ "$LEAK_FOUND" -eq 1 ]; then
  echo "  ✗ PII detected in bundle — ABORTING deployment"
  rm -rf "$TEMP_DIR"
  exit 1
fi
echo "  ✓ No PII found in bundle"
echo ""

# === Step 3: Transfer to hunter ===
echo "[3/4] Transferring to $HUNTER_HOST:$DEPLOY_DIR ..."

# Create tarball
TARBALL="$TEMP_DIR/hunter-bundle.tar.gz"
tar -czf "$TARBALL" -C "$TEMP_DIR" hunter-bundle

# Create target directory and transfer
ssh "$HUNTER_HOST" "mkdir -p $DEPLOY_DIR"
scp -q "$TARBALL" "$HUNTER_HOST:/tmp/hunter-bundle.tar.gz"
ssh "$HUNTER_HOST" "cd $DEPLOY_DIR && tar -xzf /tmp/hunter-bundle.tar.gz --strip-components=1 && rm /tmp/hunter-bundle.tar.gz"

echo "  ✓ Transferred to $HUNTER_HOST:$DEPLOY_DIR"
echo ""

# === Step 4: Verify on hunter ===
echo "[4/4] Verifying deployment..."

ssh "$HUNTER_HOST" "cd $DEPLOY_DIR && echo 'Files:' && find . -type f | wc -l && echo '---' && ls -la"

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Next steps on hunter ($HUNTER_HOST):"
echo "  cd $DEPLOY_DIR"
echo "  cp .env.example .env && vim .env    # Set CAPTAIN_API_URL and HUNTER_API_KEY"
echo "  pnpm install"
echo "  npx playwright install chromium"
echo "  mkdir -p data reports"
echo "  pnpm start                          # Start hunter agent v2.0 (dual mode)"
