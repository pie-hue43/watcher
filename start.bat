@echo off
rem watchr starten, auch ohne installiertes Node.js.
rem Dafuer die Node.js-ZIP fuer Windows (nodejs.org, "Windows Binary (.zip)") in diesen Ordner entpacken.
setlocal
cd /d "%~dp0"
chcp 65001 >nul

set "NODEDIR="
for /d %%D in ("node-v*-win-x64" "node-v*-win-arm64" "node") do if exist "%%~fD\node.exe" set "NODEDIR=%%~fD"
if defined NODEDIR (
  set "PATH=%NODEDIR%;%PATH%"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo.
    echo Node.js fehlt noch. So geht es ohne Installation:
    echo  1. Auf der Seite, die sich gleich oeffnet, "Windows Binary ^(.zip^)" herunterladen, Version 22 oder neuer.
    echo  2. Die ZIP direkt in diesen Ordner entpacken: %~dp0
    echo  3. start.bat noch einmal doppelklicken.
    echo.
    start "" "https://nodejs.org/en/download"
    pause
    exit /b 1
  )
)

for /f "tokens=1 delims=v." %%V in ('node -v') do set "MAJOR=%%V"
if %MAJOR% LSS 22 (
  echo Diese Node.js-Version ist zu alt. watchr braucht Version 22.13 oder neuer.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Einmalige Einrichtung, das dauert ein bis zwei Minuten ...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Die Einrichtung hat nicht geklappt. Schick bitte einen Screenshot von diesem Fenster.
    pause
    exit /b 1
  )
)

if not exist .env (
  copy .env.example .env >nul
  node -e "const f=require('fs');const t=require('crypto').randomBytes(16).toString('hex');f.writeFileSync('.env',f.readFileSync('.env','utf8').replace('WATCHER_TOKEN=bitte-aendern','WATCHER_TOKEN='+t))"
)

echo.
echo watchr laeuft. Lass dieses Fenster offen, solange du suchen willst. Schliessen beendet watchr.
echo Im Browser: http://localhost:3000/monitor.html
echo.
start "" cmd /c "timeout /t 6 >nul & start http://localhost:3000/monitor.html"
call npm start
pause
