@echo off
echo ========================================
echo HM Herbs Database Setup
echo ========================================
echo.

set MYSQL_PATH="C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
set SCHEMA_PATH=%~dp0database\schema.sql
set SEED_PATH=%~dp0database\seed-data.sql

REM Check if MySQL exists
if not exist %MYSQL_PATH% (
    echo ❌ MySQL not found at: %MYSQL_PATH%
    echo Please update the MYSQL_PATH variable in this script.
    pause
    exit /b 1
)

echo ✅ MySQL found
echo.

REM Test connection and create database
echo Creating database 'hmherbs'...
echo Please enter your MySQL root password when prompted:
%MYSQL_PATH% -u root -p -e "CREATE DATABASE IF NOT EXISTS hmherbs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

if %ERRORLEVEL% NEQ 0 (
    echo ❌ Failed to create database. Please check your password.
    pause
    exit /b 1
)

echo ✅ Database 'hmherbs' created successfully
echo.

REM Run schema
if exist %SCHEMA_PATH% (
    echo Running database schema...
    echo Please enter your MySQL root password again:
    %MYSQL_PATH% -u root -p hmherbs < %SCHEMA_PATH%
    
    if %ERRORLEVEL% EQU 0 (
        echo ✅ Database schema applied successfully
    ) else (
        echo ⚠️  Some errors may have occurred. Check the output above.
    )
) else (
    echo ❌ Schema file not found: %SCHEMA_PATH%
)
echo.

REM Ask about seed data
set /p LOAD_SEED="Do you want to load seed data? (y/n): "
if /i "%LOAD_SEED%"=="y" (
    if exist %SEED_PATH% (
        echo Loading seed data...
        echo Please enter your MySQL root password again:
        %MYSQL_PATH% -u root -p hmherbs < %SEED_PATH%
        
        if %ERRORLEVEL% EQU 0 (
            echo ✅ Seed data loaded successfully
        ) else (
            echo ⚠️  Some errors may have occurred loading seed data.
        )
    ) else (
        echo ❌ Seed data file not found: %SEED_PATH%
    )
)
echo.

echo ========================================
echo ✅ Database setup complete!
echo ========================================
echo.
echo Next steps:
echo 1. Update backend\.env with your MySQL root password
echo 2. Start the backend server: cd backend ^&^& npm start
echo 3. Start the frontend: python -m http.server 8000
echo.
pause

