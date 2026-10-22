@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title WhatsApp parent checker

where node >nul 2>nul
if errorlevel 1 goto install_node
node -e "process.exit(+process.versions.node.split('.')[0] < 18 ? 1 : 0)"
if errorlevel 1 goto old_node

if exist "node_modules\whatsapp-web.js\package.json" if exist "node_modules\exceljs\package.json" goto run
echo First run: installing the components. This takes 1 to 5 minutes...
call npm install --no-audit --no-fund
if errorlevel 1 goto npm_failed

:run
node src\index.js %*
echo.
pause
exit /b

:install_node
echo Node.js is not installed. Trying to install it with winget...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto node_manual
echo.
echo Node.js is installed. Close this window and double-click START.bat again.
pause
exit /b

:old_node
echo Your Node.js version is too old. Install the LTS version from https://nodejs.org
goto node_manual_open

:node_manual
echo Automatic install did not work. Install the "LTS" version from https://nodejs.org
echo then double-click START.bat again.

:node_manual_open
start "" https://nodejs.org
pause
exit /b 1

:npm_failed
echo.
echo Installation failed. Check your internet connection and double-click START.bat again.
pause
exit /b 1
