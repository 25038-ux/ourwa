@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>nul
cd /d "%~dp0"
title WhatsApp parent checker

rem Never download a browser while installing: Chrome or Edge already on this PC is used
set "PUPPETEER_SKIP_DOWNLOAD=true"
set "PUPPETEER_SKIP_CHROME_DOWNLOAD=true"
set "npm_config_ignore_scripts=true"
set "npm_config_audit=false"
set "npm_config_fund=false"
set "npm_config_update_notifier=false"
set "npm_config_loglevel=error"

rem ---------- 1. Node.js (installed on the PC, or a private copy in "runtime") ----------
if exist "%~dp0runtime\node\node.exe" set "PATH=%~dp0runtime\node;%PATH%"
call :check_node
if not errorlevel 1 goto node_ok
echo Node.js 18 or newer was not found. Downloading a private copy for this tool, about 30 MB...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\get-node.ps1" -Dest "%~dp0runtime\node"
if exist "%~dp0runtime\node\node.exe" set "PATH=%~dp0runtime\node;%PATH%"
call :check_node
if not errorlevel 1 goto node_ok
echo.
echo Node.js could not be set up automatically.
echo Install the LTS version from https://nodejs.org then double-click START.bat again.
start "" https://nodejs.org
goto fail

:node_ok
rem ---------- 2. Components (already included; repaired only if missing or broken) ----------
node src\check-setup.js >nul 2>nul
if not errorlevel 1 goto run
echo Installing the components, 1 to 3 minutes...
set /a TRY=0
:install_again
set /a TRY+=1
call npm install --no-audit --no-fund --ignore-scripts
node src\check-setup.js >nul 2>nul
if not errorlevel 1 goto run
if %TRY% GEQ 3 goto install_failed
echo Installation incomplete, trying again in 10 seconds...
timeout /t 10 /nobreak >nul
goto install_again

:install_failed
echo.
node src\check-setup.js
echo.
echo The components could not be installed. Check the internet connection, then double-click START.bat again.
goto fail

rem ---------- 3. Run ----------
:run
node src\index.js %*
set "CODE=%ERRORLEVEL%"
echo.
pause
exit /b %CODE%

:fail
echo.
pause
exit /b 1

:check_node
where node >nul 2>nul
if errorlevel 1 exit /b 1
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)" >nul 2>nul
exit /b %ERRORLEVEL%
