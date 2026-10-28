@echo off
title RackSense One-Click Runner
cd /d "%~dp0"
echo =======================================================================
echo          Starting RackSense Auto-Launcher...
echo =======================================================================
python run_project.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] RackSense exited with an error.
    pause
)
