# HomeDVR — single image: go2rtc + API + web UI
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

# --- runtime (one container) ---
FROM node:22-bookworm-slim
WORKDIR /app

ARG APP_VERSION=0.1.0
ARG GIT_SHA=dev
ARG TARGETARCH
ARG GO2RTC_VERSION=1.9.9

ENV APP_VERSION=$APP_VERSION \
    GIT_SHA=$GIT_SHA \
    NODE_ENV=production \
    PORT=8080 \
    DATABASE_PATH=/data/homedvr.db \
    GO2RTC_URL=http://127.0.0.1:1984 \
    ENABLE_WEB_UPDATE=false

# ffmpeg (for snapshot/jpeg sources), git/curl, ca-certs
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl ffmpeg git wget \
  && rm -rf /var/lib/apt/lists/*

# go2rtc binary (linux amd64 / arm64)
RUN arch="$TARGETARCH" \
  && if [ -z "$arch" ] || [ "$arch" = "amd64" ]; then arch=amd64; fi \
  && if [ "$arch" = "arm64" ]; then arch=arm64; fi \
  && if [ "$arch" = "arm" ]; then arch=arm; fi \
  && curl -fsSL -o /usr/local/bin/go2rtc \
      "https://github.com/AlexxIT/go2rtc/releases/download/v${GO2RTC_VERSION}/go2rtc_linux_${arch}" \
  && chmod +x /usr/local/bin/go2rtc \
  && go2rtc -version || true

# Optional: docker CLI for web one-click update (only if socket mounted)
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:27-cli /usr/local/libexec/docker/cli-plugins/docker-compose \
  /usr/local/lib/docker/cli-plugins/docker-compose

COPY --from=server-build /app/node_modules ./node_modules
COPY --from=server-build /app/dist ./dist
COPY --from=server-build /app/package.json ./
COPY --from=web-build /web/dist ./public
COPY go2rtc/go2rtc.example.yaml /app/go2rtc.example.yaml
COPY scripts/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && mkdir -p /data /data/go2rtc

EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/app/entrypoint.sh"]
