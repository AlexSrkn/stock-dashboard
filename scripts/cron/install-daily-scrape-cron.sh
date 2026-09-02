#!/usr/bin/env bash
# Install (or update) production crontab for nightly politicians + insiders scrape.
#
# Usage (on the production server, from repo root):
#   bash scripts/cron/install-daily-scrape-cron.sh
#   bash scripts/cron/install-daily-scrape-cron.sh --time 02:00 --tz Europe/Berlin
#
# Default: every day at 02:00 in Europe/Berlin (CEST/CET).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WRAPPER="$ROOT/scripts/cron/run-daily-scrape.sh"
MARKER="# TradeAtlant daily-scrape"
TIME="02:00"
TZ_NAME="Europe/Berlin"

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
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -x "$WRAPPER" ]]; then
  chmod +x "$ROOT/scripts/cron/"*.sh
fi

if ! command -v crontab >/dev/null 2>&1; then
  echo "crontab not found. Install cron on the server first." >&2
  exit 1
fi

HOUR="${TIME%%:*}"
MIN="${TIME##*:}"
if [[ ! "$HOUR" =~ ^[0-9]+$ ]] || [[ ! "$MIN" =~ ^[0-9]+$ ]]; then
  echo "Invalid --time (use HH:MM, e.g. 02:00)" >&2
  exit 1
fi

CRON_LINE="$MIN $HOUR * * * $WRAPPER $MARKER"
TZ_LINE="CRON_TZ=$TZ_NAME"

TMP="$(mktemp)"
{
  crontab -l 2>/dev/null | grep -v "$MARKER" | grep -v '^CRON_TZ=' || true
  echo "$TZ_LINE"
  echo "$CRON_LINE"
} >"$TMP"
crontab "$TMP"
rm -f "$TMP"

echo "Installed daily scrape cron:"
echo "  $TZ_LINE"
echo "  $CRON_LINE"
echo ""
echo "Logs: $ROOT/data/logs/daily-scrape-YYYY-MM-DD.log"
echo "Test now: $WRAPPER"
