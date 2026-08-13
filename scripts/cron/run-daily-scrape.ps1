# Windows Task Scheduler wrapper for midnight daily scrape.
# Action: powershell.exe -NoProfile -ExecutionPolicy Bypass -File "...\scripts\cron\run-daily-scrape.ps1"
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root
New-Item -ItemType Directory -Force -Path "data\logs" | Out-Null
$Log = "data\logs\daily-scrape-$(Get-Date -Format 'yyyy-MM-dd').log"
$stamp = Get-Date -Format "o"
Add-Content -Path $Log -Value "==== $stamp starting daily-scrape ===="
npm run job:daily-scrape *>> $Log
$code = $LASTEXITCODE
$stamp = Get-Date -Format "o"
Add-Content -Path $Log -Value "==== $stamp finished (exit $code) ===="
exit $code
