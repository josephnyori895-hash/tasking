#!/usr/bin/env bash
# Verifier entrypoint for task_0001-vibe-ball-roll-maze-create-a-simple-3d-b-vibe-ball-roll-. Runs the behavioral test via
# run_script.sh, then translates parser.py's verdict into a reward at
# $SAND_LOG_DIR/reward.txt (1 = pass, 0 = fail).
set -u
LOG_DIR="${SAND_LOG_DIR:-/logs/verifier}"; mkdir -p "$LOG_DIR" "${SAND_ARTIFACTS_DIR:-/logs/artifacts}"
REWARD="$LOG_DIR/reward.txt"
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$THIS_DIR/run_script.sh" || true
if SAND_LOG_DIR="$LOG_DIR" python3 "$THIS_DIR/parser.py"; then echo 1 > "$REWARD"; else echo 0 > "$REWARD"; fi
echo "[test.sh] reward = $(cat "$REWARD")"
exit 0
