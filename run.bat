@echo off
title Editor de cubos - Servidor
if not exist node_modules (
  echo Falta instalar dependencias. Ejecuta install.bat primero.
  pause
  exit /b 1
)
echo Iniciando servidor...
start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node server.js
pause
