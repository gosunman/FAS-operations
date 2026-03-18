#!/usr/bin/env bash
# FAS Hunter Watchdog — monitors and auto-restarts hunter process
# Designed to run on the hunter machine inside a tmux session or via launchd.
#
# Features:
#   - Auto-restart on crash with exponential backoff
#   - Max 3 retries before sending final failure notification
#   - Crash logging with timestamps
#   - Resets retry counter if process ran successfully for >60s
#   - Reports crash events to Captain API
#
# Usage:
#   bash scripts/hunter_watchdog.sh
#
# Environment:
#   HUNTER_MAX_RETRIES  — max consecutive retries (default: 3)
#   HUNTER_RETRY_DELAY  — base delay in seconds (default: 5)
#   HUNTER_LOG_DIR      — log directory (default: ./logs)
#   CAPTAIN_API_URL     — Captain API for crash reporting (optional)
#   HUNTER_API_KEY      — API key for Captain (optional)

set -euo pipefail

MAX_RETRIES="${HUNTER_MAX_RETRIES:-3}"
BASE_DELAY="${HUNTER_RETRY_DELAY:-5}"
LOG_DIR="${HUNTER_LOG_DIR:-./logs}"
CAPTAIN_API="${CAPTAIN_API_URL:-}"
API_KEY="${HUNTER_API_KEY:-}"
DEPLOY_DIR="${HUNTER_DEPLOY_DIR:-/Users/user/fas-hunter-agent}"

AGENT_NAME="hunter"
RETRY_COUNT=0

mkdir -p "$LOG_DIR"

CRASH_LOG="$LOG_DIR/crashes_${AGENT_NAME}.log"

echo "[HunterWatchdog] Starting hunter process monitor"
echo "[HunterWatchdog] Deploy dir: $DEPLOY_DIR"
echo "[HunterWatchdog] Max retries: $MAX_RETRIES, Base delay: ${BASE_DELAY}s"
echo "[HunterWatchdog] Crash log: $CRASH_LOG"

# === Helper: report crash to Captain API ===
report_crash() {
  local exit_code="$1"
  local runtime="$2"

  if [ -n "$CAPTAIN_API" ] && [ -n "$API_KEY" ]; then
    curl -s -o /dev/null --connect-timeout 5 \
      -X POST "$CAPTAIN_API/api/agents/hunter/crash" \
      -H "Content-Type: application/json" \
      -H "x-hunter-api-key: $API_KEY" \
      -d "{\"exit_code\":$exit_code,\"runtime_seconds\":$runtime}" \
      2>/dev/null || true
  fi
}

# === Helper: send final failure notification ===
notify_final_failure() {
  echo "[HunterWatchdog] Sending final failure notification..."

  # Try Captain API crash report
  report_crash 1 0

  # Try local Telegram notification if configured
  if [ -n "${HUNTER_TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${HUNTER_TELEGRAM_CHAT_ID:-}" ]; then
    local message="[BLOCKED] Hunter process crashed $MAX_RETRIES times. Manual intervention required on hunter machine."
    curl -s -o /dev/null --connect-timeout 5 \
      "https://api.telegram.org/bot${HUNTER_TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${HUNTER_TELEGRAM_CHAT_ID}" \
      -d "text=${message}" \
      -d "parse_mode=HTML" \
      2>/dev/null || true
  fi
}

# === Main loop ===

while true; do
  START_TIME=$(date +%s)
  TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

  echo "[$TIMESTAMP] [HunterWatchdog] Starting hunter process (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)..."

  # Run the hunter agent
  set +e
  cd "$DEPLOY_DIR" && npx tsx src/hunter/main.ts
  EXIT_CODE=$?
  set -e

  END_TIME=$(date +%s)
  RUNTIME=$((END_TIME - START_TIME))
  TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

  echo "[$TIMESTAMP] [HunterWatchdog] Hunter exited with code $EXIT_CODE after ${RUNTIME}s"

  # Log crash event
  echo "$TIMESTAMP exit_code=$EXIT_CODE runtime=${RUNTIME}s attempt=$((RETRY_COUNT + 1))" >> "$CRASH_LOG"

  # Report crash to Captain
  report_crash "$EXIT_CODE" "$RUNTIME"

  # If ran for more than 60 seconds, consider it a fresh crash (reset counter)
  if [ "$RUNTIME" -gt 60 ]; then
    RETRY_COUNT=0
  fi

  RETRY_COUNT=$((RETRY_COUNT + 1))

  # Check if max retries exceeded
  if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
    echo "[BLOCKED] Hunter process crashed $MAX_RETRIES times in succession. Manual intervention needed."
    echo "$TIMESTAMP [BLOCKED] hunter exceeded max retries ($MAX_RETRIES)" >> "$CRASH_LOG"

    notify_final_failure

    # Long wait before reset — give human time to investigate
    echo "[HunterWatchdog] Waiting 300 seconds before final retry..."
    sleep 300
    RETRY_COUNT=0
  fi

  # Exponential backoff: base * 2^(retry-1)
  DELAY=$((BASE_DELAY * (1 << (RETRY_COUNT - 1))))
  echo "[HunterWatchdog] Restarting in ${DELAY}s..."
  sleep "$DELAY"
done
