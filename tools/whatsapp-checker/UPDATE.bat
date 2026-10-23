@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>nul
cd /d "%~dp0"
set "PUPPETEER_SKIP_DOWNLOAD=true"
set "PUPPETEER_SKIP_CHROME_DOWNLOAD=true"
set "npm_config_ignore_scripts=true"
set "npm_config_loglevel=error"
if exist "%~dp0runtime\node\node.exe" set "PATH=%~dp0runtime\node;%PATH%"
echo Updating the WhatsApp component to the latest version...
call npm install whatsapp-web.js@latest --no-audit --no-fund --ignore-scripts
node src\check-setup.js
echo.
echo Done. Double-click START.bat.
pause
