#!/usr/bin/env bash
# Behavioral verifier runner (OFFLINE) for task_0003-turn-00194.
#
# Shares its boot path with ./launch.sh via tests/lib/boot.sh (design §4.2):
# integrity-check repo tests, boot the app through sand_boot, seed fixtures,
# run the behavioral check, record the exit code for parser.py.
set -u

TEST_SPEC="${TEST_SPEC:-00194.spec.js}"
SEED_SCRIPT="${SEED_SCRIPT:-}"

LOG_DIR="${SAND_LOG_DIR:-/logs/verifier}"; mkdir -p "$LOG_DIR"
OUT="$LOG_DIR/test_output.txt"; : > "$OUT"
ARTIFACTS_DIR="${SAND_ARTIFACTS_DIR:-/logs/artifacts}"; mkdir -p "$ARTIFACTS_DIR"; export ARTIFACTS_DIR
log() { echo "[run_script] $*" | tee -a "$OUT"; }

TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"

APP_DIR="${APP_DIR:-}"
if [ -z "$APP_DIR" ]; then
  for d in "/app/turn-00194" "/app" "$(pwd)/turn-00194" "$(pwd)"; do
    if [ -d "$d" ]; then APP_DIR="$d"; break; fi
  done
fi
export APP_DIR
log "app:   $APP_DIR"
log "tests: $TESTS_DIR"

# --- repo test integrity (design §9) ----------------------------------------
MANIFEST="$TESTS_DIR/repo_test_manifest.sha256"
if [ -f "$MANIFEST" ] && [ -s "$MANIFEST" ]; then
  if ( cd "$APP_DIR" && sha256sum -c --quiet "$MANIFEST" ) >>"$OUT" 2>&1; then
    echo "TEST_INTEGRITY=OK" >> "$OUT"
  else
    log "ERROR: a protected repo test was modified or deleted"
    echo "TEST_INTEGRITY=FAIL" >> "$OUT"; echo "PLAYWRIGHT_EXIT=97" >> "$OUT"; exit 1
  fi
else
  echo "TEST_INTEGRITY=SKIPPED" >> "$OUT"
fi

# --- boot the app via the shared helper --------------------------------------
export PORT="${PORT:=8000}"
export BOOT_LOG="$OUT"
# shellcheck disable=SC1091
. "$TESTS_DIR/lib/boot.sh"
trap 'sand_boot_cleanup' EXIT
log "booting app (stack game) on :$PORT ..."
sand_boot
if ! sand_wait_healthy; then
  log "ERROR: app did not become reachable at ${APP_URL:-?}"; echo "PLAYWRIGHT_EXIT=91" >> "$OUT"; exit 1
fi
log "app up at $APP_URL"

# --- seed deterministic fixtures (design §8.4) -------------------------------
if [ -n "$SEED_SCRIPT" ] && [ -f "$TESTS_DIR/$SEED_SCRIPT" ]; then
  echo "===SEED_BEGIN===" >> "$OUT"
  ( cd "$APP_DIR" && APP_URL="$APP_URL" node "$TESTS_DIR/$SEED_SCRIPT" ) >> "$OUT" 2>&1
  if [ $? -eq 0 ] && grep -q "SEED_OK" "$OUT"; then echo "SEED_STATUS=OK" >> "$OUT"; else echo "SEED_STATUS=FAIL" >> "$OUT"; fi
  echo "===SEED_END===" >> "$OUT"
else
  echo "SEED_STATUS=SKIPPED" >> "$OUT"
fi

# --- Playwright behavioral spec ----------------------------------------------
if [ ! -e "$TESTS_DIR/node_modules" ] && [ -d /opt/playwright-runner/node_modules ]; then
  ln -sfn /opt/playwright-runner/node_modules "$TESTS_DIR/node_modules"
fi
PW_BIN="$TESTS_DIR/node_modules/.bin/playwright"
if [ ! -x "$PW_BIN" ]; then
  log "ERROR: Playwright binary not found at $PW_BIN"; echo "PLAYWRIGHT_EXIT=94" >> "$OUT"; exit 1
fi
PW_JSON="$LOG_DIR/playwright_results.json"; rm -f "$PW_JSON"
echo "===PLAYWRIGHT_BEGIN===" >> "$OUT"
( cd "$TESTS_DIR" \
  && APP_URL="$APP_URL" FRONTEND_URL="${FRONTEND_URL:-$APP_URL}" BACKEND_URL="${BACKEND_URL:-}" \
     PLAYWRIGHT_JSON_OUTPUT_NAME="$PW_JSON" PW_ARTIFACTS="$ARTIFACTS_DIR/pw" \
     "$PW_BIN" test "$TEST_SPEC" --reporter=list,json ) >> "$OUT" 2>&1
TEST_EXIT=$?
echo "===PLAYWRIGHT_END===" >> "$OUT"
echo "PLAYWRIGHT_EXIT=$TEST_EXIT" >> "$OUT"
[ -f "$PW_JSON" ] && echo "PLAYWRIGHT_JSON=$PW_JSON" >> "$OUT"
cp "$OUT" "$ARTIFACTS_DIR/test_output.txt" 2>/dev/null || true
cp "$PW_JSON" "$ARTIFACTS_DIR/playwright_results.json" 2>/dev/null || true
exit "$TEST_EXIT"
