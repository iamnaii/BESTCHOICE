@echo off
chcp 65001 >nul
title BESTCHOICE Card Reader - Auto-start Setup

echo Setting up auto-start on Windows login...
echo.

set SCRIPT_DIR=%~dp0
set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT_NAME=BESTCHOICE Card Reader.lnk

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('%STARTUP_DIR%\%SHORTCUT_NAME%'); $sc.TargetPath = '%SCRIPT_DIR%start-silent.bat'; $sc.WorkingDirectory = '%SCRIPT_DIR%..'; $sc.WindowStyle = 7; $sc.Description = 'BESTCHOICE Smart Card Reader Service'; $sc.Save()"

if exist "%STARTUP_DIR%\%SHORTCUT_NAME%" (
    echo [OK] Auto-start enabled — service will start when you log in.
) else (
    echo [ERROR] Could not set up auto-start.
)

echo.
pause
