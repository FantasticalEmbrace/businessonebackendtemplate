@echo off
echo ========================================
echo Checking Node.js Installation
echo ========================================
echo.

REM Check if node command works
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo ✅ Node.js FOUND in PATH!
    echo.
    echo Node.js version:
    node --version
    echo.
    echo Node.js location:
    where node
    echo.
    echo npm version:
    npm --version
    echo.
    echo ✅ Everything looks good!
) else (
    echo ❌ Node.js NOT FOUND in PATH
    echo.
    echo Checking common installation locations...
    echo.
    
    if exist "C:\Program Files\nodejs\node.exe" (
        echo ✅ Found Node.js at: C:\Program Files\nodejs\node.exe
        echo.
        echo ⚠️  Node.js is installed but not in your PATH
        echo.
        echo To fix this:
        echo 1. Copy this path: C:\Program Files\nodejs
        echo 2. Add it to your system PATH environment variable
        echo.
    ) else if exist "C:\Program Files (x86)\nodejs\node.exe" (
        echo ✅ Found Node.js at: C:\Program Files (x86)\nodejs\node.exe
        echo.
        echo ⚠️  Node.js is installed but not in your PATH
        echo.
        echo To fix this:
        echo 1. Copy this path: C:\Program Files (x86)\nodejs
        echo 2. Add it to your system PATH environment variable
        echo.
    ) else (
        echo ❌ Node.js is NOT installed
        echo.
        echo Please install Node.js from: https://nodejs.org/
        echo Download the LTS version and install it.
        echo.
    )
)

echo.
pause


