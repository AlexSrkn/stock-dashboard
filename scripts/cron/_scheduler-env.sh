#!/usr/bin/env bash
# Shared env for cron wrappers (minimal PATH, long DB timeouts, Node heap).
# Must be safe under `set -euo pipefail` and a near-empty cron environment.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ -z "${HOME:-}" ]]; then
  HOME="$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f6 || true)"
  HOME="${HOME:-/root}"
  export HOME
fi

PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"
if [[ -d "$HOME/.nvm/versions/node" ]]; then
  nvm_latest="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | tail -1 || true)"
  if [[ -n "$nvm_latest" && -d "$HOME/.nvm/versions/node/$nvm_latest/bin" ]]; then
    PATH="$HOME/.nvm/versions/node/$nvm_latest/bin:$PATH"
  fi
fi
export PATH

load_env_file() {
  local file="$1" line key val
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^[[:space:]]*export[[:space:]]+ ]]; then
      line="${line#*export }"
    fi
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    val="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    key="${key#"${key%%[![:space:]]*}"}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ "$val" =~ ^\".*\"$ || "$val" =~ ^\'.*\'$ ]]; then
      val="${val:1:${#val}-2}"
    fi
    export "$key=$val"
  done < "$file"
}

load_env_file "$ROOT/.env"

: "${PG_STATEMENT_TIMEOUT_MS:=600000}"
export PG_STATEMENT_TIMEOUT_MS

# Always cap cron heap on small VPS — ignore a 4096 value from .env (causes exit 137).
: "${CRON_NODE_HEAP_MB:=1536}"
export NODE_OPTIONS="--max-old-space-size=${CRON_NODE_HEAP_MB}"
