@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo Updating the WhatsApp component to the latest version...
call npm install whatsapp-web.js@latest exceljs@latest qrcode-terminal@latest --no-audit --no-fund
echo.
echo Done. Double-click START.bat.
pause
