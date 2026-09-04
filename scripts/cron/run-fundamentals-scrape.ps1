# Windows Task Scheduler wrapper for SEC 10-K/10-Q fundamentals scrape.
# Action: powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "...\scripts\cron\run-fundamentals-scrape.ps1"
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "_scheduler-env.ps1")

New-Item -ItemType Directory -Force -Path "data\logs" | Out-Null
$Log = "data\logs\fundamentals-scrape-$(Get-Date -Format 'yyyy-MM-dd').log"
$stamp = Get-Date -Format "o"
Add-Content -Path $Log -Value "==== $stamp starting fundamentals-scrape ====" -Encoding utf8

$extra = if ($env:FUNDAMENTALS_SCRAPE_ARGS) { $env:FUNDAMENTALS_SCRAPE_ARGS } else { "--force" }
cmd /c "npm run job:fundamentals-scrape -- $extra >> `"$Log`" 2>&1"
$code = $LASTEXITCODE

$stamp = Get-Date -Format "o"
Add-Content -Path $Log -Value "==== $stamp finished (exit $code) ====" -Encoding utf8
exit $code
