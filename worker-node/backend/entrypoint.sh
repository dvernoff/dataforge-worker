#!/bin/sh
set -e

echo "[DataForge] Running database migrations..."
node --import tsx/esm node_modules/knex/bin/cli.js migrate:latest --knexfile knexfile.ts 2>&1 || {
  echo "[DataForge] Migration failed, exiting..."
  exit 1
}
echo "[DataForge] Migrations complete."

echo "[DataForge] Starting worker..."
exec node dist/index.js
