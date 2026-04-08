#!/bin/bash
set -euo pipefail

# =====================================================
# DataForge Worker Node Installer
# =====================================================
# Usage:
#   curl -fsSL https://your-cp-url/scripts/install-worker.sh | bash -s -- --token=TOKEN --cp=URL
# =====================================================

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[DataForge]${NC} $1"; }
warn() { echo -e "${YELLOW}[Warning]${NC} $1"; }
err() { echo -e "${RED}[Error]${NC} $1" >&2; exit 1; }

# ── Parse arguments ──────────────────────────────────

SETUP_TOKEN=""
CP_URL=""

for arg in "$@"; do
  case "$arg" in
    --token=*) SETUP_TOKEN="${arg#*=}" ;;
    --cp=*) CP_URL="${arg#*=}" ;;
    *) warn "Unknown argument: $arg" ;;
  esac
done

if [ -z "$SETUP_TOKEN" ]; then
  err "Missing required argument: --token=<setup_token>"
fi

if [ -z "$CP_URL" ]; then
  err "Missing required argument: --cp=<control_plane_url>"
fi

log "DataForge Worker Node Installer"
log "Control Plane: $CP_URL"

# ── Check Docker ─────────────────────────────────────

if ! command -v docker &>/dev/null; then
  err "Docker is not installed. Please install Docker first: https://docs.docker.com/get-docker/"
fi

if ! command -v docker compose &>/dev/null && ! docker compose version &>/dev/null 2>&1; then
  err "Docker Compose is not available. Please install Docker Compose v2."
fi

log "Docker found: $(docker --version)"

# ── Create install directory ─────────────────────────

INSTALL_DIR="${HOME}/dataforge-worker"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

log "Installing to: $INSTALL_DIR"

# ── Generate passwords ───────────────────────────────

DB_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
WATCHTOWER_TOKEN=$(openssl rand -hex 32)

# ── Detect worker URL ────────────────────────────────

WORKER_PORT=4001
PUBLIC_IP=$(curl -fsSL https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
WORKER_URL="http://${PUBLIC_IP}:${WORKER_PORT}"

log "Detected worker URL: $WORKER_URL"

# ── Register with Control Plane ──────────────────────

log "Registering with Control Plane..."

REGISTER_RESPONSE=$(curl -fsSL -X POST "${CP_URL}/internal/node-register" \
  -H "Content-Type: application/json" \
  -d "{\"setup_token\": \"${SETUP_TOKEN}\", \"worker_url\": \"${WORKER_URL}\"}" \
  2>/dev/null) || err "Failed to register with Control Plane. Check your token and URL."

NODE_API_KEY=$(echo "$REGISTER_RESPONSE" | grep -o '"api_key":"[^"]*"' | cut -d'"' -f4)
NODE_ID=$(echo "$REGISTER_RESPONSE" | grep -o '"node_id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$NODE_API_KEY" ]; then
  err "Failed to get API key from Control Plane. Response: $REGISTER_RESPONSE"
fi

log "Registered successfully! Node ID: $NODE_ID"

# ── Write .env ───────────────────────────────────────

cat > .env <<EOF
# DataForge Worker Node
NODE_ENV=production
PORT=${WORKER_PORT}
HOST=0.0.0.0
NODE_ID=${NODE_ID}

# Database
DATABASE_URL=postgres://dataforge:${DB_PASSWORD}@postgres:5432/dataforge_worker
BCRYPT_ROUNDS=10

# Redis
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379

# Control Plane
CONTROL_PLANE_URL=${CP_URL}
NODE_API_KEY=${NODE_API_KEY}

# Security
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_SECRET}
CORS_ORIGIN=*

# Postgres
POSTGRES_USER=dataforge
POSTGRES_PASSWORD=${DB_PASSWORD}
POSTGRES_DB=dataforge_worker

# Redis password
REDIS_PASSWORD=${REDIS_PASSWORD}

# Watchtower (auto-update)
WATCHTOWER_TOKEN=${WATCHTOWER_TOKEN}
WATCHTOWER_URL=http://watchtower:8080
EOF

log "Environment file written: .env"

# ── Write docker-compose.yml ─────────────────────────

cat > docker-compose.yml <<'COMPOSE'
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  worker:
    image: ghcr.io/dvernoff/dataforge-worker:latest
    restart: unless-stopped
    ports:
      - "${PORT}:${PORT}"
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    labels:
      - "com.centurylinklabs.watchtower.enable=true"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:${PORT}/api/health"]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3

  watchtower:
    image: containrrr/watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --label-enable --http-api-update --cleanup --rolling-restart --stop-timeout 30s --interval 86400
    environment:
      - WATCHTOWER_LABEL_ENABLE=true
      - WATCHTOWER_HTTP_API_UPDATE=true
      - WATCHTOWER_HTTP_API_TOKEN=${WATCHTOWER_TOKEN}
      - WATCHTOWER_ROLLING_RESTART=true
      - WATCHTOWER_CLEANUP=true

volumes:
  pgdata:
  redisdata:
COMPOSE

log "Docker Compose file written: docker-compose.yml"

# ── Start services ───────────────────────────────────

log "Starting DataForge Worker Node..."
docker compose up -d

log ""
log "${BOLD}DataForge Worker Node is running!${NC}"
log "  Node ID:    $NODE_ID"
log "  Worker URL: $WORKER_URL"
log "  Directory:  $INSTALL_DIR"
log ""
log "Useful commands:"
log "  docker compose logs -f worker   # View logs"
log "  docker compose restart worker   # Restart"
log "  docker compose down             # Stop all"
log ""
log "Watchtower will auto-update the worker container."
