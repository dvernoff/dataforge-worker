#!/bin/bash
# DataForge — Generate production secrets
# Usage: bash scripts/generate-secrets.sh

set -e

ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Copying .env.example to .env..."
  cp .env.example "$ENV_FILE"
fi

gen() { openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | xxd -p | tr -d '\n'; }

echo "Generating secrets..."

sed -i "s|^POSTGRES_CONTROL_PASSWORD=.*|POSTGRES_CONTROL_PASSWORD=$(gen 16)|" "$ENV_FILE"
sed -i "s|^POSTGRES_WORKER_PASSWORD=.*|POSTGRES_WORKER_PASSWORD=$(gen 16)|" "$ENV_FILE"
sed -i "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(gen 32)|" "$ENV_FILE"
sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(gen 32)|" "$ENV_FILE"
sed -i "s|^SECRETS_ENCRYPTION_KEY=.*|SECRETS_ENCRYPTION_KEY=$(gen 16)|" "$ENV_FILE"
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(gen 16)|" "$ENV_FILE"
sed -i "s|^WORKER_NODE_API_KEY=.*|WORKER_NODE_API_KEY=$(gen 32)|" "$ENV_FILE"
sed -i "s|^INTERNAL_SECRET=.*|INTERNAL_SECRET=$(gen 32)|" "$ENV_FILE"
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$(gen 16)|" "$ENV_FILE"

echo ""
echo "Secrets generated in $ENV_FILE"
echo ""
echo "You still need to set manually:"
echo "  ADMIN_EMAIL      — your admin email"
echo "  ADMIN_PASSWORD   — strong admin password"
echo "  CORS_ORIGIN      — your domain (https://yourdomain.com)"
echo ""
echo "Then run: docker compose up -d"
