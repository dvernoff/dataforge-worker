#!/bin/sh
set -e

echo "[DataForge] Running database migrations..."
npx knex migrate:latest --knexfile knexfile.ts 2>&1 || {
  echo "[DataForge] Migration failed, exiting..."
  exit 1
}
echo "[DataForge] Migrations complete."

echo "[DataForge] Starting worker..."
exec node dist/index.js
