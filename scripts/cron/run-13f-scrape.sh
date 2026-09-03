#!/usr/bin/env bash
# Linux production wrapper for 13F scrape.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$ROOT/data/logs"
LOG="$ROOT/data/logs/13f-scrape-$(date +%Y-%m-%d).log"

{
  echo "==== $(date -Is) starting 13f-scrape ===="
  echo "cwd=$ROOT user=$(id -un) home=${HOME:-unset} path=$PATH"
} | tee -a "$LOG"

# shellcheck disable=SC1091
if ! source "$(dirname "$0")/_scheduler-env.sh" >>"$LOG" 2>&1; then
  echo "==== $(date -Is) failed to load scheduler env ====" | tee -a "$LOG"
  exit 1
fi

cd "$ROOT"
if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found on PATH=$PATH" | tee -a "$LOG"
  echo "==== $(date -Is) finished (exit 127) ====" | tee -a "$LOG"
  exit 127
fi

set +e
npm run job:13f-scrape >>"$LOG" 2>&1
code=$?
set -e
echo "==== $(date -Is) finished (exit $code) ====" | tee -a "$LOG"
exit "$code"
