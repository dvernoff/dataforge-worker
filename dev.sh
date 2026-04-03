#!/usr/bin/env bash
# ═══════════════════════════════════════════
# DataForge — Local Development Launcher
# ═══════════════════════════════════════════
# Usage: bash dev.sh [command]
#   bash dev.sh          — Start everything
#   bash dev.sh infra    — Only Docker infra
#   bash dev.sh migrate  — Run migrations + seed
#   bash dev.sh cp       — Only CP backend
#   bash dev.sh wn       — Only Worker backend
#   bash dev.sh fe       — Only Frontend
#   bash dev.sh stop     — Stop everything
#   bash dev.sh status   — Check what's running

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
CMD="${1:-all}"

# ── Load .env ──
if [ -f "$ROOT/.env" ]; then
  set -a
  source <(grep -v '^\s*#' "$ROOT/.env" | grep -v '^\s*$' | sed 's/\r$//')
  set +a
  echo -e "\033[32m[OK] .env loaded\033[0m"
fi

# ── Derived vars ──
CP_PORT="${CP_PORT:-4000}"
WN_PORT="${WN_PORT:-4001}"
FE_PORT="${FRONTEND_PORT:-3000}"

export_cp() {
  export NODE_ENV=development
  export PORT="$CP_PORT"
  export HOST=0.0.0.0
  export DATABASE_URL="$CP_DATABASE_URL"
  export REDIS_URL="$REDIS_URL"
  export JWT_ACCESS_SECRET="$JWT_ACCESS_SECRET"
  export JWT_REFRESH_SECRET="$JWT_REFRESH_SECRET"
  export JWT_ACCESS_EXPIRES="${JWT_ACCESS_EXPIRES:-15m}"
  export JWT_REFRESH_EXPIRES="${JWT_REFRESH_EXPIRES:-7d}"
  export BCRYPT_ROUNDS="${BCRYPT_ROUNDS:-12}"
  export WORKER_NODE_API_KEY="$WORKER_NODE_API_KEY"
  export SECRETS_ENCRYPTION_KEY="$SECRETS_ENCRYPTION_KEY"
  export ADMIN_EMAIL="$ADMIN_EMAIL"
  export ADMIN_PASSWORD="$ADMIN_PASSWORD"
  export ADMIN_NAME="$ADMIN_NAME"
  export CORS_ORIGIN="http://localhost:$FE_PORT"
}

export_wn() {
  export NODE_ENV=development
  export PORT="$WN_PORT"
  export HOST=0.0.0.0
  export DATABASE_URL="$WN_DATABASE_URL"
  export REDIS_URL="$REDIS_URL"
  export NODE_API_KEY="$WORKER_NODE_API_KEY"
  export CONTROL_PLANE_URL="http://127.0.0.1:$CP_PORT"
  export NODE_ID="worker-local-1"
  export CORS_ORIGIN="*"
  export ENCRYPTION_KEY="$ENCRYPTION_KEY"
  export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
}

cmd_infra() {
  echo -e "\n\033[36m[INFRA] Starting PostgreSQL + Redis...\033[0m"
  cd "$ROOT"
  docker compose up -d postgres-control postgres-worker redis
  echo -e "\033[36m[INFRA] Waiting for healthy...\033[0m"
  sleep 5
  docker compose ps
}

cmd_migrate() {
  echo -e "\n\033[36m[MIGRATE] CP migrations...\033[0m"
  export_cp
  cd "$ROOT/control-plane/backend"
  node --import tsx/esm node_modules/knex/bin/cli.js migrate:latest 2>&1 | grep -E "Batch|Already|migration" || true

  echo -e "\033[36m[MIGRATE] CP seed...\033[0m"
  node --import tsx/esm node_modules/knex/bin/cli.js seed:run 2>&1 | grep -E "seed|Superadmin|Already" || true

  echo -e "\033[36m[MIGRATE] WN migrations...\033[0m"
  export_wn
  cd "$ROOT/worker-node/backend"
  node --import tsx/esm node_modules/knex/bin/cli.js migrate:latest 2>&1 | grep -E "Batch|Already|migration" || true

  echo -e "\033[32m[MIGRATE] Done!\033[0m"
}

cmd_cp() {
  echo -e "\n\033[33m[CP] Starting on :$CP_PORT...\033[0m"
  export_cp
  cd "$ROOT/control-plane/backend"
  npx tsx src/index.ts &
  echo $! > "$ROOT/.pid-cp"
}

cmd_wn() {
  echo -e "\n\033[35m[WN] Starting on :$WN_PORT...\033[0m"
  export_wn
  cd "$ROOT/worker-node/backend"
  npx tsx src/index.ts &
  echo $! > "$ROOT/.pid-wn"
}

cmd_fe() {
  echo -e "\n\033[34m[FE] Starting on :$FE_PORT...\033[0m"
  cd "$ROOT/control-plane/frontend"
  npx vite --port "$FE_PORT" &
  echo $! > "$ROOT/.pid-fe"
}

cmd_stop() {
  echo -e "\n\033[31m[STOP] Stopping all...\033[0m"
  for f in "$ROOT"/.pid-*; do
    if [ -f "$f" ]; then
      kill "$(cat "$f")" 2>/dev/null || true
      rm "$f"
    fi
  done
  # Fallback: kill by port
  for port in "$CP_PORT" "$WN_PORT" "$FE_PORT"; do
    pid=$(lsof -ti ":$port" 2>/dev/null || true)
    [ -n "$pid" ] && kill $pid 2>/dev/null || true
  done
  echo -e "\033[31m[STOP] Done\033[0m"
}

cmd_status() {
  echo ""
  for svc in "CP:$CP_PORT" "WN:$WN_PORT" "FE:$FE_PORT"; do
    name="${svc%%:*}"
    port="${svc##*:}"
    if curl -s "http://127.0.0.1:$port" >/dev/null 2>&1; then
      echo -e "  \033[32m● $name\033[0m  :$port"
    else
      echo -e "  \033[31m○ $name\033[0m  :$port"
    fi
  done
  echo ""
}

cmd_all() {
  cmd_infra
  sleep 3
  cmd_migrate
  sleep 2
  cmd_cp
  sleep 4
  cmd_wn
  sleep 4
  cmd_fe
  sleep 2

  echo ""
  echo -e "\033[32m═══════════════════════════════════════════\033[0m"
  echo -e "\033[32m  DataForge is running!\033[0m"
  echo -e "\033[32m═══════════════════════════════════════════\033[0m"
  echo ""
  echo -e "  Frontend:   \033[1mhttp://localhost:$FE_PORT\033[0m"
  echo -e "  CP Backend: \033[1mhttp://localhost:$CP_PORT\033[0m"
  echo -e "  WN Backend: \033[1mhttp://localhost:$WN_PORT\033[0m"
  echo ""
  echo -e "  Login: $ADMIN_EMAIL / $ADMIN_PASSWORD"
  echo ""
  echo -e "  Stop:  \033[90mbash dev.sh stop\033[0m"
  echo -e "\033[32m═══════════════════════════════════════════\033[0m"
}

# ── Dispatch ──
case "$CMD" in
  infra)   cmd_infra ;;
  migrate) cmd_migrate ;;
  cp)      cmd_cp ;;
  wn)      cmd_wn ;;
  fe)      cmd_fe ;;
  stop)    cmd_stop ;;
  status)  cmd_status ;;
  all)     cmd_all ;;
  *)
    echo "Usage: bash dev.sh [all|infra|migrate|cp|wn|fe|stop|status]"
    ;;
esac
