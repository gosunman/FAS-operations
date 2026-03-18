#!/usr/bin/env bash
# Start all FAS tmux sessions on Captain
# Naming convention: fas-{service}
#
# Sessions:
#   fas-claude    - Claude Code (interactive AI agent)
#   fas-gemini-a  - Gemini CLI Account A (research)
#   fas-n8n       - n8n orchestrator (Docker/Colima)
#   fas-gateway   - Express Gateway + Task API
#   fas-watchdog  - System watchdog daemon

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[FAS] Starting Captain tmux sessions..."

# Helper: create session if it doesn't exist
create_session() {
  local session_name="$1"
  local start_command="$2"
  local working_dir="${3:-$PROJECT_ROOT}"

  if tmux has-session -t "$session_name" 2>/dev/null; then
    echo "[FAS] Session '$session_name' already exists, skipping."
  else
    tmux new-session -d -s "$session_name" -c "$working_dir"
    if [ -n "$start_command" ]; then
      tmux send-keys -t "$session_name" "$start_command" C-m
    fi
    echo "[FAS] Created session '$session_name'"
  fi
}

# === Create sessions ===

# Gateway + Task API (start first, other services depend on it)
create_session "fas-gateway" "pnpm run gateway" "$PROJECT_ROOT"

# Watchdog
create_session "fas-watchdog" "pnpm run watcher" "$PROJECT_ROOT"

# n8n (Docker/Colima) — only if colima is installed
if command -v colima &>/dev/null; then
  create_session "fas-n8n" "cd $PROJECT_ROOT && docker compose up" "$PROJECT_ROOT"
else
  echo "[FAS] Colima not installed, skipping fas-n8n session."
fi

# Claude Code — interactive session, no auto-command
create_session "fas-claude" "" "$PROJECT_ROOT"

# Gemini CLI sessions — placeholder until auth is configured
create_session "fas-gemini-a" "echo 'Gemini A: waiting for auth setup'" "$PROJECT_ROOT" "$PROJECT_ROOT"

echo ""
echo "[FAS] Captain sessions ready. List with: tmux list-sessions"
echo "[FAS] Attach to a session: tmux attach -t fas-claude"
