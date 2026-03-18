#!/usr/bin/env bash
# FAS Environment Loader — Shared helper for loading .env
# Usage: source scripts/env_loader.sh
#
# Exports all variables from .env file at PROJECT_ROOT.
# Skips comments (#) and empty lines.
# Does NOT override already-set variables (safe to source multiple times).

# Resolve PROJECT_ROOT from this script's location
ENV_LOADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$ENV_LOADER_DIR/.." && pwd)}"
export PROJECT_ROOT

ENV_FILE="${PROJECT_ROOT}/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "[env_loader] WARNING: .env file not found at $ENV_FILE"
  return 0 2>/dev/null || exit 0
fi

# Read .env and export variables
while IFS= read -r line || [ -n "$line" ]; do
  # Skip empty lines and comments
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue

  # Strip inline comments (but preserve values with # in quotes)
  # Only handle simple KEY=VALUE format
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"

    # Remove surrounding quotes if present
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"

    # Only export if not already set (no-clobber)
    if [ -z "${!key+x}" ]; then
      export "$key=$value"
    fi
  fi
done < "$ENV_FILE"
