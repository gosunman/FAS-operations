#!/usr/bin/env bash
# FAS tmux environment setup script
# Sets up tmux configuration and session naming conventions
#
# Captain sessions: fas-claude, fas-gemini-a, fas-n8n, fas-gateway, fas-watchdog
# Hunter sessions:  fas-openclaw, fas-watchdog

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "[FAS] Setting up tmux environment..."

# === 1. Install tmux-resurrect (if not already installed) ===
TMUX_PLUGINS_DIR="$HOME/.tmux/plugins"
RESURRECT_DIR="$TMUX_PLUGINS_DIR/tmux-resurrect"

if [ ! -d "$RESURRECT_DIR" ]; then
  echo "[FAS] Installing tmux-resurrect..."
  mkdir -p "$TMUX_PLUGINS_DIR"
  git clone https://github.com/tmux-plugins/tmux-resurrect "$RESURRECT_DIR"
  echo "[FAS] tmux-resurrect installed at $RESURRECT_DIR"
else
  echo "[FAS] tmux-resurrect already installed."
fi

# === 2. Create resurrect state directory ===
mkdir -p "$PROJECT_ROOT/.tmux/resurrect"

# === 3. Source FAS tmux config ===
TMUX_CONF="$HOME/.tmux.conf"
FAS_CONF_LINE="source-file $PROJECT_ROOT/config/tmux.conf"

if [ -f "$TMUX_CONF" ]; then
  if ! grep -q "FAS-operations" "$TMUX_CONF"; then
    echo "" >> "$TMUX_CONF"
    echo "# FAS tmux configuration" >> "$TMUX_CONF"
    echo "$FAS_CONF_LINE" >> "$TMUX_CONF"
    echo "[FAS] Added FAS config to existing $TMUX_CONF"
  else
    echo "[FAS] FAS config already referenced in $TMUX_CONF"
  fi
else
  echo "# FAS tmux configuration" > "$TMUX_CONF"
  echo "$FAS_CONF_LINE" >> "$TMUX_CONF"
  echo "[FAS] Created $TMUX_CONF with FAS config"
fi

# === 4. Load resurrect plugin in tmux.conf ===
if [ -d "$RESURRECT_DIR" ] && ! grep -q "tmux-resurrect" "$TMUX_CONF"; then
  echo "run-shell $RESURRECT_DIR/resurrect.tmux" >> "$TMUX_CONF"
  echo "[FAS] Added tmux-resurrect plugin to $TMUX_CONF"
fi

echo "[FAS] tmux setup complete!"
echo "[FAS] Run 'scripts/start_captain_sessions.sh' to create all FAS sessions."
