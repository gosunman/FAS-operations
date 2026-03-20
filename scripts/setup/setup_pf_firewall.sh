#!/usr/bin/env bash
# FAS Thunderbolt Bridge pf Firewall Setup
# Idempotent: detects captain/hunter, installs correct pf anchor, enables pf.
#
# Usage (requires sudo):
#   sudo bash scripts/setup/setup_pf_firewall.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANCHOR_NAME="fas-thunderbolt"
ANCHOR_DIR="/etc/pf.anchors"
ANCHOR_FILE="$ANCHOR_DIR/$ANCHOR_NAME"
PF_CONF="/etc/pf.conf"
ANCHOR_LINE="anchor \"$ANCHOR_NAME\""
LOAD_LINE="load anchor \"$ANCHOR_NAME\" from \"$ANCHOR_FILE\""

# === Colors ===
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# === Root check ===
if [ "$(id -u)" -ne 0 ]; then
  echo -e "${RED}[ERROR]${NC} This script must be run as root (sudo)."
  exit 1
fi

# === Detect role by hostname ===
HOSTNAME=$(hostname -s)
echo "[FAS-PF] Hostname: $HOSTNAME"

case "$HOSTNAME" in
  *captain*|*Captain*|*mac-studio-2*|*Mac-Studio-2*)
    ROLE="captain"
    CONF_FILE="$SCRIPT_DIR/fas-thunderbolt.captain.conf"
    ;;
  *hunter*|*Hunter*|*mac-studio-1*|*Mac-Studio-1*|*user*)
    ROLE="hunter"
    CONF_FILE="$SCRIPT_DIR/fas-thunderbolt.hunter.conf"
    ;;
  *)
    echo -e "${YELLOW}[WARN]${NC} Hostname '$HOSTNAME' does not match captain or hunter patterns."
    echo "  Attempting to detect by IP address on bridge0..."

    BRIDGE_IP=$(ifconfig bridge0 2>/dev/null | grep 'inet ' | awk '{print $2}' || echo "")
    if [ "$BRIDGE_IP" = "169.254.1.1" ]; then
      ROLE="captain"
      CONF_FILE="$SCRIPT_DIR/fas-thunderbolt.captain.conf"
      echo "  Detected as captain by bridge0 IP ($BRIDGE_IP)"
    elif [ "$BRIDGE_IP" = "169.254.1.2" ]; then
      ROLE="hunter"
      CONF_FILE="$SCRIPT_DIR/fas-thunderbolt.hunter.conf"
      echo "  Detected as hunter by bridge0 IP ($BRIDGE_IP)"
    else
      echo -e "${RED}[ERROR]${NC} Cannot determine role. Set hostname to contain 'captain' or 'hunter',"
      echo "         or configure bridge0 with 169.254.1.1 (captain) or 169.254.1.2 (hunter)."
      exit 1
    fi
    ;;
esac

echo "[FAS-PF] Role: $ROLE"
echo "[FAS-PF] Config: $CONF_FILE"

# === Verify config file exists ===
if [ ! -f "$CONF_FILE" ]; then
  echo -e "${RED}[ERROR]${NC} Config file not found: $CONF_FILE"
  exit 1
fi

# === Copy config to /etc/pf.anchors/ ===
echo "[FAS-PF] Installing anchor to $ANCHOR_FILE..."
cp "$CONF_FILE" "$ANCHOR_FILE"
chmod 644 "$ANCHOR_FILE"
chown root:wheel "$ANCHOR_FILE"
echo -e "  ${GREEN}[OK]${NC} Anchor file installed."

# === Add anchor lines to /etc/pf.conf if not present ===
MODIFIED=false

if ! grep -qF "$ANCHOR_LINE" "$PF_CONF"; then
  echo "[FAS-PF] Adding anchor declaration to $PF_CONF..."
  # Insert anchor line after the last existing anchor line, or before any pass/block rules
  echo "" >> "$PF_CONF"
  echo "# FAS Thunderbolt Bridge Firewall" >> "$PF_CONF"
  echo "$ANCHOR_LINE" >> "$PF_CONF"
  MODIFIED=true
else
  echo "[FAS-PF] Anchor declaration already present in $PF_CONF, skipping."
fi

if ! grep -qF "$LOAD_LINE" "$PF_CONF"; then
  echo "[FAS-PF] Adding anchor load directive to $PF_CONF..."
  echo "$LOAD_LINE" >> "$PF_CONF"
  MODIFIED=true
else
  echo "[FAS-PF] Anchor load directive already present in $PF_CONF, skipping."
fi

# === Validate syntax ===
echo "[FAS-PF] Validating pf configuration..."
if pfctl -n -f "$PF_CONF" 2>&1; then
  echo -e "  ${GREEN}[OK]${NC} Syntax validation passed."
else
  echo -e "${RED}[ERROR]${NC} pf configuration syntax error! Rolling back..."
  # Remove our additions if we just added them
  if [ "$MODIFIED" = true ]; then
    sed -i '' '/# FAS Thunderbolt Bridge Firewall/d' "$PF_CONF"
    sed -i '' "/anchor \"$ANCHOR_NAME\"/d" "$PF_CONF"
    sed -i '' "/load anchor \"$ANCHOR_NAME\"/d" "$PF_CONF"
    echo "  Rolled back $PF_CONF changes."
  fi
  exit 1
fi

# === Enable pf ===
echo "[FAS-PF] Enabling pf..."
pfctl -e 2>/dev/null || true  # -e returns error if already enabled

# === Load the rules ===
echo "[FAS-PF] Loading pf rules..."
pfctl -f "$PF_CONF"
echo -e "  ${GREEN}[OK]${NC} Rules loaded."

# === Verify anchor is loaded ===
echo "[FAS-PF] Verifying anchor..."
if pfctl -a "$ANCHOR_NAME" -sr 2>/dev/null | grep -q "block\|pass"; then
  echo -e "  ${GREEN}[OK]${NC} Anchor '$ANCHOR_NAME' is active with rules."
else
  echo -e "${YELLOW}[WARN]${NC} Anchor loaded but no rules visible. Check pfctl -a $ANCHOR_NAME -sr"
fi

echo ""
echo -e "${GREEN}[FAS-PF] Setup complete for $ROLE.${NC}"
echo "  Verify with: sudo pfctl -a $ANCHOR_NAME -sr"
echo "  Check logs:  sudo pfctl -a $ANCHOR_NAME -s info"
