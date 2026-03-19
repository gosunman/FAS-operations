#!/bin/bash
# Auto-VNC Restorer — opens Screen Sharing to Hunter for login resolution
# Triggered when Hunter reports [LOGIN_REQUIRED] (e.g., Google login wall)
# Usage: ./scripts/resolve_hunter_login.sh [hunter-hostname]

HUNTER_HOST="${1:-${HUNTER_TAILSCALE_HOST:-hunter}}"

# Check if already connected
if pgrep -f "Screen Sharing.*${HUNTER_HOST}" > /dev/null 2>&1; then
  echo "✅ Screen Sharing already connected to ${HUNTER_HOST}"
  exit 0
fi

echo "🔗 Opening Screen Sharing to ${HUNTER_HOST}..."
open "vnc://${HUNTER_HOST}"

# Wait briefly and verify
sleep 2
if pgrep -f "Screen Sharing" > /dev/null 2>&1; then
  echo "✅ Screen Sharing opened. Resolve the Google login on the Hunter's Chrome browser."
  echo "   After login, the Hunter will automatically resume task execution."
else
  echo "❌ Failed to open Screen Sharing. Try manually: open vnc://${HUNTER_HOST}"
  exit 1
fi
