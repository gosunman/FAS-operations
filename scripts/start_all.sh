#!/usr/bin/env bash
# Start all FAS services on Captain
# Idempotent: skips sessions/services that already exist
#
# Boot sequence (dependency order):
#   Phase 1: Colima (Docker runtime)
#   Phase 2: n8n (Docker container, depends on Colima)
#   Phase 3: fas-captain (unified Gateway + Watcher + Planning + Monitors)
#   Phase 4: cc-root, cc-fas (Claude Code remote control tmux sessions)
#   Phase 5: Post-boot (mode switch + Telegram notification)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load environment variables
if [ -f "$SCRIPT_DIR/env_loader.sh" ]; then
  # shellcheck source=env_loader.sh
  source "$SCRIPT_DIR/env_loader.sh"
fi

HEALTH_URL="http://localhost:3100/api/health"
HEALTH_TIMEOUT=2
MAX_WAIT=30

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

# =============================================================
# Phase 1: Colima (Docker runtime)
# =============================================================
echo "[1/5] Colima (Docker runtime)..."
if command -v colima &>/dev/null; then
  if colima status 2>/dev/null | grep -q "Running"; then
    echo "[FAS] Colima already running, skipping."
  else
    echo "[FAS] Starting Colima..."
    colima start
    # Wait until Colima is ready
    elapsed=0
    while ! colima status 2>/dev/null | grep -q "Running"; do
      sleep 2
      elapsed=$((elapsed + 2))
      if [ "$elapsed" -ge "$MAX_WAIT" ]; then
        echo "[FAS] WARNING: Colima not ready after ${MAX_WAIT}s. Continuing anyway."
        break
      fi
      echo "[FAS] Waiting for Colima... (${elapsed}s)"
    done
    echo "[FAS] Colima started."
  fi
else
  echo "[FAS] WARNING: Colima not installed. Docker services will not be available."
fi
echo ""

# =============================================================
# Phase 2: n8n (Docker container)
# =============================================================
echo "[2/5] n8n (Docker container)..."
if command -v docker &>/dev/null; then
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" up -d
  echo "[FAS] Waiting for n8n health check..."
  elapsed=0
  while true; do
    health_status=$(docker inspect --format='{{.State.Health.Status}}' fas-operations-n8n-1 2>/dev/null || echo "unknown")
    if [ "$health_status" = "healthy" ]; then
      echo "[FAS] n8n is healthy."
      break
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    if [ "$elapsed" -ge "$MAX_WAIT" ]; then
      echo "[FAS] WARNING: n8n not healthy after ${MAX_WAIT}s (status: ${health_status}). Continuing anyway."
      break
    fi
    echo "[FAS] Waiting for n8n... (${elapsed}s, status: ${health_status})"
  done
else
  echo "[FAS] WARNING: Docker not available. Skipping n8n."
fi
echo ""

# =============================================================
# Phase 3: fas-captain (pnpm captain — unified service)
# =============================================================
echo "[3/5] Captain (unified: Gateway + Watcher + Planning + Monitors)..."
create_session "fas-captain" "pnpm captain" "$PROJECT_ROOT"

# Wait for Gateway health check
echo "[FAS] Waiting for Gateway health check..."
elapsed=0
while true; do
  if curl -s --max-time "$HEALTH_TIMEOUT" "$HEALTH_URL" >/dev/null 2>&1; then
    HEALTH_RESPONSE=$(curl -s --max-time "$HEALTH_TIMEOUT" "$HEALTH_URL")
    echo "[FAS] Gateway healthy: $HEALTH_RESPONSE"
    break
  fi
  sleep 2
  elapsed=$((elapsed + 2))
  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    echo "[FAS] WARNING: Gateway not responding after ${MAX_WAIT}s. Check fas-captain session."
    break
  fi
  echo "[FAS] Waiting for Gateway... (${elapsed}s)"
done
echo ""

# =============================================================
# Phase 4: Claude Code remote control tmux sessions
# =============================================================
echo "[4/5] Claude Code sessions (empty — manual start by owner)..."
create_session "cc-root" "" "$PROJECT_ROOT"
create_session "cc-fas" "" "$PROJECT_ROOT"
echo ""

# =============================================================
# Phase 5: Post-boot (mode switch + notification)
# =============================================================
echo "[5/5] Post-boot processing..."

# Determine awake/sleep mode based on current hour
CURRENT_HOUR=$(date +%H)
if [ "$CURRENT_HOUR" -ge 7 ] && [ "$CURRENT_HOUR" -lt 23 ]; then
  TARGET_MODE="awake"
else
  TARGET_MODE="sleep"
fi

# Call mode switch if Gateway is healthy
if curl -s --max-time "$HEALTH_TIMEOUT" "$HEALTH_URL" >/dev/null 2>&1; then
  echo "[FAS] Setting mode to '${TARGET_MODE}' (boot recovery)..."
  curl -s -X POST "http://localhost:3100/api/mode" \
    -H "Content-Type: application/json" \
    -d "{\"target_mode\": \"${TARGET_MODE}\", \"reason\": \"boot recovery\", \"requested_by\": \"start_all\"}" || true
  echo ""
else
  echo "[FAS] Gateway not available, skipping mode switch."
fi

# Telegram notification (optional, requires env vars)
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "text=[FAS] Captain services restored (mode: ${TARGET_MODE})" || true
  echo "[FAS] Telegram notification sent."
fi

echo ""
echo "=========================================="
echo " FAS Captain — All Services Started"
echo "=========================================="
echo ""
echo "  tmux list-sessions | grep -E 'fas-|cc-'"
echo "  tmux attach -t fas-captain   # Gateway + monitors"
echo "  tmux attach -t cc-root       # Claude Code (root)"
echo "  tmux attach -t cc-fas        # Claude Code (FAS)"
echo ""
