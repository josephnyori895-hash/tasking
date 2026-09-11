#!/usr/bin/env bash
# Shared boot helper for stack "game".
#
# Sourced by BOTH the task-level ./launch.sh and the verifier's
# tests/run_script.sh so the manual launch path and the verified launch path
# cannot drift (design §4.2). Defines two functions:
#
#   sand_boot          start the app process(es); export APP_URL (and friends)
#   sand_wait_healthy  poll until the app is actually reachable
#
# Callers set:  APP_DIR (path to environment/<app>), PORT, BOOT_LOG.
# Callers read: APP_URL, BACKEND_URL/FRONTEND_URL (where applicable), BOOT_PIDS.

: "${BOOT_LOG:=/tmp/sand_boot.log}"
: "${PORT:=8000}"
BOOT_PIDS="${BOOT_PIDS:-}"

sand_boot() {

  # Serve the static app directory over HTTP using only the Python stdlib.
  : "${PORT:?PORT must be set}"
  ( cd "$APP_DIR" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 ) \
    >>"$BOOT_LOG" 2>&1 &
  BOOT_PIDS="$BOOT_PIDS $!"
  export APP_URL="http://127.0.0.1:$PORT"
}

sand_wait_healthy() {

  for _i in $(seq 1 30); do
    if curl -sf -o /dev/null "$APP_URL/"; then return 0; fi
    sleep 0.5
  done
  return 1
}

sand_boot_cleanup() {
  for _pid in $BOOT_PIDS; do
    kill "$_pid" 2>/dev/null || true
  done
}
