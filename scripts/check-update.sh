#!/usr/bin/env bash
# Compare local HEAD with upstream (fetch first). Prints machine-readable lines.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d .git ]]; then
  echo "error=not_a_git_repo"
  exit 1
fi

git fetch --all --prune >/dev/null 2>&1 || true

UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true)"
if [[ -z "$UPSTREAM" ]]; then
  echo "error=no_upstream"
  exit 1
fi

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "$UPSTREAM")"
BEHIND="$(git rev-list --count HEAD.."$UPSTREAM" 2>/dev/null || echo 0)"
AHEAD="$(git rev-list --count "$UPSTREAM"..HEAD 2>/dev/null || echo 0)"
DIRTY=0
if [[ -n "$(git status --porcelain)" ]]; then
  DIRTY=1
fi

# Single-line fields (strip newlines)
LOCAL_MSG="$(git log -1 --pretty=%s HEAD 2>/dev/null | tr '\n\r' '  ' || true)"
LOCAL_DATE="$(git log -1 --pretty=%cI HEAD 2>/dev/null || true)"
REMOTE_MSG="$(git log -1 --pretty=%s "$UPSTREAM" 2>/dev/null | tr '\n\r' '  ' || true)"
REMOTE_DATE="$(git log -1 --pretty=%cI "$UPSTREAM" 2>/dev/null || true)"
# Pending commits: "sha message|sha message|..."
REMOTE_COMMITS="$(
  git log --pretty=format:'%h %s' HEAD.."$UPSTREAM" 2>/dev/null \
    | head -n 20 \
    | tr '\n' '|' \
    | sed 's/|$//' \
  || true
)"

echo "local=$LOCAL"
echo "remote=$REMOTE"
echo "upstream=$UPSTREAM"
echo "behind=$BEHIND"
echo "ahead=$AHEAD"
echo "dirty=$DIRTY"
echo "local_message=$LOCAL_MSG"
echo "local_date=$LOCAL_DATE"
echo "remote_message=$REMOTE_MSG"
echo "remote_date=$REMOTE_DATE"
echo "remote_commits=$REMOTE_COMMITS"
