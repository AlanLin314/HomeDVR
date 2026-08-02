#!/usr/bin/env bash
# Resolve the HOST filesystem path of this HomeDVR install.
# Required when running "docker compose" via docker.sock FROM INSIDE the container:
# relative mounts like ./data are resolved on the host and would point at the wrong place.
#
# shellcheck disable=SC2034
set_homedvr_host_path() {
  if [[ -n "${HOMEDVR_HOST_PATH:-}" ]]; then
    echo "[host-path] using env HOMEDVR_HOST_PATH=$HOMEDVR_HOST_PATH"
    return 0
  fi

  local src=""
  if command -v docker >/dev/null 2>&1; then
    # Prefer the running container's bind mounts (most reliable)
    src="$(docker inspect homedvr --format '{{range .Mounts}}{{if eq .Destination "/repo"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
    if [[ -z "$src" ]]; then
      src="$(docker inspect homedvr --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
      if [[ -n "$src" ]]; then
        # /data is usually $HOST_REPO/data
        src="$(dirname "$src")"
      fi
    fi
  fi

  if [[ -z "$src" && -f /proc/self/mountinfo ]]; then
    # Fallback: parse where /repo is mounted from
    src="$(awk '$5=="/repo" {print $4; exit}' /proc/self/mountinfo 2>/dev/null || true)"
    # mountinfo source can be like /root/HomeDVR — good
  fi

  if [[ -z "$src" ]]; then
    # Running on the host in the git checkout
    local here
    here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    if [[ -f "$here/docker-compose.yml" ]]; then
      src="$here"
    fi
  fi

  if [[ -z "$src" ]]; then
    echo "[host-path] ERROR: cannot resolve host install path."
    echo "[host-path] Set HOMEDVR_HOST_PATH in .env (e.g. /root/HomeDVR) and recreate container."
    return 1
  fi

  export HOMEDVR_HOST_PATH="$src"
  echo "[host-path] HOMEDVR_HOST_PATH=$HOMEDVR_HOST_PATH"
  return 0
}
