#!/usr/bin/env bash
# HomeDVR one-click update
#
# Runs inside the homedvr container, but BUILD + RECREATE must run in a
# SEPARATE helper container. If we recreate ourselves mid-script, the
# process is killed and update appears to "fail" / never recreate.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=host-path.sh
source "$(dirname "$0")/host-path.sh"
set_homedvr_host_path

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-homedvr}"
export HOMEDVR_HOST_PATH

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
  export HOMEDVR_HOST_PATH
  export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-homedvr}"
fi

echo "[update] repo (container view): $ROOT"
echo "[update] host path: $HOMEDVR_HOST_PATH"
echo "[update] $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ ! -d .git ]]; then
  echo "[update] ERROR: not a git repository: $ROOT"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "[update] WARNING: working tree has local changes:"
  git status --short
  echo "[update] continuing with git pull --ff-only (may fail if conflicts)"
fi

echo "[update] fetching..."
git fetch --all --prune

UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true)"
if [[ -z "$UPSTREAM" ]]; then
  # Common default
  if git show-ref --verify --quiet refs/remotes/origin/master; then
    git branch -u origin/master 2>/dev/null || true
    UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true)"
  elif git show-ref --verify --quiet refs/remotes/origin/main; then
    git branch -u origin/main 2>/dev/null || true
    UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true)"
  fi
fi

if [[ -z "$UPSTREAM" ]]; then
  echo "[update] ERROR: no upstream branch (set: git branch -u origin/master)"
  exit 1
fi

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "$UPSTREAM")"
echo "[update] local:  $LOCAL"
echo "[update] remote: $REMOTE ($UPSTREAM)"

if [[ "$LOCAL" != "$REMOTE" ]]; then
  if ! git merge-base --is-ancestor HEAD "$UPSTREAM"; then
    echo "[update] ERROR: local and remote have diverged. Fix via SSH."
    exit 1
  fi
  echo "[update] git pull --ff-only..."
  git pull --ff-only
else
  echo "[update] code already up to date — still rebuild + restart same container"
fi

NEW_SHA="$(git rev-parse --short HEAD)"
NEW_MSG="$(git log -1 --pretty=%s | tr '\n\r' ' ' || true)"
export GIT_SHA="$NEW_SHA"
export GIT_MESSAGE="$NEW_MSG"
echo "[update] code at $NEW_SHA — $NEW_MSG"

# Why a short-lived helper?
# App code is baked into the image. After git pull we must rebuild the image
# and restart the SAME container (name=homedvr). That cannot run inside the
# container being replaced — so a temporary helper does: build → up -d.
# data/ stays on the host bind mount; we do NOT create a second DVR.

UPDATER_IMAGE="${HOMEDVR_UPDATER_IMAGE:-docker:27-cli}"
docker pull "$UPDATER_IMAGE" >/dev/null 2>&1 || true
docker rm -f homedvr-updater 2>/dev/null || true

echo "[update] queue rebuild + restart of container 'homedvr' (same name, same data)..."
docker run -d \
  --name homedvr-updater \
  --restart "no" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${HOMEDVR_HOST_PATH}:${HOMEDVR_HOST_PATH}" \
  -w "${HOMEDVR_HOST_PATH}" \
  -e "HOMEDVR_HOST_PATH=${HOMEDVR_HOST_PATH}" \
  -e "COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}" \
  -e "GIT_SHA=${NEW_SHA}" \
  -e "GIT_MESSAGE=${NEW_MSG}" \
  -e "APP_VERSION=${APP_VERSION:-0.1.0}" \
  "$UPDATER_IMAGE" \
  sh -c '
    set -eux
    sleep 2
    export HOMEDVR_HOST_PATH COMPOSE_PROJECT_NAME GIT_SHA GIT_MESSAGE APP_VERSION
    # Rebuild image, then restart the same service (compose replaces container if image changed)
    docker compose --project-name "$COMPOSE_PROJECT_NAME" build \
      --build-arg "GIT_SHA=${GIT_SHA}" \
      --build-arg "APP_VERSION=${APP_VERSION:-0.1.0}" \
      homedvr
    docker compose --project-name "$COMPOSE_PROJECT_NAME" up -d \
      --build \
      --remove-orphans \
      --no-deps \
      --force-recreate \
      homedvr
    docker ps --filter name=^homedvr$ --format "{{.Names}} {{.Status}}"
    docker rm -f homedvr-updater >/dev/null 2>&1 || true
  '

echo "[update] done queueing — same container name, data kept"
echo "[update] refresh page in 1–3 minutes"
echo "[update] commit $NEW_SHA"
exit 0
