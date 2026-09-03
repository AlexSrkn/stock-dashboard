#!/usr/bin/env bash
# Install (or update) production crontab for the heavy 13F import job.
#
# Usage (on the production server, from repo root):
#   bash scripts/cron/install-13f-scrape-cron.sh
#   bash scripts/cron/install-13f-scrape-cron.sh --time 03:00 --tz Europe/Berlin
#
# Default: every day at 03:00 Europe/Berlin (after the 02:00 daily politicians/insiders job).
# Preserves other crontab entries (including TradeAtlant daily-scrape).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WRAPPER="$ROOT/scripts/cron/run-13f-scrape.sh"
BOOT_LOG="$ROOT/data/logs/cron-13f-scrape.log"
MARKER="# TradeAtlant 13f-scrape"
TIME="03:00"
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
CRON_LINE="$MIN $HOUR * * * $BASH_BIN $WRAPPER >> $BOOT_LOG 2>&1 $MARKER"

EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$EXISTING" | grep -v "$MARKER" || true)"

TMP="$(mktemp)"
{
  # Keep prior jobs; only ensure env headers once.
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
  fi
  printf '%s\n' "$FILTERED" | sed '/^$/d'
  echo "$CRON_LINE"
} >"$TMP"
crontab "$TMP"
rm -f "$TMP"

echo "Installed 13F scrape cron:"
crontab -l
echo ""
echo "Dated logs: $ROOT/data/logs/13f-scrape-YYYY-MM-DD.log"
echo "Cron stderr: $BOOT_LOG"
echo "Dry-run:    npm run job:13f-scrape:dry"
echo "Smoke test: npm run institutions:import-13f-info -- --limit-new=5 --filings=1 --minimum-quarter=2026-Q2"
echo "Full job:   bash $WRAPPER"
