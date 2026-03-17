#!/usr/bin/env bash
# Install and configure Colima + Docker for FAS
# Requires: Homebrew
#
# Colima provides lightweight Docker runtime on macOS (Apple Silicon native)

set -euo pipefail

echo "[FAS] Setting up Colima + Docker..."

# === 1. Install dependencies ===
if ! command -v colima &>/dev/null; then
  echo "[FAS] Installing Colima..."
  brew install colima
else
  echo "[FAS] Colima already installed: $(colima version | head -1)"
fi

if ! command -v docker &>/dev/null; then
  echo "[FAS] Installing Docker CLI + Compose..."
  brew install docker docker-compose
else
  echo "[FAS] Docker already installed: $(docker --version)"
fi

# === 2. Start Colima with optimized settings for Mac Studio ===
# CPU: 2 cores (n8n doesn't need much)
# Memory: 4GB (n8n + headroom)
# Disk: 20GB
if ! colima status 2>/dev/null | grep -q "Running"; then
  echo "[FAS] Starting Colima..."
  colima start \
    --cpu 2 \
    --memory 4 \
    --disk 20 \
    --arch aarch64 \
    --vm-type vz \
    --mount-type virtiofs
  echo "[FAS] Colima started."
else
  echo "[FAS] Colima already running."
fi

# === 3. Verify Docker ===
echo "[FAS] Docker info:"
docker info --format '  Runtime: {{.ServerVersion}}'
docker info --format '  OS: {{.OperatingSystem}}'
docker info --format '  CPUs: {{.NCPU}}'
docker info --format '  Memory: {{.MemTotal}}'

echo ""
echo "[FAS] Colima + Docker setup complete!"
echo "[FAS] To start n8n: cd $(dirname "$0")/../.. && docker compose up -d"
