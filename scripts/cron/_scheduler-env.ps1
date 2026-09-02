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

# Bulk fundamentals ingest processes thousands of SEC Company Facts JSON blobs.
if (-not $env:NODE_OPTIONS) {
  $env:NODE_OPTIONS = "--max-old-space-size=4096"
}
