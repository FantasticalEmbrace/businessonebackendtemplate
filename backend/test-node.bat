@echo off
echo Testing Node.js installation...
echo.

where node
if %ERRORLEVEL% EQU 0 (
    echo.
    echo Node.js found! Version:
    node --version
    echo.
    echo Node.js path:
    where node
) else (
    echo ERROR: Node.js not found in PATH
    echo.
    echo Please install Node.js from https://nodejs.org/
    echo Or add Node.js to your system PATH
)

echo.
pause

