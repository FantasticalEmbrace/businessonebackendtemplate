@echo off
echo ========================================
echo DOWNLOAD PRODUCT IMAGES
echo ========================================
echo.
echo This will download images for the first 10 products
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

echo Node.js found. Starting download...
echo.
echo ========================================
echo.

node scripts/final-working-downloader.js

echo.
echo ========================================
echo Download complete!
echo Check the images/products folder for downloaded images.
echo ========================================
echo.
pause

