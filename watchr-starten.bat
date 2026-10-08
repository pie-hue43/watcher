@echo off
title watchr
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js fehlt. Bitte die LTS-Version von https://nodejs.org installieren und diese Datei danach erneut doppelklicken.
  start https://nodejs.org
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  for /f %%v in ('node -v') do echo Deine Node.js-Version ist %%v. watchr braucht 22.13 oder neuer.
  echo Bitte die aktuelle LTS-Version von https://nodejs.org installieren, dann diese Datei erneut doppelklicken.
  start https://nodejs.org
  pause
  exit /b 1
)
if not exist .env (
  copy .env.example .env >nul
  powershell -NoProfile -Command "(Get-Content .env) -replace 'WATCHER_TOKEN=bitte-aendern','WATCHER_TOKEN=watchr-%RANDOM%%RANDOM%%RANDOM%' | Set-Content .env"
  echo Einstellungen in .env angelegt.
)
if not exist node_modules (
  echo Installiere watchr, das dauert beim ersten Mal 1-2 Minuten ...
  call npm install
  if errorlevel 1 ( echo npm install ist fehlgeschlagen. & pause & exit /b 1 )
)
echo watchr startet. Die Website oeffnet sich gleich unter http://localhost:3000
echo Zum Beenden dieses Fenster schliessen.
start "" cmd /c "timeout /t 6 >nul & start http://localhost:3000"
call npm start
pause
