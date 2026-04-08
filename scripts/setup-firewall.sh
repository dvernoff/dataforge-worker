#!/bin/bash
# DataForge — Firewall setup (UFW)
# Usage: sudo bash scripts/setup-firewall.sh

set -e

if [ "$EUID" -ne 0 ]; then
  echo "Run with sudo: sudo bash scripts/setup-firewall.sh"
  exit 1
fi

echo "=== DataForge Firewall Setup ==="
echo ""

apt-get update -qq && apt-get install -y -qq ufw > /dev/null 2>&1

echo "[1/5] Setting defaults..."
ufw default deny incoming
ufw default allow outgoing

echo "[2/5] Allowing SSH (port 22)..."
ufw allow 22/tcp comment 'SSH'

echo "[3/5] Allowing HTTP (port 80)..."
ufw allow 80/tcp comment 'HTTP'

echo "[4/5] Allowing HTTPS (port 443)..."
ufw allow 443/tcp comment 'HTTPS'

echo "[5/5] Enabling UFW..."
echo "y" | ufw enable

echo ""
echo "=== Firewall configured ==="
ufw status verbose

echo ""
echo "Blocked ports (internal Docker services):"
echo "  5432  - PostgreSQL Control"
echo "  5433  - PostgreSQL Worker"
echo "  6379  - Redis"
echo "  4000  - CP Backend"
echo "  4001  - Worker Backend"
echo "  3000  - Frontend"
echo ""
echo "To also prevent Docker from bypassing UFW, run:"
echo "  echo '{\"iptables\": false}' | sudo tee /etc/docker/daemon.json"
echo "  sudo systemctl restart docker"
echo "  docker compose up -d"
