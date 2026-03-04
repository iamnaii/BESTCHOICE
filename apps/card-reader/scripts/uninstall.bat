@echo off
chcp 65001 >nul
title BESTCHOICE Card Reader - ถอนการติดตั้ง

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║   BESTCHOICE - ถอนการติดตั้งเครื่องอ่านบัตร       ║
echo  ╚══════════════════════════════════════════════════╝
echo.

set "DESKTOP=%USERPROFILE%\Desktop"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_NAME=BESTCHOICE Card Reader.lnk"

:: Kill running process
tasklist /fi "windowtitle eq BESTCHOICE Card Reader*" 2>nul | findstr /i "cmd.exe" >nul
if %ERRORLEVEL% equ 0 (
    echo กำลังปิดโปรแกรม...
    taskkill /fi "windowtitle eq BESTCHOICE Card Reader*" /f >nul 2>nul
    echo [OK] ปิดโปรแกรมแล้ว
)

:: Remove shortcuts
if exist "%DESKTOP%\%SHORTCUT_NAME%" (
    del "%DESKTOP%\%SHORTCUT_NAME%"
    echo [OK] ลบ shortcut บน Desktop แล้ว
)

if exist "%STARTUP%\%SHORTCUT_NAME%" (
    del "%STARTUP%\%SHORTCUT_NAME%"
    echo [OK] ลบการเปิดอัตโนมัติแล้ว
)

echo.
echo  ══════════════════════════════════════════════════
echo   ถอนการติดตั้งเสร็จแล้ว!
echo   ลบโฟลเดอร์นี้ทิ้งได้เลย
echo  ══════════════════════════════════════════════════
echo.
pause
