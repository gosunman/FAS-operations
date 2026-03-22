#!/bin/bash
# Deploy minimal Hunter agent files to Hunter machine
# Rule: No git clone. Only deploy necessary files via scp.
#
# Usage: ./scripts/deploy_hunter.sh

set -euo pipefail

HUNTER_HOST="hunter"
HUNTER_BASE="/Users/user/fas-hunter"
LOCAL_BASE="$(cd "$(dirname "$0")/.." && pwd)"

echo "[Deploy] Creating remote directory structure..."
ssh "$HUNTER_HOST" "mkdir -p $HUNTER_BASE/{src/hunter,src/shared,src/gateway,data,logs,reports,state}"

# === Files to deploy ===

# Hunter agent source files
HUNTER_FILES=(
  "src/hunter/main.ts"
  "src/hunter/config.ts"
  "src/hunter/logger.ts"
  "src/hunter/api_client.ts"
  "src/hunter/browser.ts"
  "src/hunter/task_executor.ts"
  "src/hunter/poll_loop.ts"
  "src/hunter/notify.ts"
  "src/hunter/mode_router.ts"
  "src/hunter/project_db.ts"
  "src/hunter/revenue_scout.ts"
  "src/hunter/project_executor.ts"
  "src/hunter/retrospective.ts"
  "src/hunter/reporter.ts"
  "src/hunter/index.ts"
  "src/hunter/seed_first_project.ts"
)

# Shared types
SHARED_FILES=(
  "src/shared/types.ts"
)

# Gateway task store (for type imports)
GATEWAY_FILES=(
  "src/gateway/task_store.ts"
)

# Config files
CONFIG_FILES=(
  "package.json"
  "tsconfig.json"
  ".env.example"
)

echo "[Deploy] Copying Hunter source files..."
for f in "${HUNTER_FILES[@]}"; do
  scp -q "$LOCAL_BASE/$f" "$HUNTER_HOST:$HUNTER_BASE/$f"
done

echo "[Deploy] Copying shared files..."
for f in "${SHARED_FILES[@]}"; do
  scp -q "$LOCAL_BASE/$f" "$HUNTER_HOST:$HUNTER_BASE/$f"
done

echo "[Deploy] Copying gateway files..."
for f in "${GATEWAY_FILES[@]}"; do
  scp -q "$LOCAL_BASE/$f" "$HUNTER_HOST:$HUNTER_BASE/$f"
done

echo "[Deploy] Copying config files..."
for f in "${CONFIG_FILES[@]}"; do
  scp -q "$LOCAL_BASE/$f" "$HUNTER_HOST:$HUNTER_BASE/$f"
done

# Create .env for Hunter
echo "[Deploy] Creating Hunter .env..."
ssh "$HUNTER_HOST" "cat > $HUNTER_BASE/.env << 'ENVEOF'
# Hunter Agent Configuration
CAPTAIN_API_URL=http://100.101.38.15:3100
HUNTER_API_KEY=fas-hunter-stage1-key
HUNTER_POLL_INTERVAL=10000
HUNTER_LOG_DIR=./logs
HUNTER_HEADLESS=true
GOOGLE_PROFILE_DIR=./fas-google-profile-hunter
DEEP_RESEARCH_TIMEOUT_MS=300000
NOTEBOOKLM_TIMEOUT_MS=180000
CHATGPT_TIMEOUT_MS=180000
HUNTER_DB_PATH=./data/hunter_projects.db
HUNTER_REPORTS_DIR=./reports
HUNTER_SCOUT_INTERVAL_MS=21600000
OPENCLAW_COMMAND=/Users/user/.nvm/versions/node/v22.22.1/bin/openclaw
OPENCLAW_AGENT=main
NODE_ENV=development
ENVEOF"

echo "[Deploy] Installing dependencies on Hunter..."
ssh "$HUNTER_HOST" "cd $HUNTER_BASE && export PATH=/opt/homebrew/bin:\$PATH && npm install --production 2>&1 | tail -5"

echo "[Deploy] Done. To start Hunter agent:"
echo "  ssh hunter 'cd $HUNTER_BASE && export PATH=/opt/homebrew/bin:\$PATH && npx tsx src/hunter/main.ts'"
