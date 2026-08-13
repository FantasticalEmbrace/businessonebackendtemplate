@echo off
echo ========================================
echo TEST - Download ONE Image
echo ========================================
echo.
cd /d %~dp0backend
echo Changed to backend directory: %CD%
echo.

REM Check if Node.js is available
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js not found!
    echo Please make sure Node.js is installed and in your PATH
    echo.
    pause
    exit /b 1
)

echo Node.js found. Running test...
echo.
echo ========================================
echo.

node scripts/test-one-image-simple.js

echo.
echo ========================================
echo Test complete!
echo Check images/products folder for test-download-*.jpg
echo ========================================
echo.
pause

