@echo off
setlocal
set FREEBUFF_MODE=true
bun "%~dp0cli\src\entry.ts" --cwd "%CD%" %*
