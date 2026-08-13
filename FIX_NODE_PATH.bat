@echo off
echo ========================================
echo Fixing Node.js PATH Issue
echo ========================================
echo.
echo This will try to use Node.js from common locations
echo.

REM Try common Node.js locations
set NODE_PATH=

if exist "C:\Program Files\nodejs\node.exe" (
    set NODE_PATH=C:\Program Files\nodejs\node.exe
    echo ✅ Found Node.js at: %NODE_PATH%
) else if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set NODE_PATH=C:\Program Files (x86)\nodejs\node.exe
    echo ✅ Found Node.js at: %NODE_PATH%
) else (
    echo ❌ Node.js not found in common locations
    echo.
    echo Please install Node.js from: https://nodejs.org/
    pause
    exit /b 1
)

echo.
echo Testing Node.js...
"%NODE_PATH%" --version
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js found but not working
    pause
    exit /b 1
)

echo.
echo ✅ Node.js is working!
echo.
echo Now running image download test...
echo.

cd /d %~dp0backend

"%NODE_PATH%" scripts/test-one-image-simple.js

echo.
echo ========================================
echo Test complete!
echo ========================================
pause



