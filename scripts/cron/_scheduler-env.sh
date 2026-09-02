#!/usr/bin/env bash
# Shared env for cron wrappers (minimal PATH, long DB timeouts, Node heap).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

export PATH="/usr/local/bin:/usr/bin:/bin:${HOME}/.nvm/versions/node/$(ls "${HOME}/.nvm/versions/node" 2>/dev/null | tail -1)/bin:${PATH}"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

: "${PG_STATEMENT_TIMEOUT_MS:=600000}"
export PG_STATEMENT_TIMEOUT_MS

: "${NODE_OPTIONS:=--max-old-space-size=4096}"
export NODE_OPTIONS
