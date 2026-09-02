# Windows Task Scheduler wrapper for 13F scrape (same pattern as run-daily-scrape.ps1).
# Action: powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "...\scripts\cron\run-13f-scrape.ps1"
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "_scheduler-env.ps1")

New-Item -ItemType Directory -Force -Path "data\logs" | Out-Null
$Log = "data\logs\13f-scrape-$(Get-Date -Format 'yyyy-MM-dd').log"
$stamp = Get-Date -Format "o"
Add-Content -Path $Log -Value "==== $stamp starting 13f-scrape ====" -Encoding utf8

cmd /c "npm run job:13f-scrape >> `"$Log`" 2>&1"
$code = $LASTEXITCODE

$stamp = Get-Date -Format "o"
Add-Content -Path $Log -Value "==== $stamp finished (exit $code) ====" -Encoding utf8
exit $code
