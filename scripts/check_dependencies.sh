#!/usr/bin/env bash
# Monthly dependency check: outdated packages + security audit
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/env_loader.sh" 2>/dev/null || true

LOG_FILE="${LOG_DIR:-./logs}/dependency_check.log"
mkdir -p "$(dirname "$LOG_FILE")"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

GATEWAY_URL="${GATEWAY_URL:-http://localhost:3100}"

cd "$PROJECT_ROOT"

echo "[$TIMESTAMP] === Dependency Check ===" | tee -a "$LOG_FILE"

# 1. Check outdated
echo "[1/2] Checking outdated packages..." | tee -a "$LOG_FILE"
OUTDATED=$(pnpm outdated 2>&1) || true
echo "$OUTDATED" >> "$LOG_FILE"

# 2. Security audit
echo "[2/2] Running security audit..." | tee -a "$LOG_FILE"
AUDIT=$(pnpm audit 2>&1) || true
echo "$AUDIT" >> "$LOG_FILE"

# Check for critical vulnerabilities
CRITICAL_COUNT=$(echo "$AUDIT" | grep -ci "critical" || echo "0")

REPORT="Outdated:\n$(echo "$OUTDATED" | head -20)\n\nAudit:\n$(echo "$AUDIT" | tail -10)"

if [ "$CRITICAL_COUNT" -gt 0 ]; then
  # Critical found - send Telegram alert via discovery event
  curl -s -X POST "$GATEWAY_URL/api/notify" \
    -H "Content-Type: application/json" \
    -d "{\"event_type\": \"discovery\", \"title\": \"Critical Vulnerability Found\", \"message\": \"$CRITICAL_COUNT critical vulnerabilities detected. Check logs.\", \"source\": \"dependency_check\"}" \
    >> "$LOG_FILE" 2>&1 || true
  echo "[$TIMESTAMP] CRITICAL: $CRITICAL_COUNT critical vulnerabilities found" | tee -a "$LOG_FILE"
else
  # Normal report to Slack
  curl -s -X POST "$GATEWAY_URL/api/notify" \
    -H "Content-Type: application/json" \
    -d "{\"event_type\": \"info\", \"title\": \"Monthly Dependency Report\", \"message\": \"No critical vulnerabilities. $(echo "$OUTDATED" | wc -l | tr -d ' ') outdated entries.\", \"source\": \"dependency_check\"}" \
    >> "$LOG_FILE" 2>&1 || true
  echo "[$TIMESTAMP] OK: No critical vulnerabilities" | tee -a "$LOG_FILE"
fi

echo "[$TIMESTAMP] Dependency check complete" | tee -a "$LOG_FILE"
