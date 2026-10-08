$ErrorActionPreference = 'Continue'
$src = "C:\Users\angel0k\Downloads\freebuff-main"
$dst = "C:\Program Files\Freebuff"

Write-Host "Copying Freebuff to $dst..." -ForegroundColor Cyan
if (!(Test-Path $dst)) {
    New-Item -ItemType Directory -Path $dst -Force | Out-Null
}

robocopy $src $dst /E /R:1 /W:1 /NFL /NDL /NP /XD .git

Write-Host "Setting folder permissions..." -ForegroundColor Cyan
icacls $dst /grant Users:(OI)(CI)F /T /Q

Write-Host "Creating FREEbuff.cmd..." -ForegroundColor Cyan
$cmdContent = @"
@echo off
setlocal
set FREEBUFF_MODE=true
bun "%~dp0cli\src\entry.ts" --cwd "%CD%" %*
"@
[System.IO.File]::WriteAllText("$dst\FREEbuff.cmd", $cmdContent)
[System.IO.File]::WriteAllText("$dst\freebuff.cmd", $cmdContent)

Write-Host "Installation to Program Files completed successfully!" -ForegroundColor Green
Start-Sleep -Seconds 2
