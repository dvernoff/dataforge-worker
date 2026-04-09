FROM node:20-alpine AS builder
WORKDIR /app
COPY shared/ ./shared/
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci
COPY backend/ .
RUN npx tsc || true
RUN find src/modules/plugins/built-in -name 'manifest.json' 2>/dev/null | while read f; do \
      dest="dist/${f#src/}"; mkdir -p "$(dirname "$dest")"; cp "$f" "$dest"; \
    done || true

FROM node:20-alpine

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

RUN apk add --no-cache wget
WORKDIR /app
COPY --from=builder /app/backend/package*.json ./
RUN npm ci --production && npm install tsx
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/migrations ./migrations
COPY --from=builder /app/backend/knexfile.ts ./knexfile.ts
COPY --from=builder /app/shared ./shared
COPY backend/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:4001/api/health || exit 1

USER node
ENTRYPOINT ["sh", "entrypoint.sh"]
