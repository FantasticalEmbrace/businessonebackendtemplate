@echo off
REM MySQL Database Dump Script for H&M Herbs
REM Creates a backup of your MySQL database

echo ========================================
echo H&M Herbs Database Dump Utility
echo ========================================
echo.

REM Set default database values (update these if different)
set DB_HOST=localhost
set DB_USER=root
set DB_PASSWORD=
set DB_NAME=hmherbs

REM Check if .env file exists and read values
if exist "backend\.env" (
    echo Reading database configuration from backend\.env...
    for /f "tokens=1,2 delims==" %%a in ('findstr /R "^DB_" backend\.env') do (
        if "%%a"=="DB_HOST" set DB_HOST=%%b
        if "%%a"=="DB_USER" set DB_USER=%%b
        if "%%a"=="DB_PASSWORD" set DB_PASSWORD=%%b
        if "%%a"=="DB_NAME" set DB_NAME=%%b
    )
)

echo.
echo Database Configuration:
echo   Host: %DB_HOST%
echo   User: %DB_USER%
echo   Database: %DB_NAME%
echo.

REM Create dump filename with timestamp
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set timestamp=%datetime:~0,8%_%datetime:~8,6%
set DUMP_FILE=database\hmherbs_backup_%timestamp%.sql

echo Creating database dump...
echo Output file: %DUMP_FILE%
echo.

REM Create database directory if it doesn't exist
if not exist "database" mkdir database

REM Run mysqldump
if "%DB_PASSWORD%"=="" (
    mysqldump -h %DB_HOST% -u %DB_USER% %DB_NAME% > "%DUMP_FILE%"
) else (
    mysqldump -h %DB_HOST% -u %DB_USER% -p%DB_PASSWORD% %DB_NAME% > "%DUMP_FILE%"
)

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo Database dump created successfully!
    echo ========================================
    echo File: %DUMP_FILE%
    echo.
    echo You can now import this file on your production server
    echo using phpMyAdmin or your hosting database tool.
) else (
    echo.
    echo ========================================
    echo ERROR: Failed to create database dump
    echo ========================================
    echo.
    echo Possible issues:
    echo   1. MySQL is not running
    echo   2. Database credentials are incorrect
    echo   3. mysqldump is not in your PATH
    echo.
    echo Please check:
    echo   - Database name: %DB_NAME%
    echo   - MySQL username: %DB_USER%
    echo   - MySQL password: (check backend\.env)
    echo.
    pause
)

pause

