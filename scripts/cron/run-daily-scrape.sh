#!/usr/bin/env bash
# Linux production wrapper for daily scrape (politicians, insiders, conditional 13F, warms).
# Scheduled via scripts/cron/install-daily-scrape-cron.sh (default 02:00 Europe/Berlin).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$ROOT/data/logs"
LOG="$ROOT/data/logs/daily-scrape-$(date +%Y-%m-%d).log"

{
  echo "==== $(date -Is) starting daily-scrape ===="
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
npm run job:daily-scrape >>"$LOG" 2>&1
code=$?
set -e
echo "==== $(date -Is) finished (exit $code) ====" | tee -a "$LOG"
exit "$code"
