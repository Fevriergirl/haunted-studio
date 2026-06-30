@echo off
REM Double-click this file to open Haunted Studio (Windows).
REM
REM It starts the local studio and opens the page in your browser. Leave this
REM window open while you use it; close it (or press Ctrl-C) to stop the studio.
REM
REM One-time setup first: install Node.js (https://nodejs.org), then in this
REM folder run "npm install". After that, this launcher is all you need.

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js / npm is not installed. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First-time setup: installing dependencies ^(this happens only once^)...
  call npm install || (echo Setup failed. & pause & exit /b 1)
)

echo Opening Haunted Studio...
call npm run studio
pause
