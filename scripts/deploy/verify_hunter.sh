#!/usr/bin/env bash
# Post-deployment verification for hunter machine
# Tests connectivity, heartbeat, task flow, and PII scan.
#
# Usage:
#   bash scripts/deploy/verify_hunter.sh [captain-api-url] [hunter-api-key]
#   bash scripts/deploy/verify_hunter.sh                     # uses env vars
#
# Requires:
#   CAPTAIN_API_URL  — Captain Task API base URL (or pass as $1)
#   HUNTER_API_KEY   — Hunter API authentication key (or pass as $2)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Load .env if present
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

CAPTAIN_API="${1:-${CAPTAIN_API_URL:-http://100.64.0.1:3100}}"
API_KEY="${2:-${HUNTER_API_KEY:-}}"

# === Colors ===
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# === Helper functions ===

log_pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo -e "  ${GREEN}[PASS]${NC} $1"
}

log_fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo -e "  ${RED}[FAIL]${NC} $1"
}

log_warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  echo -e "  ${YELLOW}[WARN]${NC} $1"
}

log_info() {
  echo -e "  ${CYAN}[INFO]${NC} $1"
}

auth_header() {
  if [ -n "$API_KEY" ]; then
    echo "-H x-hunter-api-key: $API_KEY"
  fi
}

echo "=== FAS Hunter Post-Deployment Verification ==="
echo "Captain API: $CAPTAIN_API"
echo "API Key: ${API_KEY:+configured}${API_KEY:-NOT SET}"
echo ""

# ===== 1. Captain API Connectivity =====
echo "--- [1/6] Captain API connectivity ---"

HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$CAPTAIN_API/api/health" 2>/dev/null || echo "000")

if [ "$HEALTH_RESPONSE" = "200" ]; then
  log_pass "Health endpoint reachable (HTTP $HEALTH_RESPONSE)"

  # Parse health response
  HEALTH_BODY=$(curl -s --connect-timeout 5 "$CAPTAIN_API/api/health" 2>/dev/null)
  log_info "Server status: $HEALTH_BODY"
else
  log_fail "Health endpoint unreachable (HTTP $HEALTH_RESPONSE)"
  log_info "Check: Tailscale connection, Captain Gateway running, firewall rules"
fi
echo ""

# ===== 2. Heartbeat Endpoint =====
echo "--- [2/6] Heartbeat endpoint ---"

if [ -n "$API_KEY" ]; then
  HB_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 \
    -X POST "$CAPTAIN_API/api/hunter/heartbeat" \
    -H "Content-Type: application/json" \
    -H "x-hunter-api-key: $API_KEY" \
    -d '{"agent":"openclaw","timestamp":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' \
    2>/dev/null || echo "000")

  if [ "$HB_RESPONSE" = "200" ]; then
    log_pass "Heartbeat accepted (HTTP $HB_RESPONSE)"

    # Verify hunter shows as alive in health
    HEALTH_BODY=$(curl -s --connect-timeout 5 "$CAPTAIN_API/api/health" 2>/dev/null)
    if echo "$HEALTH_BODY" | grep -q '"hunter_alive":true'; then
      log_pass "Hunter shows as alive in health check"
    else
      log_warn "Hunter not yet showing as alive (may need a moment)"
    fi
  elif [ "$HB_RESPONSE" = "401" ]; then
    log_fail "Heartbeat rejected — API key mismatch (HTTP 401)"
  elif [ "$HB_RESPONSE" = "429" ]; then
    log_warn "Heartbeat rate-limited (HTTP 429) — try again later"
  else
    log_fail "Heartbeat failed (HTTP $HB_RESPONSE)"
  fi
else
  log_warn "Skipping heartbeat test — no API key configured"
fi
echo ""

# ===== 3. Task Flow (create → poll → submit) =====
echo "--- [3/6] Task flow: web_crawl cycle ---"

if [ -n "$API_KEY" ]; then
  # Create a test task assigned to openclaw
  CREATE_RESPONSE=$(curl -s --connect-timeout 5 \
    -X POST "$CAPTAIN_API/api/tasks" \
    -H "Content-Type: application/json" \
    -d '{
      "title": "[VERIFY] Test web_crawl task",
      "description": "Deployment verification test — safe to delete",
      "assigned_to": "openclaw",
      "priority": "low",
      "risk_level": "low",
      "mode": "awake",
      "requires_personal_info": false
    }' \
    2>/dev/null || echo '{"error":"FAILED"}')

  TASK_ID=$(echo "$CREATE_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")

  if [ -n "$TASK_ID" ]; then
    log_pass "Test task created: $TASK_ID"

    # Poll for pending tasks as hunter
    POLL_RESPONSE=$(curl -s --connect-timeout 5 \
      -H "x-hunter-api-key: $API_KEY" \
      "$CAPTAIN_API/api/hunter/tasks/pending" \
      2>/dev/null || echo '{"tasks":[]}')

    FOUND=$(echo "$POLL_RESPONSE" | python3 -c "
import sys,json
data = json.load(sys.stdin)
tasks = data.get('tasks', [])
found = any(t.get('id') == '$TASK_ID' for t in tasks)
print('yes' if found else 'no')
" 2>/dev/null || echo "no")

    if [ "$FOUND" = "yes" ]; then
      log_pass "Test task visible in hunter pending queue"
    else
      log_warn "Test task not found in pending queue (may be filtered)"
    fi

    # Submit a test result
    RESULT_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 \
      -X POST "$CAPTAIN_API/api/hunter/tasks/$TASK_ID/result" \
      -H "Content-Type: application/json" \
      -H "x-hunter-api-key: $API_KEY" \
      -d '{
        "status": "success",
        "output": "Deployment verification test result — all systems operational"
      }' \
      2>/dev/null || echo "000")

    if [ "$RESULT_RESPONSE" = "200" ]; then
      log_pass "Task result submitted successfully (HTTP $RESULT_RESPONSE)"
    else
      log_fail "Task result submission failed (HTTP $RESULT_RESPONSE)"
    fi
  else
    log_fail "Failed to create test task"
    log_info "Response: $CREATE_RESPONSE"
  fi
else
  log_warn "Skipping task flow test — no API key configured"
fi
echo ""

# ===== 4. PII Scan =====
echo "--- [4/6] PII scan ---"

PII_SCRIPT="$PROJECT_ROOT/scripts/security/scan_hunter_pii.sh"
if [ -f "$PII_SCRIPT" ]; then
  log_info "Running PII scanner..."
  # Run PII scan and capture exit code
  set +e
  PII_OUTPUT=$(bash "$PII_SCRIPT" 2>&1)
  PII_EXIT=$?
  set -e

  if [ "$PII_EXIT" -eq 0 ]; then
    if echo "$PII_OUTPUT" | grep -q "No PII found"; then
      log_pass "PII scan clean — no personal information detected"
    else
      log_warn "PII scan completed with findings — review the report"
    fi
  else
    log_fail "PII scan failed (exit code $PII_EXIT)"
  fi
else
  log_warn "PII scan script not found at $PII_SCRIPT"
fi
echo ""

# ===== 5. Runtime Environment =====
echo "--- [5/6] Runtime environment ---"

# Check Node.js
if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  log_pass "Node.js installed: $NODE_VER"
else
  log_fail "Node.js not installed"
fi

# Check pnpm
if command -v pnpm &>/dev/null; then
  PNPM_VER=$(pnpm --version)
  log_pass "pnpm installed: $PNPM_VER"
else
  log_fail "pnpm not installed"
fi

# Check Playwright
if npx playwright --version &>/dev/null 2>&1; then
  PW_VER=$(npx playwright --version 2>/dev/null)
  log_pass "Playwright installed: $PW_VER"
else
  log_warn "Playwright not installed — run: npx playwright install chromium"
fi

# Check Tailscale
if command -v tailscale &>/dev/null; then
  TS_STATUS=$(tailscale status --json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('BackendState','unknown'))" 2>/dev/null || echo "unknown")
  if [ "$TS_STATUS" = "Running" ]; then
    log_pass "Tailscale: $TS_STATUS"
  else
    log_warn "Tailscale state: $TS_STATUS"
  fi
else
  log_fail "Tailscale not installed"
fi
echo ""

# ===== 6. pf Firewall Status =====
echo "--- [6/6] pf firewall status (hunter) ---"

# Detect hunter Tailscale IP from CAPTAIN_API (replace captain IP with hunter IP pattern)
HUNTER_TS_IP="${HUNTER_TAILSCALE_IP:-100.64.0.2}"

# Try to SSH to hunter and check pfctl status
set +e
PF_REMOTE=$(ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no "$HUNTER_TS_IP" \
  "sudo pfctl -s info 2>&1 | head -1; echo '---'; sudo pfctl -a fas-thunderbolt -sr 2>/dev/null | head -5" \
  2>/dev/null)
SSH_EXIT=$?
set -e

if [ "$SSH_EXIT" -eq 0 ] && [ -n "$PF_REMOTE" ]; then
  PF_ENABLED=$(echo "$PF_REMOTE" | head -1)
  if echo "$PF_ENABLED" | grep -qi "enabled"; then
    log_pass "Hunter pf firewall is enabled"

    ANCHOR_RULES=$(echo "$PF_REMOTE" | sed '1,/---/d')
    if [ -n "$ANCHOR_RULES" ]; then
      RULE_COUNT=$(echo "$ANCHOR_RULES" | wc -l | tr -d ' ')
      log_pass "Hunter fas-thunderbolt anchor active ($RULE_COUNT rules)"
    else
      log_warn "Hunter fas-thunderbolt anchor has no rules"
    fi
  else
    log_fail "Hunter pf firewall is NOT enabled ($PF_ENABLED)"
    log_info "Fix on hunter: sudo bash ~/FAS-operations/scripts/setup/setup_pf_firewall.sh"
  fi
else
  log_warn "Cannot SSH to hunter at $HUNTER_TS_IP to check pf status (exit: $SSH_EXIT)"
  log_info "Ensure SSH access is available via Tailscale and key-based auth is configured"
fi
echo ""

# ===== Summary =====
TOTAL=$((PASS_COUNT + FAIL_COUNT + WARN_COUNT))

echo "=== Verification Summary ==="
echo -e "  ${GREEN}PASS: $PASS_COUNT${NC}"
echo -e "  ${RED}FAIL: $FAIL_COUNT${NC}"
echo -e "  ${YELLOW}WARN: $WARN_COUNT${NC}"
echo "  Total checks: $TOTAL"
echo ""

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}=== RESULT: ALL CHECKS PASSED ===${NC}"
  exit 0
else
  echo -e "${RED}=== RESULT: $FAIL_COUNT CHECK(S) FAILED ===${NC}"
  echo ""
  echo "Troubleshooting:"
  echo "  1. Verify Tailscale is connected: tailscale status"
  echo "  2. Verify Captain Gateway is running: curl $CAPTAIN_API/api/health"
  echo "  3. Verify API key matches: compare HUNTER_API_KEY on both machines"
  echo "  4. Check Gateway logs: ~/FAS-operations/logs/launchd_captain.log"
  exit 1
fi
