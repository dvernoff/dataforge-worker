FROM node:20-alpine AS builder
WORKDIR /app
COPY shared/ ./shared/
COPY control-plane/frontend/package*.json ./control-plane/frontend/
WORKDIR /app/control-plane/frontend
RUN npm ci
COPY control-plane/frontend/ .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/control-plane/frontend/dist ./dist
EXPOSE 3000
USER node
CMD ["serve", "-s", "dist", "-l", "3000"]
