#!/usr/bin/env bash
# FAS Gemini CLI Wrapper — Auto-restart with exponential backoff
# Usage: GEMINI_ACCOUNT=A|B bash scripts/gemini_wrapper.sh
#
# This is the top-level entry point for launchd plists.
# Delegates to scripts/gemini/gemini_wrapper.sh with the correct account arg.
#
# Features:
#   - Reads GEMINI_ACCOUNT env var (A or B)
#   - Forwards to the actual gemini wrapper script
#   - Provides a stable path for launchd plist references

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACCOUNT="${GEMINI_ACCOUNT:-A}"

# Normalize to lowercase for the inner wrapper
ACCOUNT_LOWER=$(echo "$ACCOUNT" | tr '[:upper:]' '[:lower:]')

exec bash "${SCRIPT_DIR}/gemini/gemini_wrapper.sh" "$ACCOUNT_LOWER"
