#!/usr/bin/env bash
# Check macOS updates on captain and hunter, alert on security updates
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env_loader.sh" 2>/dev/null || true

LOG_FILE="${LOG_DIR:-./logs}/macos_update_check.log"
mkdir -p "$(dirname "$LOG_FILE")"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

GATEWAY_URL="${GATEWAY_URL:-http://localhost:3100}"

check_updates() {
  local host="$1"
  local label="$2"
  local output

  if [ "$host" = "localhost" ]; then
    output=$(softwareupdate --list 2>&1) || true
  else
    output=$(ssh "$host" 'softwareupdate --list 2>&1') || true
  fi

  echo "[$TIMESTAMP] [$label] Update check output:" >> "$LOG_FILE"
  echo "$output" >> "$LOG_FILE"

  # Check if there are updates requiring restart (security updates)
  if echo "$output" | grep -qi "restart"; then
    local update_name
    update_name=$(echo "$output" | grep -i "Label:" | head -1 | sed 's/.*Label: //' || echo "unknown")

    echo "[$TIMESTAMP] [$label] Security update found: $update_name" >> "$LOG_FILE"

    # Send notification via Gateway API
    local message="[macOS Update] $label: $update_name (restart required)"

    curl -s -X POST "$GATEWAY_URL/api/notify" \
      -H "Content-Type: application/json" \
      -d "{\"event_type\": \"discovery\", \"title\": \"macOS Security Update\", \"message\": \"$message\", \"source\": \"macos_update_check\"}" \
      >> "$LOG_FILE" 2>&1 || true

    echo "$message"
    return 1
  elif echo "$output" | grep -qi "No new software available"; then
    echo "[$TIMESTAMP] [$label] No updates available" >> "$LOG_FILE"
    return 0
  else
    # Unknown format - send raw output to Slack as fail-open
    echo "[$TIMESTAMP] [$label] Unexpected output format, forwarding raw" >> "$LOG_FILE"

    local truncated
    truncated=$(echo "$output" | head -20)
    curl -s -X POST "$GATEWAY_URL/api/notify" \
      -H "Content-Type: application/json" \
      -d "{\"event_type\": \"info\", \"title\": \"macOS Update Check ($label)\", \"message\": \"$truncated\", \"source\": \"macos_update_check\"}" \
      >> "$LOG_FILE" 2>&1 || true
    return 0
  fi
}

echo "=========================================="
echo " FAS — macOS Update Check"
echo "=========================================="
echo ""

echo "[1/2] Checking Captain (localhost)..."
check_updates "localhost" "Captain" || true

echo "[2/2] Checking Hunter (ssh)..."
check_updates "hunter" "Hunter" || true

echo ""
echo "[$TIMESTAMP] Update check complete" | tee -a "$LOG_FILE"
