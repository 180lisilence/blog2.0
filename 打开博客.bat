@echo off
chcp 65001 >nul
echo ========================================
echo    🌍 个人博客 & 作品集
echo ========================================
echo.
echo 正在用默认浏览器打开博客...
echo.
start "" "%~dp0index.html"
timeout /t 2 >nul
exit
