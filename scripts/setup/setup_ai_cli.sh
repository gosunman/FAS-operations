#!/usr/bin/env bash
# AI CLI authentication setup guide
# This script checks auth status and guides manual setup steps

set -euo pipefail

echo "=========================================="
echo " FAS AI CLI Authentication Setup"
echo "=========================================="
echo ""

# === 1. Claude Code ===
echo "📎 [1/4] Claude Code (Captain)"
echo "------------------------------------------"
if command -v claude &>/dev/null; then
  echo "  ✅ Claude Code CLI installed"
  echo "  🔑 Auth: Run 'claude' and follow OAuth login (Max plan)"
else
  echo "  ❌ Claude Code not installed"
  echo "  📋 Install: npm install -g @anthropic-ai/claude-code"
fi
echo ""

# === 2. Gemini CLI ===
echo "🔮 [2/4] Gemini CLI (Captain — 2 accounts)"
echo "------------------------------------------"
if command -v gemini &>/dev/null; then
  echo "  ✅ Gemini CLI installed"
else
  echo "  ❌ Gemini CLI not installed"
  echo "  📋 Install: npm install -g @google/gemini-cli"
fi
echo ""
echo "  Account A (Research): Set GEMINI_API_KEY_A in .env"
echo "  Account B (Validator): Set GEMINI_API_KEY_B in .env"
echo ""
echo "  💡 Profile separation:"
echo "    - Create ~/.gemini/profile_a.json and profile_b.json"
echo "    - Each session uses GEMINI_PROFILE env var to switch"
echo ""

# === 3. OpenClaw (Hunter) ===
echo "🐱 [3/4] OpenClaw / ChatGPT Pro (Hunter)"
echo "------------------------------------------"
echo "  ⚠️  Setup on HUNTER machine (not Captain)"
echo "  📋 Steps:"
echo "    1. SSH to hunter: ssh hunter"
echo "    2. Install OpenClaw (browser automation for ChatGPT)"
echo "    3. Login with ChatGPT Pro account (isolated Google account)"
echo "    4. Verify: no personal info in hunter's environment"
echo ""

# === 4. Environment file ===
echo "📄 [4/4] Environment Variables"
echo "------------------------------------------"
if [ -f .env ]; then
  echo "  ✅ .env file exists"
  echo "  Checking required vars..."

  REQUIRED_VARS=(
    "TELEGRAM_BOT_TOKEN"
    "TELEGRAM_CHAT_ID"
    "SLACK_BOT_TOKEN"
    "GATEWAY_PORT"
  )

  for var in "${REQUIRED_VARS[@]}"; do
    if grep -q "^${var}=" .env 2>/dev/null; then
      echo "    ✅ $var is set"
    else
      echo "    ❌ $var is missing"
    fi
  done
else
  echo "  ❌ .env file not found"
  echo "  📋 Create from template: cp .env.example .env"
fi

echo ""
echo "=========================================="
echo " Manual steps required:"
echo "  1. Create Telegram bot via @BotFather"
echo "  2. Create Slack workspace + bot token"
echo "  3. Copy .env.example to .env and fill in values"
echo "  4. Run 'claude' to complete OAuth login"
echo "=========================================="
