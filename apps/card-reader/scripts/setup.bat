@echo off
chcp 65001 >nul
title BESTCHOICE Card Reader - ติดตั้ง

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║   BESTCHOICE - ติดตั้งเครื่องอ่านบัตร             ║
echo  ╚══════════════════════════════════════════════════╝
echo.

set "ROOT=%~dp0"
set "DESKTOP=%USERPROFILE%\Desktop"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCHER=%ROOT%BestchoiceCardReader.bat"
set "SHORTCUT_NAME=BESTCHOICE Card Reader.lnk"

:: ── Verify files ───────────────────────────────────
if not exist "%ROOT%node\node.exe" (
    echo [ERROR] ไม่พบไฟล์ node.exe
    echo กรุณาแตกไฟล์ zip ให้ครบทุกไฟล์แล้วลองใหม่
    pause
    exit /b 1
)

if not exist "%ROOT%app\dist\index.js" (
    echo [ERROR] ไม่พบไฟล์โปรแกรม
    echo กรุณาแตกไฟล์ zip ให้ครบทุกไฟล์แล้วลองใหม่
    pause
    exit /b 1
)

echo [OK] ตรวจสอบไฟล์สำเร็จ
echo.

:: ── Create desktop shortcut ────────────────────────
echo กำลังสร้าง shortcut บน Desktop...

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('%DESKTOP%\%SHORTCUT_NAME%'); $sc.TargetPath = '%LAUNCHER%'; $sc.WorkingDirectory = '%ROOT%'; $sc.IconLocation = 'imageres.dll,304'; $sc.Description = 'BESTCHOICE Smart Card Reader'; $sc.Save()" 2>nul

if exist "%DESKTOP%\%SHORTCUT_NAME%" (
    echo [OK] สร้าง shortcut บน Desktop แล้ว
) else (
    echo [!] สร้าง shortcut ไม่ได้ — ไม่เป็นไร เปิดจากโฟลเดอร์นี้ได้เลย
)

:: ── Ask about auto-start ──────────────────────────
echo.
set /p AUTOSTART="ต้องการให้เปิดอัตโนมัติตอนเปิดคอมไหม? (Y/N): "
if /i "%AUTOSTART%"=="Y" (
    powershell -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('%STARTUP%\%SHORTCUT_NAME%'); $sc.TargetPath = '%LAUNCHER%'; $sc.WorkingDirectory = '%ROOT%'; $sc.WindowStyle = 7; $sc.Description = 'BESTCHOICE Smart Card Reader'; $sc.Save()" 2>nul

    if exist "%STARTUP%\%SHORTCUT_NAME%" (
        echo [OK] ตั้งค่าเปิดอัตโนมัติแล้ว
    ) else (
        echo [!] ตั้งค่าเปิดอัตโนมัติไม่ได้
    )
) else (
    echo [OK] ข้ามการตั้งค่าเปิดอัตโนมัติ
)

:: ── Done ──────────────────────────────────────────
echo.
echo  ══════════════════════════════════════════════════
echo   ติดตั้งเสร็จแล้ว!
echo.
echo   วิธีใช้:
echo     1. เสียบเครื่องอ่านบัตร USB เข้าคอม
echo     2. ดับเบิลคลิก "BESTCHOICE Card Reader" บน Desktop
echo     3. เสียบบัตรประชาชนเข้าเครื่องอ่าน
echo     4. ระบบจะอ่านข้อมูลให้อัตโนมัติ
echo  ══════════════════════════════════════════════════
echo.

set /p START_NOW="เปิดโปรแกรมตอนนี้เลยไหม? (Y/N): "
if /i "%START_NOW%"=="Y" (
    start "" "%LAUNCHER%"
)

pause
