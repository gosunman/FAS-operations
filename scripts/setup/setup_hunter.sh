#!/usr/bin/env bash
# Hunter machine initial setup script
# Run this once on the hunter machine to configure the environment:
#   chmod +x scripts/setup/setup_hunter.sh && ./scripts/setup/setup_hunter.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Default values
DEFAULT_PROFILE_DIR="./fas-google-profile-hunter"
DEFAULT_CAPTAIN_URL="http://100.64.0.1:3100"

echo "=== FAS Hunter Machine Setup ==="
echo ""

# ===== Step 1: Check prerequisites =====
echo "[1/7] Checking prerequisites..."

# Check Node.js version (20+)
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is not installed. Install Node.js 20+ first."
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required (found v$NODE_VERSION). Please upgrade."
  exit 1
fi
echo "  ✓ Node.js $(node -v)"

# Check pnpm
if ! command -v pnpm &>/dev/null; then
  echo "ERROR: pnpm is not installed. Install with: npm install -g pnpm"
  exit 1
fi
echo "  ✓ pnpm $(pnpm -v)"

# Check if Playwright is available
if ! npx playwright --version &>/dev/null 2>&1; then
  echo "  ! Playwright not found — will install in next step"
else
  echo "  ✓ Playwright $(npx playwright --version 2>/dev/null)"
fi

# ===== Step 2: Install Playwright browsers =====
echo ""
echo "[2/7] Installing Playwright Chromium browser..."
cd "$PROJECT_ROOT"
pnpm install
npx playwright install chromium
echo "  ✓ Chromium installed"

# ===== Step 3: Create Google profile directory =====
echo ""
echo "[3/7] Creating Google Chrome profile directory..."
PROFILE_DIR="${GOOGLE_PROFILE_DIR:-$DEFAULT_PROFILE_DIR}"

if [ -d "$PROFILE_DIR" ]; then
  echo "  ✓ Profile directory already exists: $PROFILE_DIR"
else
  mkdir -p "$PROFILE_DIR"
  echo "  ✓ Created profile directory: $PROFILE_DIR"
fi

# ===== Step 4: Launch Chrome for manual Google login =====
echo ""
echo "[4/7] Launching Chrome for manual Google login..."
echo "  → A Chrome window will open. Please:"
echo "    1. Sign in to your Google account"
echo "    2. Visit https://gemini.google.com/ and accept any terms"
echo "    3. Visit https://notebooklm.google.com/ and accept any terms"
echo "    4. Close the browser window when done"
echo ""
echo "  Press Enter to open Chrome..."
read -r

# Find Chromium binary — try Playwright's bundled version first
CHROMIUM_PATH=$(npx playwright install --dry-run chromium 2>/dev/null | grep -o '/.*chromium.*' | head -1 || true)

if [ -z "$CHROMIUM_PATH" ] || [ ! -f "$CHROMIUM_PATH" ]; then
  # Fallback: use system Chrome/Chromium
  if command -v chromium &>/dev/null; then
    CHROMIUM_PATH="chromium"
  elif command -v google-chrome &>/dev/null; then
    CHROMIUM_PATH="google-chrome"
  elif [ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  else
    echo "  WARNING: Cannot find Chrome/Chromium binary."
    echo "  Please manually open Chrome with: chromium --user-data-dir=$PROFILE_DIR"
    CHROMIUM_PATH=""
  fi
fi

if [ -n "$CHROMIUM_PATH" ]; then
  "$CHROMIUM_PATH" --user-data-dir="$PROFILE_DIR" \
    "https://accounts.google.com" \
    "https://gemini.google.com/" \
    "https://notebooklm.google.com/" &
  CHROME_PID=$!
  echo "  Chrome launched (PID: $CHROME_PID). Close it when login is complete."
  echo "  Press Enter after closing Chrome..."
  read -r
fi

# ===== Step 5: Create .env from .env.example =====
echo ""
echo "[5/7] Setting up .env file..."
cd "$PROJECT_ROOT"

if [ -f ".env" ]; then
  echo "  ✓ .env already exists — skipping (edit manually if needed)"
else
  if [ -f ".env.example" ]; then
    cp .env.example .env
    # Set hunter-specific defaults
    sed -i.bak "s|CAPTAIN_API_URL=.*|CAPTAIN_API_URL=${DEFAULT_CAPTAIN_URL}|" .env
    sed -i.bak "s|GOOGLE_PROFILE_DIR=.*|GOOGLE_PROFILE_DIR=${PROFILE_DIR}|" .env
    sed -i.bak "s|FAS_DEVICE=.*|FAS_DEVICE=hunter|" .env
    rm -f .env.bak
    echo "  ✓ Created .env from .env.example with hunter defaults"
    echo "  → Edit .env to set CAPTAIN_API_URL to your captain's Tailscale IP"
  else
    echo "  WARNING: .env.example not found. Create .env manually."
  fi
fi

# ===== Step 6: Verify Tailscale connection =====
echo ""
echo "[6/7] Checking Tailscale connection..."

if ! command -v tailscale &>/dev/null; then
  echo "  WARNING: Tailscale not found. Install Tailscale for secure captain connection."
else
  TAILSCALE_STATUS=$(tailscale status 2>/dev/null | head -1 || echo "error")
  if echo "$TAILSCALE_STATUS" | grep -qi "logged out\|stopped\|error"; then
    echo "  WARNING: Tailscale is not connected. Run: tailscale up"
  else
    echo "  ✓ Tailscale is running"
    tailscale status 2>/dev/null | head -5
  fi
fi

# ===== Step 7: Test API connectivity =====
echo ""
echo "[7/7] Testing captain API connectivity..."

CAPTAIN_URL="${CAPTAIN_API_URL:-$DEFAULT_CAPTAIN_URL}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "${CAPTAIN_URL}/api/health" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  echo "  ✓ Captain API reachable at ${CAPTAIN_URL}"
elif [ "$HTTP_CODE" = "000" ]; then
  echo "  WARNING: Cannot reach captain at ${CAPTAIN_URL}"
  echo "  → Make sure captain is running and Tailscale is connected"
else
  echo "  WARNING: Captain returned HTTP ${HTTP_CODE}"
fi

# ===== Done =====
echo ""
echo "=== Setup Complete ==="
echo ""
echo "To start the hunter agent:"
echo "  pnpm run hunter"
echo ""
echo "If Google login expired, re-run this script or:"
echo "  chromium --user-data-dir=$PROFILE_DIR https://accounts.google.com"
