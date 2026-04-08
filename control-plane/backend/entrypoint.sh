#!/bin/sh
set -e

echo "[DataForge] Running CP database migrations..."
node --import tsx/esm node_modules/knex/bin/cli.js migrate:latest --knexfile knexfile.ts 2>&1 || {
  echo "[DataForge] Migration failed, exiting..."
  exit 1
}
echo "[DataForge] Running CP seeds..."
node --import tsx/esm node_modules/knex/bin/cli.js seed:run --knexfile knexfile.ts 2>&1 || true
echo "[DataForge] Migrations complete."

echo "[DataForge] Starting Control Plane..."
exec node dist/control-plane/backend/src/index.js
