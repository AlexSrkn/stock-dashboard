#!/usr/bin/env bash
# Linux/macOS wrapper for midnight daily scrape.
# Crontab example (00:05 local):
#   5 0 * * * /path/to/stock-dashboard/scripts/cron/run-daily-scrape.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
mkdir -p data/logs
LOG="data/logs/daily-scrape-$(date +%Y-%m-%d).log"
echo "==== $(date -Is) starting daily-scrape ====" | tee -a "$LOG"
npm run job:daily-scrape >>"$LOG" 2>&1
echo "==== $(date -Is) finished (exit $?) ====" | tee -a "$LOG"
