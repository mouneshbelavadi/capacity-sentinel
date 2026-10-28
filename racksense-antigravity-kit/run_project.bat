@echo off
title RackSense One-Click Runner
cd /d "%~dp0"
python run_project.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Exited with an error code.
    pause
)
