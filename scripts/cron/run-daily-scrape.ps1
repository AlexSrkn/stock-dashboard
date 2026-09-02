# Windows Task Scheduler wrapper for daily scrape.
# Action: powershell.exe -NoProfile -ExecutionPolicy Bypass -File "...\scripts\cron\run-daily-scrape.ps1"
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "_scheduler-env.ps1")

New-Item -ItemType Directory -Force -Path "data\logs" | Out-Null
$Log = "data\logs\daily-scrape-$(Get-Date -Format 'yyyy-MM-dd').log"
$stamp = Get-Date -Format "o"
Add-Content -Path $Log -Value "==== $stamp starting daily-scrape ====" -Encoding utf8

cmd /c "npm run job:daily-scrape >> `"$Log`" 2>&1"
$code = $LASTEXITCODE

$stamp = Get-Date -Format "o"
Add-Content -Path $Log -Value "==== $stamp finished (exit $code) ====" -Encoding utf8
exit $code
