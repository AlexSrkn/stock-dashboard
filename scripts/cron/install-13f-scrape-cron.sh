#!/usr/bin/env bash
# Install (or update) production crontab for the heavy 13F import job.
#
# Usage (on the production server, from repo root):
#   bash scripts/cron/install-13f-scrape-cron.sh
#   bash scripts/cron/install-13f-scrape-cron.sh --time 03:00 --tz Europe/Berlin
#   bash scripts/cron/install-13f-scrape-cron.sh --window q3-2026
#
# Default window mode q3-2026: every night at 03:00 Europe/Berlin from 1 Oct through 16 Nov
# (Q3 13F filing season). Outside that range, no cron entries fire.
#
# Preserves other crontab entries (including InvestAtlant daily-scrape).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WRAPPER="$ROOT/scripts/cron/run-13f-scrape.sh"
BOOT_LOG="$ROOT/data/logs/cron-13f-scrape.log"
MARKER="# InvestAtlant 13f-scrape"
TIME="03:00"
TZ_NAME="Europe/Berlin"
# daily | q3-2026 (Oct 1–Nov 16) | q2-2026 (Jun 30–Aug 14) | custom via --cron-spec later
WINDOW="q3-2026"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --time)
      TIME="${2:?}"
      shift 2
      ;;
    --tz)
      TZ_NAME="${2:?}"
      shift 2
      ;;
    --window)
      WINDOW="${2:?}"
      shift 2
      ;;
    --daily)
      WINDOW="daily"
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

chmod +x "$ROOT/scripts/cron/"*.sh
mkdir -p "$ROOT/data/logs"

if ! command -v crontab >/dev/null 2>&1; then
  echo "crontab not found. Install cron on the server first." >&2
  exit 1
fi

HOUR="${TIME%%:*}"
MIN="${TIME##*:}"
if [[ ! "$HOUR" =~ ^[0-9]+$ ]] || [[ ! "$MIN" =~ ^[0-9]+$ ]]; then
  echo "Invalid --time (use HH:MM, e.g. 03:00)" >&2
  exit 1
fi

BASH_BIN="$(command -v bash || echo /bin/bash)"

CRON_LINES=()
case "$WINDOW" in
  daily)
    CRON_LINES+=("$MIN $HOUR * * * $BASH_BIN $WRAPPER >> $BOOT_LOG 2>&1 $MARKER")
    ;;
  q3-2026|q3)
    # 1 Oct – 31 Oct, then 1 Nov – 16 Nov (user window for Q3 filings)
    CRON_LINES+=("$MIN $HOUR 1-31 10 * $BASH_BIN $WRAPPER >> $BOOT_LOG 2>&1 $MARKER")
    CRON_LINES+=("$MIN $HOUR 1-16 11 * $BASH_BIN $WRAPPER >> $BOOT_LOG 2>&1 $MARKER")
    ;;
  q2-2026|q2)
    # 30 Jun – 31 Jul, then 1 Aug – 14 Aug
    CRON_LINES+=("$MIN $HOUR 30-31 6 * $BASH_BIN $WRAPPER >> $BOOT_LOG 2>&1 $MARKER")
    CRON_LINES+=("$MIN $HOUR 1-31 7 * $BASH_BIN $WRAPPER >> $BOOT_LOG 2>&1 $MARKER")
    CRON_LINES+=("$MIN $HOUR 1-14 8 * $BASH_BIN $WRAPPER >> $BOOT_LOG 2>&1 $MARKER")
    ;;
  *)
    echo "Unknown --window (use daily, q3-2026, or q2-2026)" >&2
    exit 1
    ;;
esac

EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$EXISTING" | grep -v "$MARKER" || true)"

TMP="$(mktemp)"
{
  if ! printf '%s\n' "$FILTERED" | grep -q '^SHELL='; then
    echo "SHELL=$BASH_BIN"
  fi
  if ! printf '%s\n' "$FILTERED" | grep -q '^HOME='; then
    echo "HOME=${HOME:-/root}"
  fi
  if ! printf '%s\n' "$FILTERED" | grep -q '^PATH='; then
    echo "PATH=/usr/local/bin:/usr/bin:/bin"
  fi
  if ! printf '%s\n' "$FILTERED" | grep -q '^CRON_TZ='; then
    echo "CRON_TZ=$TZ_NAME"
  else
    # Refresh TZ to the requested one for consistency
    FILTERED="$(printf '%s\n' "$FILTERED" | grep -v '^CRON_TZ=')"
    echo "CRON_TZ=$TZ_NAME"
  fi
  printf '%s\n' "$FILTERED" | sed '/^$/d'
  for line in "${CRON_LINES[@]}"; do
    echo "$line"
  done
} >"$TMP"
crontab "$TMP"
rm -f "$TMP"

echo "Installed 13F scrape cron (window=$WINDOW time=$TIME tz=$TZ_NAME):"
crontab -l
echo ""
echo "Dated logs: $ROOT/data/logs/13f-scrape-YYYY-MM-DD.log"
echo "Cron stderr: $BOOT_LOG"
echo "Full run now: bash $WRAPPER"
echo "Dry-run:      npm run job:13f-scrape:dry"
