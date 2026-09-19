@echo off
title Instalando dependencias
echo Instalando dependencias del proyecto...
call npm install
if errorlevel 1 (
  echo.
  echo ERROR: no se pudo instalar. Verifica que Node.js este instalado: https://nodejs.org
  pause
  exit /b 1
)
echo.
echo Listo! Ahora ejecuta run.bat
pause
