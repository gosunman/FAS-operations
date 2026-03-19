#!/usr/bin/env bash
# Show status of all FAS services on Captain
# Checks tmux sessions, Colima, n8n, Gateway health, Hunter, disk usage

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

HEALTH_URL="http://localhost:3100/api/health"
HUNTER_STATUS_URL="http://localhost:3100/api/hunter/status"
HEALTH_TIMEOUT=2

echo "=========================================="
echo " FAS System Status"
echo "=========================================="
echo ""

# === tmux sessions ===
echo "--- tmux Sessions ---"
FAS_SESSIONS=("fas-captain" "cc-root" "cc-fas")
for session in "${FAS_SESSIONS[@]}"; do
  if tmux has-session -t "$session" 2>/dev/null; then
    echo "  [OK]   $session"
  else
    echo "  [DOWN] $session"
  fi
done
echo ""

# === Colima status ===
echo "--- Colima (Docker Runtime) ---"
if command -v colima &>/dev/null; then
  if colima status 2>/dev/null | grep -q "Running"; then
    echo "  [OK]   Colima running"
  else
    echo "  [DOWN] Colima not running"
  fi
else
  echo "  [N/A]  Colima not installed"
fi
echo ""

# === n8n status ===
echo "--- n8n (Docker Container) ---"
if command -v docker &>/dev/null; then
  n8n_status=$(docker ps --filter "name=n8n" --format "{{.Names}} ({{.Status}})" 2>/dev/null || echo "")
  if [ -n "$n8n_status" ]; then
    echo "  [OK]   $n8n_status"
  else
    echo "  [DOWN] n8n container not running"
  fi
else
  echo "  [N/A]  Docker not available"
fi
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

# === Hunter connection ===
echo "--- Hunter Connection ---"
if curl -s --max-time "$HEALTH_TIMEOUT" "$HUNTER_STATUS_URL" >/dev/null 2>&1; then
  HUNTER=$(curl -s --max-time "$HEALTH_TIMEOUT" "$HUNTER_STATUS_URL")
  echo "  [OK]   Hunter reachable — $HUNTER"
else
  # Fallback: try SSH
  if ssh -o ConnectTimeout=3 -o BatchMode=yes hunter uptime 2>/dev/null; then
    echo "  [OK]   Hunter reachable via SSH"
  else
    echo "  [DOWN] Hunter not reachable"
  fi
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
