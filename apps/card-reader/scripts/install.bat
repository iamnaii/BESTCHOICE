@echo off
chcp 65001 >nul
title BESTCHOICE Card Reader - Installation

echo ╔══════════════════════════════════════════════════╗
echo ║   BESTCHOICE Card Reader - Installer             ║
echo ╚══════════════════════════════════════════════════╝
echo.

:: ── Check Node.js ──────────────────────────────
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found!
    echo.
    echo Please install Node.js from: https://nodejs.org/
    echo Download the LTS version and run the installer.
    echo After installing, close this window and run install.bat again.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [OK] Node.js %NODE_VER% found

:: ── Install dependencies ───────────────────────
echo.
echo Installing dependencies (this may take a few minutes)...
cd /d "%~dp0.."
call npm install
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] npm install failed!
    echo Make sure you have build tools installed:
    echo   npm install -g windows-build-tools
    echo.
    pause
    exit /b 1
)
echo [OK] Dependencies installed

:: ── Build TypeScript ───────────────────────────
echo.
echo Building...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Build failed!
    pause
    exit /b 1
)
echo [OK] Build complete

:: ── Create desktop shortcut ────────────────────
echo.
set SCRIPT_DIR=%~dp0
set SHORTCUT_NAME=BESTCHOICE Card Reader.lnk
set DESKTOP=%USERPROFILE%\Desktop

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('%DESKTOP%\%SHORTCUT_NAME%'); $sc.TargetPath = '%SCRIPT_DIR%start.bat'; $sc.WorkingDirectory = '%SCRIPT_DIR%..'; $sc.IconLocation = 'imageres.dll,304'; $sc.Description = 'BESTCHOICE Smart Card Reader Service'; $sc.Save()"

if exist "%DESKTOP%\%SHORTCUT_NAME%" (
    echo [OK] Desktop shortcut created
) else (
    echo [WARN] Could not create shortcut — you can run start.bat manually
)

echo.
echo ══════════════════════════════════════════════════
echo   Installation complete!
echo   Double-click "BESTCHOICE Card Reader" on your desktop to start.
echo ══════════════════════════════════════════════════
echo.
pause
