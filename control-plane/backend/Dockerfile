FROM node:20-alpine AS builder
WORKDIR /app
COPY shared/ ./shared/
COPY control-plane/backend/ ./control-plane/backend/
WORKDIR /app/control-plane/backend
RUN npm ci && npx tsc || true

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/control-plane/backend/package*.json ./
RUN npm ci --production && npm install tsx
COPY --from=builder /app/control-plane/backend/dist ./dist
COPY --from=builder /app/control-plane/backend/migrations ./migrations
COPY --from=builder /app/control-plane/backend/seeds ./seeds
COPY --from=builder /app/control-plane/backend/knexfile.ts ./knexfile.ts
COPY --from=builder /app/shared ../shared
COPY control-plane/backend/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh
EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

USER node
ENTRYPOINT ["sh", "entrypoint.sh"]
