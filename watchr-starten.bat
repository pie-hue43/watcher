@echo off
title watchr
cd /d "%~dp0"
rem Node ohne Installation: die Node-ZIP fuer Windows in diesen Ordner entpacken (auch doppelt verschachtelt ok)
set "NODEDIR="
for /d %%D in ("node-v*-win-*" "node") do (
  if exist "%%~fD\node.exe" set "NODEDIR=%%~fD"
  for /d %%E in ("%%~fD\node-v*-win-*") do if exist "%%~fE\node.exe" set "NODEDIR=%%~fE"
)
if defined NODEDIR set "PATH=%NODEDIR%;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js fehlt.
  echo Ohne Installation: Auf nodejs.org "Windows Binary (.zip)" herunterladen und in diesen Ordner entpacken:
  echo "%~dp0"
  echo Danach diese Datei erneut doppelklicken.
  start https://nodejs.org/en/download
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  for /f %%v in ('node -v') do echo watchr findet Node.js %%v, braucht aber 22.13 oder neuer.
  echo Benutzt wird diese Node-Installation:
  where node
  echo Bitte die aktuelle Node-ZIP in diesen Ordner entpacken oder alle Node.js-Eintraege unter "Installierte Apps" deinstallieren, Node.js neu von https://nodejs.org installieren und den PC neu starten.
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
for /f %%v in ('node -v') do echo Node.js %%v gefunden.
echo watchr startet. Die Website oeffnet sich gleich unter http://localhost:3000
echo Zum Beenden dieses Fenster schliessen.
start "" cmd /c "timeout /t 6 >nul & start http://localhost:3000"
call npm start
pause
