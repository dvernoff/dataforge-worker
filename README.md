# DataForge Worker Node

Open-source execution engine for [DataForge](https://dataforge.pro) — handles data operations, API endpoints, webhooks, cron jobs, and more.

## What is this?

When you connect a self-hosted node to DataForge, this is the software that runs on your server. It receives proxied requests from the Control Plane and executes them against your local PostgreSQL database.

## Features

- Data CRUD with row-level security and validation
- Custom REST API builder with caching
- GraphQL auto-generation from schema
- SQL console with schema isolation
- Webhooks with HMAC signing and retry
- Cron jobs (SQL, HTTP)
- Real-time WebSocket pub/sub
- File storage (local / S3)
- Plugin system (Telegram, Discord, Email, S3, etc.)
- AI-powered SQL generation (Anthropic)

## Quick Start with Docker

```bash
docker pull ghcr.io/YOUR_ORG/dataforge-worker:latest

docker run -d \
  --name dataforge-worker \
  -p 4001:4001 \
  -e DATABASE_URL=postgresql://user:pass@localhost:5432/dataforge \
  -e REDIS_URL=redis://localhost:6379 \
  -e NODE_API_KEY=your-secret-key-min-16-chars \
  -e CONTROL_PLANE_URL=https://your-cp.dataforge.pro \
  ghcr.io/YOUR_ORG/dataforge-worker:latest
```

## Install Script

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/dataforge-worker/main/scripts/install.sh | bash
```

## Manual Setup

```bash
git clone https://github.com/YOUR_ORG/dataforge-worker.git
cd dataforge-worker/backend
cp .env.example .env       # configure
npm install
npm run migrate             # create tables
npm run dev                 # start in dev mode
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection string |
| `NODE_API_KEY` | Yes | — | Secret key for CP authentication (min 16 chars) |
| `CONTROL_PLANE_URL` | Yes | — | URL of your DataForge Control Plane |
| `NODE_ID` | No | hostname | Unique identifier for this node |
| `PORT` | No | `4001` | HTTP port |

## Updating

```bash
docker pull ghcr.io/YOUR_ORG/dataforge-worker:latest
docker-compose up -d
```

Or with specific version:
```bash
docker pull ghcr.io/YOUR_ORG/dataforge-worker:v1.2.0
```

## Stack

- Fastify 5 + TypeScript
- Knex.js + PostgreSQL
- Redis (ioredis)
- node-cron
- GraphQL
- WebSocket (@fastify/websocket)

## License

MIT
