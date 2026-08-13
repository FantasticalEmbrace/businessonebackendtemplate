@echo off
echo ========================================
echo QUICK IMAGE DOWNLOAD TEST
echo ========================================
echo.
cd /d %~dp0
echo Current directory: %CD%
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

echo Node.js found. Running test script...
echo.
echo ========================================
echo.

echo Executing: node scripts/test-one-image-simple.js
echo.

node scripts/test-one-image-simple.js 2>&1

set SCRIPT_EXIT=%ERRORLEVEL%

echo.
echo ========================================
echo Script finished. Exit code: %SCRIPT_EXIT%
echo ========================================
echo.
echo Check the images/products folder for new files.
echo.
pause

