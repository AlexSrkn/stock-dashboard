#!/usr/bin/env bash
# Linux production wrapper for fundamentals scrape (SEC 10-K / 10-Q).
# Uses --force so tickers that already have older periods still pick up new 10-Qs.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$ROOT/data/logs"
LOG="$ROOT/data/logs/fundamentals-scrape-$(date +%Y-%m-%d).log"

{
  echo "==== $(date -Is) starting fundamentals-scrape ===="
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

# Extra args from env or defaults: force re-ingest so Q2 10-Qs replace stale skips.
EXTRA_ARGS="${FUNDAMENTALS_SCRAPE_ARGS:---force}"

set +e
# shellcheck disable=SC2086
npm run job:fundamentals-scrape -- $EXTRA_ARGS >>"$LOG" 2>&1
code=$?
set -e
echo "==== $(date -Is) finished (exit $code) ====" | tee -a "$LOG"
exit "$code"
