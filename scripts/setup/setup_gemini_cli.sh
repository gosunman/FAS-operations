#!/usr/bin/env bash
# FAS Gemini CLI Session Setup for Captain
# Checks prerequisites, validates configs, installs launchd plists,
# and starts tmux sessions for Gemini CLI accounts A and B.
#
# Usage: bash scripts/setup/setup_gemini_cli.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAS_ROOT="${SCRIPT_DIR}/../.."
LOG_DIR="${FAS_ROOT}/logs"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
GEMINI_CONFIG_A="$HOME/.config/gemini/account-a"
GEMINI_CONFIG_B="$HOME/.config/gemini/account-b"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; }

echo "=========================================="
echo " FAS Gemini CLI Setup"
echo "=========================================="
echo ""

# === Step 1: Check gemini CLI is installed ===
echo "[1/6] Checking Gemini CLI installation..."
if command -v gemini &>/dev/null; then
  GEMINI_VERSION=$(gemini --version 2>/dev/null || echo "unknown")
  info "Gemini CLI installed (version: $GEMINI_VERSION)"
else
  fail "Gemini CLI not found"
  echo "  Install with: npm install -g @google/gemini-cli"
  echo "  Or: npx @google/gemini-cli"
  exit 1
fi
echo ""

# === Step 2: Check account A config ===
echo "[2/6] Checking Account A (Research) config..."
if [ -d "$GEMINI_CONFIG_A" ]; then
  info "Account A config exists at $GEMINI_CONFIG_A"
else
  warn "Account A config not found at $GEMINI_CONFIG_A"
  echo "  To set up Account A:"
  echo "    1. mkdir -p $GEMINI_CONFIG_A"
  echo "    2. Run: GEMINI_CONFIG_DIR=$GEMINI_CONFIG_A gemini"
  echo "    3. Follow the Google OAuth flow for Account A"
  echo ""
  read -p "  Set up Account A now? (y/N) " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    mkdir -p "$GEMINI_CONFIG_A"
    echo "  Starting Gemini CLI for Account A auth..."
    GEMINI_CONFIG_DIR="$GEMINI_CONFIG_A" gemini --version
    echo "  Please complete the authentication in the browser."
  fi
fi
echo ""

# === Step 3: Check account B config ===
echo "[3/6] Checking Account B (Cross-verification) config..."
if [ -d "$GEMINI_CONFIG_B" ]; then
  info "Account B config exists at $GEMINI_CONFIG_B"
else
  warn "Account B config not found at $GEMINI_CONFIG_B"
  echo "  To set up Account B:"
  echo "    1. mkdir -p $GEMINI_CONFIG_B"
  echo "    2. Run: GEMINI_CONFIG_DIR=$GEMINI_CONFIG_B gemini"
  echo "    3. Follow the Google OAuth flow for Account B"
  echo ""
  read -p "  Set up Account B now? (y/N) " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    mkdir -p "$GEMINI_CONFIG_B"
    echo "  Starting Gemini CLI for Account B auth..."
    GEMINI_CONFIG_DIR="$GEMINI_CONFIG_B" gemini --version
    echo "  Please complete the authentication in the browser."
  fi
fi
echo ""

# === Step 4: Ensure logs directory exists ===
echo "[4/6] Ensuring logs directory..."
mkdir -p "$LOG_DIR"
info "Logs directory ready: $LOG_DIR"
echo ""

# === Step 5: Install launchd plists ===
echo "[5/6] Installing launchd plists..."
mkdir -p "$LAUNCH_AGENTS_DIR"

for ACCOUNT in a b; do
  PLIST_NAME="com.fas.gemini-${ACCOUNT}.plist"
  SRC="${SCRIPT_DIR}/${PLIST_NAME}"
  DEST="${LAUNCH_AGENTS_DIR}/${PLIST_NAME}"

  if [ ! -f "$SRC" ]; then
    fail "Plist source not found: $SRC"
    continue
  fi

  # Unload existing if loaded
  if launchctl list | grep -q "com.fas.gemini-${ACCOUNT}" 2>/dev/null; then
    echo "  Unloading existing com.fas.gemini-${ACCOUNT}..."
    launchctl unload "$DEST" 2>/dev/null || true
  fi

  cp "$SRC" "$DEST"
  info "Installed $PLIST_NAME to $LAUNCH_AGENTS_DIR"

  launchctl load "$DEST"
  info "Loaded com.fas.gemini-${ACCOUNT} into launchd"
done
echo ""

# === Step 6: Start tmux sessions ===
echo "[6/6] Starting Gemini CLI tmux sessions..."
GEMINI_STARTER="${FAS_ROOT}/scripts/gemini/start_gemini_sessions.sh"

if [ -f "$GEMINI_STARTER" ]; then
  bash "$GEMINI_STARTER" all
  info "Gemini CLI sessions started"
else
  warn "Session starter not found: $GEMINI_STARTER"
  echo "  You can start sessions manually:"
  echo "    tmux new-session -d -s fas-gemini-a 'bash scripts/gemini/gemini_wrapper.sh a'"
  echo "    tmux new-session -d -s fas-gemini-b 'bash scripts/gemini/gemini_wrapper.sh b'"
fi
echo ""

echo "=========================================="
echo " Setup complete!"
echo ""
echo " Verify sessions:"
echo "   tmux ls"
echo ""
echo " Attach to session:"
echo "   tmux attach -t fas-gemini-a"
echo "   tmux attach -t fas-gemini-b"
echo ""
echo " Check logs:"
echo "   tail -f $LOG_DIR/gemini-a.log"
echo "   tail -f $LOG_DIR/gemini-b.log"
echo "=========================================="
