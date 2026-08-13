@echo off
echo ========================================
echo Adding Node.js to Windows Firewall
echo ========================================
echo.
echo This requires Administrator privileges.
echo.
pause

REM Find Node.js path
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js not found in PATH
    echo Please install Node.js or add it to your PATH
    pause
    exit /b 1
)

for /f "delims=" %%i in ('where node') do set NODE_PATH=%%i

echo Found Node.js at: %NODE_PATH%
echo.
echo Adding firewall rule...
echo.

netsh advfirewall firewall add rule name="Node.js" dir=out action=allow program="%NODE_PATH%" enable=yes
netsh advfirewall firewall add rule name="Node.js" dir=in action=allow program="%NODE_PATH%" enable=yes

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo SUCCESS! Node.js added to firewall
    echo ========================================
    echo.
    echo You can now run the download scripts.
) else (
    echo.
    echo ========================================
    echo ERROR: Failed to add firewall rule
    echo ========================================
    echo.
    echo Please run this file as Administrator:
    echo Right-click and select "Run as administrator"
)

echo.
pause

