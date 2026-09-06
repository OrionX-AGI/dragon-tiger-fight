@echo off
chcp 65001 >nul
title LongHuDou Launcher
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
if errorlevel 1 (
  echo.
  echo Startup failed. Please read the messages above.
  pause
)
