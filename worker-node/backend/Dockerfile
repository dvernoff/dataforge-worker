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
WORKDIR /app
COPY --from=builder /app/backend/package*.json ./
RUN npm ci --production
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/migrations ./migrations
COPY --from=builder /app/shared ./shared
EXPOSE 4001
USER node
CMD ["node", "dist/index.js"]
