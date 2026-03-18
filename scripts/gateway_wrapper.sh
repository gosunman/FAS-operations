#!/usr/bin/env bash
# FAS Gateway Wrapper — Auto-restart on crash with exponential backoff
# Usage: bash scripts/gateway_wrapper.sh
#
# Features:
#   - Loads .env via env_loader.sh
#   - Restarts the Gateway up to MAX_RETRIES times on crash
#   - Exponential backoff: 5s, 15s, 45s
#   - Escalates to [BLOCKED] after max retries
#   - Logs to logs/gateway.log

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load environment variables
# shellcheck source=env_loader.sh
source "$SCRIPT_DIR/env_loader.sh"

MAX_RETRIES=3
BASE_DELAY=5
LOG_DIR="$PROJECT_ROOT/logs"
LOG_FILE="$LOG_DIR/gateway.log"
CRASH_LOG="$LOG_DIR/crashes_gateway.log"

mkdir -p "$LOG_DIR"

log() {
  local timestamp
  timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$timestamp] $*" | tee -a "$LOG_FILE"
}

log "[Gateway Wrapper] Starting Gateway server"
log "[Gateway Wrapper] Max retries: $MAX_RETRIES, Base delay: ${BASE_DELAY}s"
log "[Gateway Wrapper] Working directory: $PROJECT_ROOT"

RETRY_COUNT=0

while true; do
  START_TIME=$(date +%s)

  # Run the Gateway server
  set +e
  cd "$PROJECT_ROOT"
  npx tsx src/gateway/server.ts >> "$LOG_FILE" 2>&1
  EXIT_CODE=$?
  set -e

  END_TIME=$(date +%s)
  RUNTIME=$((END_TIME - START_TIME))

  # If it ran for more than 60 seconds, reset retry counter
  # (it was running fine, this is a new crash)
  if [ "$RUNTIME" -gt 60 ]; then
    RETRY_COUNT=0
  fi

  RETRY_COUNT=$((RETRY_COUNT + 1))
  TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

  log "[Gateway Wrapper] Gateway exited with code $EXIT_CODE after ${RUNTIME}s (attempt $RETRY_COUNT/$MAX_RETRIES)"

  # Log crash to dedicated crash log
  echo "$TIMESTAMP exit_code=$EXIT_CODE runtime=${RUNTIME}s attempt=$RETRY_COUNT" >> "$CRASH_LOG"

  # Check max retries
  if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
    log "[BLOCKED] Gateway crashed $MAX_RETRIES times in succession. Manual intervention needed."
    echo "$TIMESTAMP [BLOCKED] gateway exceeded max retries ($MAX_RETRIES)" >> "$CRASH_LOG"

    # Wait for manual intervention, then reset and try again
    log "[Gateway Wrapper] Waiting 300 seconds before final retry..."
    sleep 300
    RETRY_COUNT=0
  fi

  # Exponential backoff: 5 * 3^(retry-1) → 5s, 15s, 45s
  DELAY=$((BASE_DELAY * (3 ** (RETRY_COUNT - 1))))
  log "[Gateway Wrapper] Restarting in ${DELAY}s..."
  sleep "$DELAY"
done
