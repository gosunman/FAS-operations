#!/usr/bin/env bash
# Stop all FAS tmux sessions gracefully
# Sends SIGTERM to running processes, then kills sessions

set -euo pipefail

echo "[FAS] Stopping all FAS sessions..."

FAS_SESSIONS=("fas-gateway" "fas-watchdog" "fas-n8n" "fas-claude" "fas-gemini-a" "fas-gemini-b" "fas-crawlers")

for session in "${FAS_SESSIONS[@]}"; do
  if tmux has-session -t "$session" 2>/dev/null; then
    # Send Ctrl+C to gracefully stop running processes
    tmux send-keys -t "$session" C-c
    sleep 1
    tmux kill-session -t "$session"
    echo "[FAS] Killed session '$session'"
  fi
done

echo "[FAS] All FAS sessions stopped."
