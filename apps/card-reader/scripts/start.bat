@echo off
chcp 65001 >nul
title BESTCHOICE Card Reader Service

cd /d "%~dp0.."

:: Check if already running on port 3457
netstat -ano | findstr ":3457" | findstr "LISTENING" >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [WARN] Card Reader Service is already running on port 3457
    echo Close the other instance first, or press any key to start anyway.
    pause >nul
)

echo Starting BESTCHOICE Card Reader Service...
echo Press Ctrl+C to stop.
echo.

node dist/index.js

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Service stopped unexpectedly.
    echo Try running install.bat first.
    echo.
    pause
)
