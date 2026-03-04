@echo off
chcp 65001 >nul
cd /d "%~dp0.."

:: Try bundled portable node first, then system node
if exist "%~dp0..\node\node.exe" (
    set "NODE=%~dp0..\node\node.exe"
) else (
    set "NODE=node"
)

:: Check node exists
where "%NODE%" >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [%date% %time%] ERROR: node.exe not found >> "%TEMP%\bestchoice-card-reader.log"
    exit /b 1
)

:: Check app exists
if not exist "%~dp0..\dist\index.js" (
    if not exist "%~dp0..\app\dist\index.js" (
        echo [%date% %time%] ERROR: app not found >> "%TEMP%\bestchoice-card-reader.log"
        exit /b 1
    )
    set "APP=%~dp0..\app\dist\index.js"
) else (
    set "APP=%~dp0..\dist\index.js"
)

start /min "" "%NODE%" "%APP%" >> "%TEMP%\bestchoice-card-reader.log" 2>&1
