#!/usr/bin/env bash
# Linux production wrapper for fundamentals scrape.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/_scheduler-env.sh"

mkdir -p data/logs
LOG="data/logs/fundamentals-scrape-$(date +%Y-%m-%d).log"
echo "==== $(date -Is) starting fundamentals-scrape ====" | tee -a "$LOG"
npm run job:fundamentals-scrape >>"$LOG" 2>&1
code=$?
echo "==== $(date -Is) finished (exit $code) ====" | tee -a "$LOG"
exit "$code"
