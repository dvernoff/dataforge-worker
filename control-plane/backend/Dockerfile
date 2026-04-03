FROM node:20-alpine AS builder
WORKDIR /app
COPY shared/ ./shared/
COPY control-plane/backend/package*.json ./control-plane/backend/
WORKDIR /app/control-plane/backend
RUN npm ci
COPY control-plane/backend/ .
WORKDIR /app/control-plane/backend
RUN npx tsc || true

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/control-plane/backend/package*.json ./
RUN npm ci --production
COPY --from=builder /app/control-plane/backend/dist ./dist
COPY --from=builder /app/control-plane/backend/migrations ./migrations
COPY --from=builder /app/control-plane/backend/seeds ./seeds
COPY --from=builder /app/shared ../shared
EXPOSE 4000
USER node
CMD ["node", "dist/control-plane/backend/src/index.js"]
