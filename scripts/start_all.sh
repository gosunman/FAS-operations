#!/usr/bin/env bash
# Start all FAS services on Captain
# Idempotent: skips sessions that already exist
#
# Services:
#   fas-gateway   - Express Gateway + Task API (port 3100)
#   fas-claude    - Claude Code interactive session
#   fas-gemini-a  - Gemini CLI Account A (research)
#   fas-gemini-b  - Gemini CLI Account B (validator)
#   fas-watchdog  - System watchdog daemon

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load environment variables
# shellcheck source=env_loader.sh
source "$SCRIPT_DIR/env_loader.sh"

HEALTH_URL="http://localhost:3100/api/health"
HEALTH_TIMEOUT=2
HEALTH_RETRIES=5

echo "=========================================="
echo " FAS Captain — Starting All Services"
echo "=========================================="
echo ""

# Helper: create tmux session if it doesn't exist
create_session() {
  local session_name="$1"
  local start_command="$2"
  local working_dir="${3:-$PROJECT_ROOT}"

  if tmux has-session -t "$session_name" 2>/dev/null; then
    echo "[FAS] Session '$session_name' already exists, skipping."
    return 0
  fi

  tmux new-session -d -s "$session_name" -c "$working_dir"
  if [ -n "$start_command" ]; then
    tmux send-keys -t "$session_name" "$start_command" C-m
  fi
  echo "[FAS] Created session '$session_name'"
}

# === 1. Gateway (start first — other services depend on it) ===
echo "[1/6] Gateway..."
create_session "fas-gateway" "bash $SCRIPT_DIR/gateway_wrapper.sh" "$PROJECT_ROOT"

# === 2. Claude Code (interactive session, no auto-command) ===
echo "[2/6] Claude Code..."
create_session "fas-claude" "" "$PROJECT_ROOT"

# === 3. Gemini CLI A ===
echo "[3/6] Gemini CLI A..."
create_session "fas-gemini-a" "bash $SCRIPT_DIR/gemini_wrapper.sh" "$PROJECT_ROOT"

# === 4. Gemini CLI B ===
echo "[4/6] Gemini CLI B..."
create_session "fas-gemini-b" "GEMINI_ACCOUNT=B bash $SCRIPT_DIR/gemini_wrapper.sh" "$PROJECT_ROOT"

# === 5. Watchdog ===
echo "[5/6] Watchdog..."
create_session "fas-watchdog" "pnpm run watcher" "$PROJECT_ROOT"

# === 6. n8n (Docker/Colima) — optional ===
echo "[6/6] n8n (optional)..."
if command -v colima &>/dev/null; then
  create_session "fas-n8n" "cd $PROJECT_ROOT && docker compose up" "$PROJECT_ROOT"
else
  echo "[FAS] Colima not installed, skipping fas-n8n session."
fi

echo ""

# === Health Check: Wait for Gateway to become healthy ===
echo "[FAS] Waiting for Gateway health check..."
for i in $(seq 1 "$HEALTH_RETRIES"); do
  sleep 2
  if curl -s --max-time "$HEALTH_TIMEOUT" "$HEALTH_URL" >/dev/null 2>&1; then
    HEALTH_RESPONSE=$(curl -s --max-time "$HEALTH_TIMEOUT" "$HEALTH_URL")
    echo "[FAS] Gateway healthy: $HEALTH_RESPONSE"
    break
  fi
  if [ "$i" -eq "$HEALTH_RETRIES" ]; then
    echo "[FAS] WARNING: Gateway not responding after $((HEALTH_RETRIES * 2))s. Check fas-gateway session."
  else
    echo "[FAS] Attempt $i/$HEALTH_RETRIES — Gateway not ready yet..."
  fi
done

echo ""
echo "=========================================="
echo " FAS Captain — All Services Started"
echo "=========================================="
echo ""
echo "  tmux list-sessions | grep fas-"
echo "  tmux attach -t fas-claude"
echo ""
