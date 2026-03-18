#!/usr/bin/env bash
# FAS Mode Switch — transitions between SLEEP and AWAKE mode
# Usage: bash scripts/mode_switch.sh sleep|awake
# Calls the Gateway API to switch mode and logs the transition.

set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://localhost:3100}"
LOG_DIR="${LOG_DIR:-./logs}"
LOG_FILE="${LOG_DIR}/mode_switch.log"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Validate argument
if [ $# -ne 1 ]; then
  echo "Usage: $0 sleep|awake" >&2
  exit 1
fi

TARGET_MODE="$1"

if [ "$TARGET_MODE" != "sleep" ] && [ "$TARGET_MODE" != "awake" ]; then
  echo "Error: mode must be 'sleep' or 'awake', got '$TARGET_MODE'" >&2
  exit 1
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "[$TIMESTAMP] Switching to $TARGET_MODE mode..." | tee -a "$LOG_FILE"

# Call the Gateway API to switch mode
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${GATEWAY_URL}/api/mode" \
  -H "Content-Type: application/json" \
  -d "{\"target_mode\": \"${TARGET_MODE}\", \"reason\": \"scheduled cron transition\", \"requested_by\": \"cron\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo "[$TIMESTAMP] Mode switched to $TARGET_MODE successfully" | tee -a "$LOG_FILE"
  echo "[$TIMESTAMP] Response: $BODY" >> "$LOG_FILE"
else
  echo "[$TIMESTAMP] ERROR: Mode switch failed (HTTP $HTTP_CODE)" | tee -a "$LOG_FILE"
  echo "[$TIMESTAMP] Response: $BODY" >> "$LOG_FILE"
  exit 1
fi
