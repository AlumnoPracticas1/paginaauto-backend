@echo off
echo === Instalando backend ===
cd /d "%~dp0backend" || exit /b 1
call npm install || exit /b 1
echo.
echo === Instalando github-app ===
cd /d "%~dp0github-app" || exit /b 1
call npm install || exit /b 1
echo.
echo Listo.
pause
