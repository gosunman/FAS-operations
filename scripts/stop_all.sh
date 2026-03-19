#!/usr/bin/env bash
# Stop all FAS tmux sessions and services gracefully
# Sends SIGTERM (Ctrl+C) first, waits, then kills the session.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

GRACEFUL_WAIT=3
FORCE_WAIT=2

# Current architecture sessions
FAS_SESSIONS=(
  "fas-captain"
  "cc-root"
  "cc-fas"
)

echo "=========================================="
echo " FAS Captain — Stopping All Services"
echo "=========================================="
echo ""

stopped=0
skipped=0

for session in "${FAS_SESSIONS[@]}"; do
  if tmux has-session -t "$session" 2>/dev/null; then
    # Step 1: Send Ctrl+C for graceful shutdown
    tmux send-keys -t "$session" C-c 2>/dev/null || true
    echo "[FAS] Sent SIGTERM to '$session', waiting ${GRACEFUL_WAIT}s..."
    sleep "$GRACEFUL_WAIT"

    # Step 2: Kill session if still alive
    if tmux has-session -t "$session" 2>/dev/null; then
      tmux kill-session -t "$session" 2>/dev/null || true
      echo "[FAS] Killed session '$session'"
    else
      echo "[FAS] Session '$session' stopped gracefully"
    fi
    stopped=$((stopped + 1))
  else
    skipped=$((skipped + 1))
  fi
done

echo ""

# Stop n8n (Docker container)
echo "[FAS] Stopping n8n (Docker)..."
if command -v docker &>/dev/null; then
  cd "$PROJECT_ROOT" && docker-compose down 2>/dev/null || true
  echo "[FAS] n8n stopped."
else
  echo "[FAS] Docker not available, skipping n8n."
fi

# Colima: optional stop (uncomment if you want full shutdown)
# echo "[FAS] Stopping Colima..."
# colima stop 2>/dev/null || true
# echo "[FAS] Colima stopped."

echo ""
echo "[FAS] Done. Sessions stopped: $stopped, Already stopped: $skipped"

# Verify no FAS/CC sessions remain
remaining=$(tmux list-sessions 2>/dev/null | grep -cE "fas-|cc-" || true)
if [ "$remaining" -gt 0 ]; then
  echo "[FAS] WARNING: $remaining FAS session(s) still running:"
  tmux list-sessions 2>/dev/null | grep -E "fas-|cc-" || true
else
  echo "[FAS] All FAS sessions stopped."
fi
