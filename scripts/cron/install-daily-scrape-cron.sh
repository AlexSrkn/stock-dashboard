#!/usr/bin/env bash
# Install (or update) production crontab for nightly politicians + insiders scrape.
#
# Usage (on the production server, from repo root):
#   bash scripts/cron/install-daily-scrape-cron.sh
#   bash scripts/cron/install-daily-scrape-cron.sh --time 02:00 --tz Europe/Berlin
#
# Default: every day at 02:00 in Europe/Berlin (CEST/CET).
# Preserves other crontab entries (including InvestAtlant 13f-scrape).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WRAPPER="$ROOT/scripts/cron/run-daily-scrape.sh"
BOOT_LOG="$ROOT/data/logs/cron-daily-scrape.log"
MARKER="# InvestAtlant daily-scrape"
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

chmod +x "$ROOT/scripts/cron/"*.sh
mkdir -p "$ROOT/data/logs"

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

BASH_BIN="$(command -v bash || echo /bin/bash)"
CRON_LINE="$MIN $HOUR * * * $BASH_BIN $WRAPPER >> $BOOT_LOG 2>&1 $MARKER"

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
  fi
  printf '%s\n' "$FILTERED" | sed '/^$/d'
  echo "$CRON_LINE"
} >"$TMP"
crontab "$TMP"
rm -f "$TMP"

echo "Installed daily scrape cron:"
crontab -l
echo ""
echo "Dated logs: $ROOT/data/logs/daily-scrape-YYYY-MM-DD.log"
echo "Cron stderr: $BOOT_LOG"
echo "Test now: $BASH_BIN $WRAPPER"
