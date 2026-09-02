#!/usr/bin/env bash
# Linux/macOS wrapper for 13F scrape (same pattern as run-daily-scrape.sh).
# Crontab example (02:00 during filing season):
#   0 2 * * * /path/to/stock-dashboard/scripts/cron/run-13f-scrape.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
mkdir -p data/logs
LOG="data/logs/13f-scrape-$(date +%Y-%m-%d).log"
echo "==== $(date -Is) starting 13f-scrape ====" | tee -a "$LOG"
npm run job:13f-scrape >>"$LOG" 2>&1
echo "==== $(date -Is) finished (exit $?) ====" | tee -a "$LOG"
