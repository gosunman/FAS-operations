#!/usr/bin/env bash
# FAS Thunderbolt Bridge Connection & Firewall Verification
# Verifies pf firewall, bridge0 interface, connectivity, and port filtering.
#
# Usage:
#   bash scripts/security/verify_cable_connection.sh

set -euo pipefail

HUNTER_TB_IP="169.254.1.2"
CAPTAIN_TB_IP="169.254.1.1"
ANCHOR_NAME="fas-thunderbolt"
JACCL_COORD_PORT=51100
SSH_PORT=22
TASK_API_PORT=3100

# === Colors ===
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

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

echo "=== FAS Thunderbolt Bridge — Connection & Firewall Verification ==="
echo ""

# ===== 1. pf Enabled =====
echo "--- [1/7] pf firewall status ---"

PF_STATUS=$(sudo pfctl -s info 2>&1 | head -1 || echo "unknown")
if echo "$PF_STATUS" | grep -qi "enabled"; then
  log_pass "pf is enabled"
else
  log_fail "pf is not enabled (status: $PF_STATUS)"
  log_info "Fix: sudo pfctl -e"
fi
echo ""

# ===== 2. fas-thunderbolt Anchor Loaded =====
echo "--- [2/7] fas-thunderbolt anchor ---"

ANCHOR_RULES=$(sudo pfctl -a "$ANCHOR_NAME" -sr 2>/dev/null || echo "")
if [ -n "$ANCHOR_RULES" ] && echo "$ANCHOR_RULES" | grep -q "block\|pass"; then
  RULE_COUNT=$(echo "$ANCHOR_RULES" | wc -l | tr -d ' ')
  log_pass "Anchor '$ANCHOR_NAME' loaded with $RULE_COUNT rules"
else
  log_fail "Anchor '$ANCHOR_NAME' not loaded or has no rules"
  log_info "Fix: sudo bash scripts/setup/setup_pf_firewall.sh"
fi
echo ""

# ===== 3. bridge0 Interface =====
echo "--- [3/7] bridge0 interface ---"

if ifconfig bridge0 &>/dev/null; then
  BRIDGE_IP=$(ifconfig bridge0 | grep 'inet ' | awk '{print $2}')
  if [ -n "$BRIDGE_IP" ]; then
    log_pass "bridge0 exists with IP: $BRIDGE_IP"
  else
    log_fail "bridge0 exists but has no IPv4 address"
  fi
else
  log_fail "bridge0 interface does not exist"
  log_info "Check: Thunderbolt cable connected? System Preferences > Network > Thunderbolt Bridge configured?"
fi
echo ""

# ===== 4. Ping Hunter via Thunderbolt =====
echo "--- [4/7] Ping hunter ($HUNTER_TB_IP) via Thunderbolt ---"

if ping -c 2 -W 2 -S "$CAPTAIN_TB_IP" "$HUNTER_TB_IP" &>/dev/null; then
  PING_MS=$(ping -c 1 -W 2 -S "$CAPTAIN_TB_IP" "$HUNTER_TB_IP" 2>/dev/null | grep 'time=' | sed 's/.*time=\([^ ]*\).*/\1/')
  log_pass "Hunter reachable via Thunderbolt Bridge (${PING_MS}ms)"
else
  log_fail "Cannot ping hunter at $HUNTER_TB_IP via Thunderbolt Bridge"
  log_info "Check: Cable connected? Hunter IP configured? pf ICMP rule active?"
fi
echo ""

# ===== 5. JACCL Port 51100 Reachable =====
echo "--- [5/7] JACCL coordination port ($JACCL_COORD_PORT) ---"

# Use nc with short timeout to test TCP connectivity
if nc -z -w 3 -s "$CAPTAIN_TB_IP" "$HUNTER_TB_IP" "$JACCL_COORD_PORT" 2>/dev/null; then
  log_pass "JACCL coordination port $JACCL_COORD_PORT is reachable"
else
  # Port might not be listening yet — distinguish between filtered and closed
  NC_OUTPUT=$(nc -z -v -w 3 -s "$CAPTAIN_TB_IP" "$HUNTER_TB_IP" "$JACCL_COORD_PORT" 2>&1 || true)
  if echo "$NC_OUTPUT" | grep -qi "refused"; then
    log_warn "Port $JACCL_COORD_PORT reachable but nothing listening (connection refused — pf allows, service not running)"
  else
    log_fail "JACCL coordination port $JACCL_COORD_PORT is not reachable (filtered or timeout)"
  fi
fi
echo ""

# ===== 6. SSH Port 22 Blocked via TB =====
echo "--- [6/7] SSH port ($SSH_PORT) blocked via Thunderbolt ---"

if nc -z -w 3 -s "$CAPTAIN_TB_IP" "$HUNTER_TB_IP" "$SSH_PORT" 2>/dev/null; then
  log_fail "SSH port $SSH_PORT is REACHABLE via Thunderbolt — should be blocked!"
  log_info "pf rules should block all ports except JACCL (51000-51007, 51100)"
else
  log_pass "SSH port $SSH_PORT is correctly blocked via Thunderbolt Bridge"
fi
echo ""

# ===== 7. Task API Port 3100 Blocked via TB =====
echo "--- [7/7] Task API port ($TASK_API_PORT) blocked via Thunderbolt ---"

if nc -z -w 3 -s "$CAPTAIN_TB_IP" "$HUNTER_TB_IP" "$TASK_API_PORT" 2>/dev/null; then
  log_fail "Task API port $TASK_API_PORT is REACHABLE via Thunderbolt — should be blocked!"
  log_info "Task API must only be accessible via Tailscale, not Thunderbolt"
else
  log_pass "Task API port $TASK_API_PORT is correctly blocked via Thunderbolt Bridge"
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
  echo "  1. Run firewall setup: sudo bash scripts/setup/setup_pf_firewall.sh"
  echo "  2. Check pf rules:    sudo pfctl -a fas-thunderbolt -sr"
  echo "  3. Check bridge0:     ifconfig bridge0"
  echo "  4. Check cable:       System Preferences > Network > Thunderbolt Bridge"
  exit 1
fi
