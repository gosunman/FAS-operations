#!/usr/bin/env bash
# Show status of all FAS services on Captain
# Checks tmux sessions, Gateway health, Hunter heartbeat, disk usage

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

HEALTH_URL="http://localhost:3100/api/health"
HEALTH_TIMEOUT=2

echo "=========================================="
echo " FAS System Status"
echo "=========================================="
echo ""

# === tmux sessions ===
echo "--- tmux Sessions ---"
FAS_SESSIONS=("fas-gateway" "fas-claude" "fas-gemini-a" "fas-watchdog" "fas-n8n")
for session in "${FAS_SESSIONS[@]}"; do
  if tmux has-session -t "$session" 2>/dev/null; then
    echo "  [OK]   $session"
  else
    echo "  [DOWN] $session"
  fi
done
echo ""

# === Gateway health check ===
echo "--- Gateway (port 3100) ---"
if curl -s --max-time "$HEALTH_TIMEOUT" "$HEALTH_URL" >/dev/null 2>&1; then
  HEALTH=$(curl -s --max-time "$HEALTH_TIMEOUT" "$HEALTH_URL")
  echo "  [OK]   Online — $HEALTH"
else
  echo "  [DOWN] Offline (no response from $HEALTH_URL)"
fi
echo ""

# === Hunter heartbeat ===
echo "--- Hunter Heartbeat ---"
HEARTBEAT_FILE="$PROJECT_ROOT/state/hunter_heartbeat.json"
if [ -f "$HEARTBEAT_FILE" ]; then
  LAST_BEAT=$(stat -f "%m" "$HEARTBEAT_FILE" 2>/dev/null || stat -c "%Y" "$HEARTBEAT_FILE" 2>/dev/null || echo "0")
  NOW=$(date +%s)
  AGE=$((NOW - LAST_BEAT))
  if [ "$AGE" -lt 120 ]; then
    echo "  [OK]   Last heartbeat: ${AGE}s ago"
  else
    echo "  [WARN] Last heartbeat: ${AGE}s ago (stale, >120s)"
  fi
else
  echo "  [DOWN] No heartbeat file found"
fi
echo ""

# === Docker/n8n ===
echo "--- Docker (Colima) ---"
if command -v colima &>/dev/null && colima status 2>/dev/null | grep -q "Running"; then
  echo "  [OK]   Colima running"
  if command -v docker &>/dev/null; then
    docker ps --format "  [OK]   {{.Names}} ({{.Status}})" 2>/dev/null || echo "  [DOWN] Docker not responding"
  fi
else
  echo "  [DOWN] Colima not running"
fi
echo ""

# === Disk usage ===
echo "--- Disk Usage ---"
if [ -d "$PROJECT_ROOT/state" ]; then
  STATE_SIZE=$(du -sh "$PROJECT_ROOT/state" 2>/dev/null | cut -f1)
  echo "  state/  $STATE_SIZE"
fi
if [ -d "$PROJECT_ROOT/logs" ]; then
  LOGS_SIZE=$(du -sh "$PROJECT_ROOT/logs" 2>/dev/null | cut -f1)
  echo "  logs/   $LOGS_SIZE"
fi
TOTAL_DISK=$(df -h / | awk 'NR==2 {print $4 " available"}')
echo "  disk    $TOTAL_DISK"
echo ""

# === System resources ===
echo "--- System Resources ---"
echo "  CPU: $(sysctl -n hw.ncpu) cores"
echo "  RAM: $(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))GB total"
echo ""
echo "=========================================="
