#!/usr/bin/env bash
# FAS Gemini CLI Session Setup for Captain
# Checks prerequisites, validates config, installs launchd plist,
# and starts tmux session for Gemini CLI Account A only.
# (Account B is hunter-exclusive — removed from captain)
#
# Usage: bash scripts/setup/setup_gemini_cli.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAS_ROOT="${SCRIPT_DIR}/../.."
LOG_DIR="${FAS_ROOT}/logs"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
GEMINI_CONFIG_A="$HOME/.config/gemini/account-a"
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
echo "[1/5] Checking Gemini CLI installation..."
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
echo "[2/5] Checking Account A config..."
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

# === Step 3: Ensure logs directory exists ===
echo "[3/5] Ensuring logs directory..."
mkdir -p "$LOG_DIR"
info "Logs directory ready: $LOG_DIR"
echo ""

# === Step 4: Install launchd plist ===
echo "[4/5] Installing launchd plist..."
mkdir -p "$LAUNCH_AGENTS_DIR"

PLIST_NAME="com.fas.gemini-a.plist"
SRC="${SCRIPT_DIR}/${PLIST_NAME}"
DEST="${LAUNCH_AGENTS_DIR}/${PLIST_NAME}"

if [ ! -f "$SRC" ]; then
  fail "Plist source not found: $SRC"
else
  if launchctl list | grep -q "com.fas.gemini-a" 2>/dev/null; then
    echo "  Unloading existing com.fas.gemini-a..."
    launchctl unload "$DEST" 2>/dev/null || true
  fi

  cp "$SRC" "$DEST"
  info "Installed $PLIST_NAME to $LAUNCH_AGENTS_DIR"

  launchctl load "$DEST"
  info "Loaded com.fas.gemini-a into launchd"
fi
echo ""

# === Step 5: Start tmux session ===
echo "[5/5] Starting Gemini CLI tmux session..."

if tmux has-session -t fas-gemini-a 2>/dev/null; then
  warn "fas-gemini-a session already exists — skipping"
else
  tmux new-session -d -s fas-gemini-a "GEMINI_ACCOUNT=A bash ${FAS_ROOT}/scripts/gemini_wrapper.sh" 2>/dev/null || true
  info "Started fas-gemini-a tmux session"
fi
echo ""

echo "=========================================="
echo " Setup complete!"
echo ""
echo " Verify session:"
echo "   tmux ls"
echo ""
echo " Attach to session:"
echo "   tmux attach -t fas-gemini-a"
echo ""
echo " Check logs:"
echo "   tail -f $LOG_DIR/gemini-a.log"
echo "=========================================="
