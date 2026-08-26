@echo off
chcp 65001 >nul
echo ========================================
echo    🌍 个人博客 & 作品集（扫码登录门禁版）
echo ========================================
echo.
echo 正在启动后台服务（端口 3000）...
cd /d "%~dp0qrcode-login"
start "qrcode-login-server" /min cmd /c "node server.js"
timeout /t 2 >nul
echo 正在打开登录页（扫码登录后进入博客）...
start "" "http://127.0.0.1:3000/"
timeout /t 1 >nul
exit
