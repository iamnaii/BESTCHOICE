@echo off
chcp 65001 >nul
cd /d "%~dp0.."
start /min "" node dist/index.js
