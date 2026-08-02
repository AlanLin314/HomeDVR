#!/usr/bin/env sh
# Single-container entrypoint: go2rtc (media) + HomeDVR API/UI
set -eu

mkdir -p /data /data/go2rtc

if [ ! -f /data/go2rtc/go2rtc.yaml ]; then
  echo "[entrypoint] creating /data/go2rtc/go2rtc.yaml"
  cp /app/go2rtc.example.yaml /data/go2rtc/go2rtc.yaml
fi
chmod 666 /data/go2rtc/go2rtc.yaml 2>/dev/null || true
chmod 777 /data/go2rtc 2>/dev/null || true

echo "[entrypoint] starting go2rtc..."
go2rtc -config /data/go2rtc/go2rtc.yaml &
GO2RTC_PID=$!

# Wait until go2rtc API answers (max ~15s)
i=0
while [ "$i" -lt 30 ]; do
  if wget -q -O /dev/null "http://127.0.0.1:1984/api/streams" 2>/dev/null \
    || curl -sf "http://127.0.0.1:1984/api/streams" >/dev/null 2>&1; then
    echo "[entrypoint] go2rtc is up"
    break
  fi
  i=$((i + 1))
  sleep 0.5
done

# If go2rtc died early, fail the container
if ! kill -0 "$GO2RTC_PID" 2>/dev/null; then
  echo "[entrypoint] ERROR: go2rtc exited unexpectedly"
  exit 1
fi

echo "[entrypoint] starting HomeDVR API on :${PORT:-8080}"
exec node /app/dist/index.js
