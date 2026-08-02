#!/usr/bin/env bash
# HomeDVR one-click update — ONLY entrypoint allowed from the web UI.
# Never accepts user-supplied shell. Protects data/ and .env.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[update] repo: $ROOT"
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
  echo "[update] ERROR: no upstream branch configured (git branch -u origin/main)"
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

# Refuse non-fast-forward
if ! git merge-base --is-ancestor HEAD "$UPSTREAM"; then
  echo "[update] ERROR: local and remote have diverged. Resolve manually via SSH."
  exit 1
fi

echo "[update] git pull --ff-only..."
git pull --ff-only

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "[update] ERROR: docker compose not found in container/host"
    exit 1
  fi
}

echo "[update] docker compose build..."
compose build

echo "[update] docker compose up -d..."
compose up -d

echo "[update] done at commit $(git rev-parse --short HEAD)"
echo "[update] data/ and .env were not modified by this script"
