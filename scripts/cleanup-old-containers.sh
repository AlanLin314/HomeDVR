#!/usr/bin/env sh
# Stop/remove old multi-container HomeDVR leftovers (api, go2rtc, caddy, …)
set -eu

echo "==> Current compose project (new = only 'homedvr')"
docker compose ls || true

echo "==> Stop this project's stack + orphans"
docker compose down --remove-orphans 2>/dev/null || true

echo "==> Force-remove known old container names"
for c in \
  homedvr \
  homedvr-tunnel \
  repo-api-1 \
  repo-go2rtc-1 \
  repo-caddy-1 \
  repo-go2rtc-init-1 \
  repo-cloudflared-1 \
  homedvr-api-1 \
  homedvr-go2rtc-1 \
  homedvr-caddy-1 \
  homedvr-go2rtc-init-1
do
  docker rm -f "$c" 2>/dev/null || true
done

echo "==> Remove any still-running containers that look like old HomeDVR services"
# labels / names containing go2rtc, caddy reverse of old stack
docker ps -a --format '{{.ID}} {{.Names}}' | while read -r id name; do
  case "$name" in
    *api*|*go2rtc*|*caddy*|*go2rtc-init*|*cloudflared*)
      # keep unrelated system containers if name is ambiguous — only drop compose-style names
      case "$name" in
        *-api-*|*-go2rtc-*|*-caddy-*|*-go2rtc-init-*|*homedvr*|*repo-*)
          echo "removing $name"
          docker rm -f "$id" 2>/dev/null || true
          ;;
      esac
      ;;
  esac
done

echo "==> Done. Remaining containers:"
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
echo ""
echo "Next: docker compose up -d --build"
