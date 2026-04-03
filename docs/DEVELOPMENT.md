# DataForge -- Local Development Guide

## Prerequisites

- **Node.js** 20+ (with npm)
- **Docker** and **Docker Compose** (for PostgreSQL and Redis)

## Setup

1. **Clone the repository**

```bash
git clone https://github.com/your-org/dataforge.git
cd dataforge
```

2. **Install dependencies**

```bash
cd control-plane/backend && npm install && cd ../..
cd control-plane/frontend && npm install && cd ../..
cd worker-node/backend && npm install && cd ../..
```

3. **Create environment file**

```bash
cp .env.example .env
```

Edit `.env` and set your secrets (JWT keys, admin credentials, etc.).

4. **Start infrastructure and all services**

```bash
# Windows
.\dev.ps1

# Linux / macOS
bash dev.sh
```

The dev script will:
- Start PostgreSQL (control + worker) and Redis via Docker Compose
- Run database migrations and seed the superadmin user
- Launch the CP backend, Worker backend, and Frontend with hot-reload

## Ports

| Service             | Port  | Description                  |
|---------------------|-------|------------------------------|
| Frontend (Vite)     | 3000  | React development server     |
| CP Backend          | 4000  | Control Plane API            |
| Worker Backend      | 4001  | Worker Node API              |
| PostgreSQL (CP)     | 5432  | Control Plane database       |
| PostgreSQL (Worker) | 5433  | Worker Node database         |
| Redis               | 6379  | Shared cache and pub/sub     |
| Nginx (CP)          | 80    | Production reverse proxy     |
| Nginx (Worker)      | 8080  | Worker reverse proxy         |

## Dev Script Commands

```bash
# Start everything (default)
bash dev.sh

# Individual commands
bash dev.sh infra      # Start only Docker infrastructure
bash dev.sh migrate    # Run migrations and seed
bash dev.sh cp         # Start only CP backend
bash dev.sh wn         # Start only Worker backend
bash dev.sh fe         # Start only Frontend
bash dev.sh stop       # Stop all services
bash dev.sh status     # Check what is running
```

On Windows, use `.\dev.ps1` with the same subcommands.

## Project Structure

```
dataforge/
  control-plane/
    backend/           # CP Express API (TypeScript)
      src/
        routes/        # API route handlers
        middleware/     # Auth, RBAC, rate limiting
        services/      # Business logic
        migrations/    # Knex migrations
        seeds/         # Database seeds
      Dockerfile
    frontend/          # React + Vite + Tailwind
      src/
        pages/         # Page components
        components/    # Shared UI components
        i18n/          # Internationalization (EN + RU)
        hooks/         # Custom React hooks
        stores/        # Zustand state
      Dockerfile
    nginx.conf         # Production reverse proxy config
  worker-node/
    backend/           # Worker Express API (TypeScript)
      src/
        routes/        # Worker API route handlers
        services/      # Data operations, webhooks, cron
        migrations/    # Worker Knex migrations
      Dockerfile
    nginx.conf         # Worker reverse proxy config
  shared/              # Shared TypeScript types
  docker-compose.yml   # Full stack compose file
  dev.sh               # Linux/macOS dev launcher
  dev.ps1              # Windows dev launcher
  ecosystem.config.js  # PM2 config (optional)
  nginx.conf           # Root nginx config
```

## Running Migrations Manually

```bash
# Control Plane
cd control-plane/backend
DATABASE_URL=postgresql://dataforge:df_control_2024@localhost:5432/dataforge_control \
  node --import tsx/esm node_modules/knex/bin/cli.js migrate:latest

# Worker Node
cd worker-node/backend
DATABASE_URL=postgresql://dataforge:df_worker_2024@localhost:5433/dataforge_worker \
  node --import tsx/esm node_modules/knex/bin/cli.js migrate:latest
```

## Docker Compose (Full Stack)

To run the full production stack locally:

```bash
docker compose up -d
```

This starts all services including nginx reverse proxies. The frontend is available at `http://localhost` and the worker API at `http://localhost:8080`.
