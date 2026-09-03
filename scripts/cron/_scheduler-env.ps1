# Task Scheduler runs with a minimal PATH — ensure Node/npm are available.
$script:JobRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $script:JobRoot

$nodeDir = "C:\Program Files\nodejs"
if (Test-Path $nodeDir) {
  $env:PATH = "$nodeDir;$env:PATH"
}

# 13F ingest can wait on DB locks; default pool timeout (120s) is too short.
if (-not $env:PG_STATEMENT_TIMEOUT_MS) {
  $env:PG_STATEMENT_TIMEOUT_MS = "600000"
}

# Bulk jobs on a 4GB VPS: keep heap well under RAM so Postgres + the app survive.
if (-not $env:NODE_OPTIONS) {
  $env:NODE_OPTIONS = "--max-old-space-size=1536"
}
