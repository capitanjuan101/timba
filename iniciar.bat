@echo off
chcp 65001 >nul
title Timba
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encuentra Node.js. Instalalo desde https://nodejs.org y vuelve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias, solo la primera vez...
  call npm install
  if errorlevel 1 (
    echo  Error instalando dependencias. Comprueba tu conexion a internet.
    pause
    exit /b 1
  )
)
echo.
echo  Direcciones para jugar desde otros dispositivos (misma WiFi o Tailscale):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo    http://%%a:3000
echo.
echo  Tailscale: usa la IP 100.x.x.x que muestre tu app de Tailscale con el puerto 3000.
echo.
start "" http://localhost:3000
node server.js
pause
