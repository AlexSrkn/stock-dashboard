#!/usr/bin/env bash
# Linux production wrapper for daily scrape (politicians, insiders, conditional 13F, warms).
# Scheduled via scripts/cron/install-daily-scrape-cron.sh (default 02:00 Europe/Berlin).
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/_scheduler-env.sh"

mkdir -p data/logs
LOG="data/logs/daily-scrape-$(date +%Y-%m-%d).log"
echo "==== $(date -Is) starting daily-scrape ====" | tee -a "$LOG"
npm run job:daily-scrape >>"$LOG" 2>&1
code=$?
echo "==== $(date -Is) finished (exit $code) ====" | tee -a "$LOG"
exit "$code"
