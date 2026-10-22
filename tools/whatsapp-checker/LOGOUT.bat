@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if exist ".wwebjs_auth" rmdir /s /q ".wwebjs_auth"
if exist ".wwebjs_cache" rmdir /s /q ".wwebjs_cache"
echo The saved WhatsApp login was removed from this PC.
echo Also remove it from your phone: WhatsApp - Linked devices.
echo Next START.bat will show a new QR code.
pause
