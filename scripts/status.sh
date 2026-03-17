#!/usr/bin/env bash
# Show status of all FAS tmux sessions and services

set -euo pipefail

echo "=========================================="
echo " FAS System Status"
echo "=========================================="
echo ""

# === tmux sessions ===
echo "📺 tmux Sessions:"
echo "------------------------------------------"
if tmux list-sessions 2>/dev/null | grep -q "fas-"; then
  tmux list-sessions 2>/dev/null | grep "fas-" | while read -r line; do
    echo "  ✅ $line"
  done
else
  echo "  ❌ No FAS sessions running"
fi
echo ""

# === Gateway health check ===
echo "🌐 Gateway (port 3100):"
echo "------------------------------------------"
if curl -s --max-time 2 http://localhost:3100/api/health >/dev/null 2>&1; then
  HEALTH=$(curl -s --max-time 2 http://localhost:3100/api/health)
  echo "  ✅ Online - $HEALTH"
else
  echo "  ❌ Offline"
fi
echo ""

# === Docker/n8n ===
echo "🐳 Docker (Colima):"
echo "------------------------------------------"
if command -v colima &>/dev/null && colima status 2>/dev/null | grep -q "Running"; then
  echo "  ✅ Colima running"
  if command -v docker &>/dev/null; then
    docker ps --format "  📦 {{.Names}} ({{.Status}})" 2>/dev/null || echo "  ❌ Docker not responding"
  fi
else
  echo "  ❌ Colima not running"
fi
echo ""

# === System resources ===
echo "💻 System Resources:"
echo "------------------------------------------"
echo "  CPU: $(sysctl -n hw.ncpu) cores"
echo "  RAM: $(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))GB total"
echo "  Disk: $(df -h / | awk 'NR==2 {print $4 " available"}')"
echo ""
echo "=========================================="
