FROM node:20-alpine AS builder
WORKDIR /app
COPY shared/ ./shared/
COPY worker-node/backend/package*.json ./worker-node/backend/
WORKDIR /app/worker-node/backend
RUN npm ci
COPY worker-node/backend/ .
RUN npx tsc
# tsc doesn't copy non-TS assets — copy manifest.json files for built-in plugins
RUN find src/modules/plugins/built-in -name 'manifest.json' | while read f; do \
      dest="dist/${f#src/}"; mkdir -p "$(dirname "$dest")"; cp "$f" "$dest"; \
    done

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/worker-node/backend/package*.json ./
RUN npm ci --production
COPY --from=builder /app/worker-node/backend/dist ./dist
COPY --from=builder /app/worker-node/backend/migrations ./migrations
EXPOSE 4001
USER node
CMD ["node", "dist/index.js"]
