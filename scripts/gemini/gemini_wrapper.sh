#!/usr/bin/env bash
# FAS Gemini CLI Wrapper — Auto-restart on crash
# Usage: gemini_wrapper.sh <account: a|b>
#
# Based on agent_wrapper.sh pattern:
#   - Restarts up to MAX_RETRIES times on crash
#   - Exponential backoff between retries
#   - Logs crash events
#   - Escalates to [GEMINI_BLOCKED] after max retries (detected by output_watcher)

set -euo pipefail

MAX_RETRIES="${FAS_MAX_RETRIES:-3}"
BASE_DELAY="${FAS_RETRY_DELAY:-5}"
LOG_DIR="${FAS_LOG_DIR:-$HOME/FAS-operations/logs}"

if [ $# -eq 0 ]; then
  echo "Usage: gemini_wrapper.sh <account: a|b>"
  exit 1
fi

ACCOUNT="$1"
AGENT_NAME="gemini-${ACCOUNT}"
RETRY_COUNT=0

mkdir -p "$LOG_DIR"

# Account-specific environment
if [ "$ACCOUNT" = "b" ]; then
  export GEMINI_CONFIG_DIR="$HOME/.gemini-b"
  echo "[Wrapper] Using alternate config: $GEMINI_CONFIG_DIR"
fi

# System prompt based on account role
if [ "$ACCOUNT" = "a" ]; then
  ROLE="research"
  SYSTEM_PROMPT="You are the FAS research agent. Your role is to search the web, analyze trends, and gather information for the Captain. Always respond with structured, factual data. Use JSON format when possible."
else
  ROLE="verification"
  SYSTEM_PROMPT="You are the FAS verification agent. Your role is to cross-check facts, verify claims, and validate outputs from other AI agents. Be critical and thorough. Flag any inconsistencies."
fi

echo "[Wrapper] Starting Gemini CLI: account=$ACCOUNT, role=$ROLE"
echo "[Wrapper] Max retries: $MAX_RETRIES, Base delay: ${BASE_DELAY}s"

while true; do
  START_TIME=$(date +%s)

  # Run Gemini CLI in interactive mode
  set +e
  gemini --system-prompt "$SYSTEM_PROMPT"
  EXIT_CODE=$?
  set -e

  END_TIME=$(date +%s)
  RUNTIME=$((END_TIME - START_TIME))

  # If it ran for more than 60 seconds, reset retry counter
  if [ "$RUNTIME" -gt 60 ]; then
    RETRY_COUNT=0
  fi

  RETRY_COUNT=$((RETRY_COUNT + 1))
  TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

  echo "[$TIMESTAMP] [Wrapper] Gemini '$AGENT_NAME' exited with code $EXIT_CODE after ${RUNTIME}s (attempt $RETRY_COUNT/$MAX_RETRIES)"

  # Log crash
  echo "$TIMESTAMP exit_code=$EXIT_CODE runtime=${RUNTIME}s attempt=$RETRY_COUNT role=$ROLE" >> "$LOG_DIR/crashes_${AGENT_NAME}.log"

  # Check max retries
  if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
    echo "[GEMINI_BLOCKED] Gemini '$AGENT_NAME' crashed $MAX_RETRIES times in succession. Manual intervention needed."
    echo "$TIMESTAMP [GEMINI_BLOCKED] $AGENT_NAME exceeded max retries ($MAX_RETRIES)" >> "$LOG_DIR/crashes_${AGENT_NAME}.log"

    echo "[Wrapper] Waiting 300 seconds before final retry..."
    sleep 300
    RETRY_COUNT=0
  fi

  # Exponential backoff: base * 2^(retry-1)
  DELAY=$((BASE_DELAY * (1 << (RETRY_COUNT - 1))))
  echo "[Wrapper] Restarting in ${DELAY}s..."
  sleep "$DELAY"
done
