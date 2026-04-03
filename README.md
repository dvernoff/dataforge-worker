# DataForge

Self-hosted PostgreSQL management platform with distributed architecture.

## Architecture

```
Control Plane (this repo, private)
  ├── control-plane/backend    Fastify API — auth, projects, proxy, quotas
  ├── control-plane/frontend   React SPA — admin dashboard
  └── shared/                  Shared TypeScript types

Worker Node (separate public repo)
  └── worker-node/backend      Fastify API — data CRUD, schema, SQL, webhooks, cron
```

## Quick Start

```bash
cp .env.example .env        # configure environment
docker-compose up -d        # start all services
```

## Development

```bash
# Terminal 1 — CP Backend
cd control-plane/backend && npm run dev

# Terminal 2 — CP Frontend
cd control-plane/frontend && npm run dev

# Terminal 3 — Worker Node
cd worker-node/backend && npm run dev
```

## Release

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will build Docker images and create a release.

## Stack

- **Backend:** Fastify 5, TypeScript, Knex.js, PostgreSQL, Redis
- **Frontend:** React 19, Vite, Tailwind CSS, shadcn/ui, Zustand, TanStack Query
- **Infra:** Docker, GitHub Actions, nginx
