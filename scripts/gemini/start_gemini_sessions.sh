#!/usr/bin/env bash
# FAS Gemini CLI Session Starter
# Creates tmux sessions for Gemini CLI accounts A and B
# Usage: ./start_gemini_sessions.sh [a|b|all]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAS_ROOT="${SCRIPT_DIR}/../.."
WRAPPER="${SCRIPT_DIR}/gemini_wrapper.sh"
LOG_DIR="${FAS_ROOT}/logs"

mkdir -p "$LOG_DIR"

start_session() {
  local account="$1"
  local session_name="fas-gemini-${account}"

  # Check if session already exists
  if tmux has-session -t "$session_name" 2>/dev/null; then
    echo "[Gemini] Session '$session_name' already exists, skipping."
    return 0
  fi

  echo "[Gemini] Starting session: $session_name (account $account)"
  tmux new-session -d -s "$session_name" \
    "bash ${WRAPPER} ${account} 2>&1 | tee -a ${LOG_DIR}/gemini-${account}.log"

  echo "[Gemini] Session '$session_name' started."
}

# Parse arguments
TARGET="${1:-all}"

case "$TARGET" in
  a)
    start_session "a"
    ;;
  b)
    start_session "b"
    ;;
  all)
    start_session "a"
    start_session "b"
    echo "[Gemini] All sessions started."
    ;;
  *)
    echo "Usage: $0 [a|b|all]"
    echo "  a   - Start account A (research) session only"
    echo "  b   - Start account B (verification) session only"
    echo "  all - Start both sessions (default)"
    exit 1
    ;;
esac
