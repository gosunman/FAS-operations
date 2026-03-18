#!/usr/bin/env bash
# Stop all FAS tmux sessions gracefully
# Sends SIGTERM (Ctrl+C) first, waits, then kills the session.

set -euo pipefail

GRACEFUL_WAIT=3
FORCE_WAIT=2

FAS_SESSIONS=(
  "fas-gateway"
  "fas-watchdog"
  "fas-n8n"
  "fas-claude"
  "fas-gemini-a"
  "fas-gemini-b"
  "fas-crawlers"
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
echo "[FAS] Done. Stopped: $stopped, Already stopped: $skipped"

# Verify no FAS sessions remain
remaining=$(tmux list-sessions 2>/dev/null | grep -c "fas-" || true)
if [ "$remaining" -gt 0 ]; then
  echo "[FAS] WARNING: $remaining FAS session(s) still running:"
  tmux list-sessions 2>/dev/null | grep "fas-" || true
else
  echo "[FAS] All FAS sessions stopped."
fi
