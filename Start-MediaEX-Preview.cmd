@echo off
setlocal
set NEXT_TELEMETRY_DISABLED=1
cd /d "%~dp0"
title MediaEX local preview
echo Keep this window open while reviewing MediaEX.
echo Preview: http://127.0.0.1:3418/#features
node node_modules\next\dist\bin\next dev --hostname 127.0.0.1 --port 3418
if errorlevel 1 pause
