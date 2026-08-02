#!/usr/bin/env bash
# HomeDVR one-click update — ONLY entrypoint allowed from the web UI.
# Never accepts user-supplied shell. Protects data/ and .env.
#
# Important: when this runs INSIDE the container via docker.sock, bind mounts
# must use absolute HOST paths (HOMEDVR_HOST_PATH), otherwise compose creates
# a NEW container with an EMPTY data dir while the old one keeps the real DB.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=host-path.sh
source "$(dirname "$0")/host-path.sh"
set_homedvr_host_path

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-homedvr}"
export HOMEDVR_HOST_PATH

echo "[update] repo (container view): $ROOT"
echo "[update] host path: $HOMEDVR_HOST_PATH"
echo "[update] $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ ! -d .git ]]; then
  echo "[update] ERROR: not a git repository: $ROOT"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "[update] ERROR: working tree is dirty. Commit or stash local changes, then retry."
  git status --short
  exit 1
fi

echo "[update] fetching..."
git fetch --all --prune

UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true)"
if [[ -z "$UPSTREAM" ]]; then
  echo "[update] ERROR: no upstream branch configured (git branch -u origin/master)"
  exit 1
fi

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "$UPSTREAM")"
echo "[update] local:  $LOCAL"
echo "[update] remote: $REMOTE ($UPSTREAM)"

if [[ "$LOCAL" == "$REMOTE" ]]; then
  echo "[update] already up to date"
  exit 0
fi

if ! git merge-base --is-ancestor HEAD "$UPSTREAM"; then
  echo "[update] ERROR: local and remote have diverged. Resolve manually via SSH."
  exit 1
fi

echo "[update] git pull --ff-only..."
git pull --ff-only

compose() {
  # Always pass host path so volume binds hit the real data/ on the host
  local -a args=(
    --project-name "$COMPOSE_PROJECT_NAME"
    -f "$ROOT/docker-compose.yml"
  )
  if docker compose version >/dev/null 2>&1; then
    docker compose "${args[@]}" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "${args[@]}" "$@"
  else
    echo "[update] ERROR: docker compose not found"
    exit 1
  fi
}

echo "[update] docker compose build homedvr..."
compose build homedvr

echo "[update] recreate single container (same volumes / data)..."
# --force-recreate ensures we replace the running homedvr, not start a second one
compose up -d --force-recreate --remove-orphans homedvr

echo "[update] cleaning accidental duplicate containers..."
# Remove any other containers that look like HomeDVR but are not container_name=homedvr
docker ps -a --format '{{.ID}} {{.Names}}' | while read -r id name; do
  case "$name" in
    homedvr) ;; # keep
    *homedvr*|*HomeDVR*|*go2rtc*|*repo-api*|*repo-go2rtc*|*repo-caddy*)
      echo "[update] removing leftover: $name"
      docker rm -f "$id" >/dev/null 2>&1 || true
      ;;
  esac
done

echo "[update] verifying data mount on new container..."
DATA_SRC="$(docker inspect homedvr --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
echo "[update] /data is bind from host: ${DATA_SRC:-UNKNOWN}"
if [[ -n "$DATA_SRC" && "$DATA_SRC" != "${HOMEDVR_HOST_PATH}/data" && "$DATA_SRC" != "${HOMEDVR_HOST_PATH%/}/data" ]]; then
  echo "[update] WARNING: data path differs from expected ${HOMEDVR_HOST_PATH}/data"
  echo "[update] expected camera DB at: ${HOMEDVR_HOST_PATH}/data/homedvr.db"
fi

echo "[update] done at commit $(git rev-parse --short HEAD)"
echo "[update] data/ and .env were not deleted by this script"
