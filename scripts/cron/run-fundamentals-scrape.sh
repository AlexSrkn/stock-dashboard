#!/usr/bin/env bash
# Linux/macOS wrapper for SEC 10-K/10-Q fundamentals scrape.
# Crontab example (03:00 nightly):
#   0 3 * * * /path/to/stock-dashboard/scripts/cron/run-fundamentals-scrape.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
export PG_STATEMENT_TIMEOUT_MS="${PG_STATEMENT_TIMEOUT_MS:-600000}"
mkdir -p data/logs
LOG="data/logs/fundamentals-scrape-$(date +%Y-%m-%d).log"
echo "==== $(date -Is) starting fundamentals-scrape ====" | tee -a "$LOG"
npm run job:fundamentals-scrape >>"$LOG" 2>&1
echo "==== $(date -Is) finished (exit $?) ====" | tee -a "$LOG"
