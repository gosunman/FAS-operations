#!/usr/bin/env bash
# FAS Agent Wrapper — Auto-restart on crash
# Usage: agent_wrapper.sh <command> [args...]
#
# Features:
#   - Restarts the agent up to MAX_RETRIES times on crash
#   - Exponential backoff between retries
#   - Logs crash events
#   - Escalates to [BLOCKED] after max retries

set -euo pipefail

MAX_RETRIES="${FAS_MAX_RETRIES:-3}"
BASE_DELAY="${FAS_RETRY_DELAY:-5}"
LOG_DIR="${FAS_LOG_DIR:-$HOME/fully-automation-system/logs}"

if [ $# -eq 0 ]; then
  echo "Usage: agent_wrapper.sh <command> [args...]"
  echo "Example: agent_wrapper.sh claude --resume"
  exit 1
fi

COMMAND="$*"
AGENT_NAME="${1##*/}" # basename of command
RETRY_COUNT=0
mkdir -p "$LOG_DIR"

echo "[Wrapper] Starting agent: $COMMAND"
echo "[Wrapper] Max retries: $MAX_RETRIES, Base delay: ${BASE_DELAY}s"

while true; do
  START_TIME=$(date +%s)

  # Run the agent command
  set +e
  $COMMAND
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

  echo "[$TIMESTAMP] [Wrapper] Agent '$AGENT_NAME' exited with code $EXIT_CODE after ${RUNTIME}s (attempt $RETRY_COUNT/$MAX_RETRIES)"

  # Log crash
  echo "$TIMESTAMP exit_code=$EXIT_CODE runtime=${RUNTIME}s attempt=$RETRY_COUNT" >> "$LOG_DIR/crashes_${AGENT_NAME}.log"

  # Check max retries
  if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
    echo "[BLOCKED] Agent '$AGENT_NAME' crashed $MAX_RETRIES times in succession. Manual intervention needed."
    echo "$TIMESTAMP [BLOCKED] $AGENT_NAME exceeded max retries ($MAX_RETRIES)" >> "$LOG_DIR/crashes_${AGENT_NAME}.log"

    # Wait for manual restart signal (user can Ctrl+C and re-run)
    echo "[Wrapper] Waiting 300 seconds before final retry..."
    sleep 300
    RETRY_COUNT=0
  fi

  # Exponential backoff: base * 2^(retry-1)
  DELAY=$((BASE_DELAY * (1 << (RETRY_COUNT - 1))))
  echo "[Wrapper] Restarting in ${DELAY}s..."
  sleep "$DELAY"
done
