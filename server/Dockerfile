# --- build web ---
FROM node:22-bookworm-slim AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# --- build server ---
FROM node:22-bookworm-slim AS server-build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json* ./
RUN npm install
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# --- runtime ---
FROM node:22-bookworm-slim
WORKDIR /app

ARG APP_VERSION=0.1.0
ARG GIT_SHA=dev
ENV APP_VERSION=$APP_VERSION \
    GIT_SHA=$GIT_SHA \
    NODE_ENV=production \
    PORT=3000

# git for update scripts; docker CLI for compose rebuild (socket mounted at runtime)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
# compose v2 plugin for scripts/update.sh
COPY --from=docker:27-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose

COPY --from=server-build /app/node_modules ./node_modules
COPY --from=server-build /app/dist ./dist
COPY --from=server-build /app/package.json ./
COPY --from=web-build /web/dist ./public

RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "dist/index.js"]
