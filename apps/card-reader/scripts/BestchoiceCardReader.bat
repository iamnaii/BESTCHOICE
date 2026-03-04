@echo off
chcp 65001 >nul
title BESTCHOICE Card Reader

:: Resolve paths relative to this .bat file
set "ROOT=%~dp0"
set "NODE=%ROOT%node\node.exe"
set "APP=%ROOT%app\dist\index.js"

:: Check node.exe exists
if not exist "%NODE%" (
    echo [ERROR] ไม่พบ node.exe
    echo กรุณาติดตั้งใหม่โดยโหลดจาก GitHub Releases
    pause
    exit /b 1
)

:: Check app exists
if not exist "%APP%" (
    echo [ERROR] ไม่พบไฟล์โปรแกรม
    echo กรุณาติดตั้งใหม่โดยโหลดจาก GitHub Releases
    pause
    exit /b 1
)

:: Check if already running
netstat -ano | findstr ":3457" | findstr "LISTENING" >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo.
    echo [!] โปรแกรมกำลังทำงานอยู่แล้วที่ port 3457
    echo     ปิดตัวเก่าก่อนแล้วเปิดใหม่
    echo.
    pause
    exit /b 0
)

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║   BESTCHOICE - เครื่องอ่านบัตรประชาชน            ║
echo  ║   กดปุ่ม Ctrl+C เพื่อหยุดโปรแกรม                ║
echo  ╚══════════════════════════════════════════════════╝
echo.

:: Change to app directory so Node.js can find node_modules/pcsclite
cd /d "%ROOT%app"
"%NODE%" "dist\index.js"

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] โปรแกรมหยุดทำงานผิดปกติ
    echo ลองปิดแล้วเปิดใหม่ หรือติดต่อช่าง
    echo.
    pause
)
