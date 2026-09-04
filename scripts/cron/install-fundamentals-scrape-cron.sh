#!/usr/bin/env bash
# Install (or update) production crontab for SEC 10-K / 10-Q fundamentals scrape.
#
# Usage (on the production server, from repo root):
#   bash scripts/cron/install-fundamentals-scrape-cron.sh
#   bash scripts/cron/install-fundamentals-scrape-cron.sh --time 04:00 --tz Europe/Berlin
#   bash scripts/cron/install-fundamentals-scrape-cron.sh --window q2-10q-2026
#   bash scripts/cron/install-fundamentals-scrape-cron.sh --daily
#
# Default window q2-10q-2026: every night at 04:00 Europe/Berlin from 30 Sep through 9 Nov
# (Q2 10-Q filing season). Outside that range, no cron entries fire.
#
# Preserves other crontab entries (daily-scrape, 13f-scrape, …).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WRAPPER="$ROOT/scripts/cron/run-fundamentals-scrape.sh"
BOOT_LOG="$ROOT/data/logs/cron-fundamentals-scrape.log"
MARKER="# TradeAtlant fundamentals-scrape"
TIME="04:00"
TZ_NAME="Europe/Berlin"
WINDOW="q2-10q-2026"

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
  echo "Invalid --time (use HH:MM, e.g. 04:00)" >&2
  exit 1
fi

BASH_BIN="$(command -v bash || echo /bin/bash)"

CRON_LINES=()
case "$WINDOW" in
  daily)
    CRON_LINES+=("$MIN $HOUR * * * $BASH_BIN $WRAPPER >> $BOOT_LOG 2>&1 $MARKER")
    ;;
  q2-10q-2026|q2-10q|10q)
    # 30 Sep, all of October, then 1–9 Nov (Q2 10-Q filing window)
    CRON_LINES+=("$MIN $HOUR 30 9 * $BASH_BIN $WRAPPER >> $BOOT_LOG 2>&1 $MARKER")
    CRON_LINES+=("$MIN $HOUR 1-31 10 * $BASH_BIN $WRAPPER >> $BOOT_LOG 2>&1 $MARKER")
    CRON_LINES+=("$MIN $HOUR 1-9 11 * $BASH_BIN $WRAPPER >> $BOOT_LOG 2>&1 $MARKER")
    ;;
  *)
    echo "Unknown --window (use daily or q2-10q-2026)" >&2
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

echo "Installed fundamentals scrape cron (window=$WINDOW time=$TIME tz=$TZ_NAME):"
crontab -l
echo ""
echo "Dated logs: $ROOT/data/logs/fundamentals-scrape-YYYY-MM-dd.log"
echo "Cron stderr: $BOOT_LOG"
echo "Full run now: bash $WRAPPER"
echo "Or:           npm run job:fundamentals-scrape -- --force"
