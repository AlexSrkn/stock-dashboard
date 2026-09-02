#!/usr/bin/env bash
# Linux production wrapper for 13F scrape.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/_scheduler-env.sh"

mkdir -p data/logs
LOG="data/logs/13f-scrape-$(date +%Y-%m-%d).log"
echo "==== $(date -Is) starting 13f-scrape ====" | tee -a "$LOG"
npm run job:13f-scrape >>"$LOG" 2>&1
code=$?
echo "==== $(date -Is) finished (exit $code) ====" | tee -a "$LOG"
exit "$code"
