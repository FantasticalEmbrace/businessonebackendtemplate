# HM Herbs Database Setup Script
# This script will create the database and run the schema

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "HM Herbs Database Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get MySQL root password
$mysqlPassword = Read-Host "Enter MySQL root password" -AsSecureString
$mysqlPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($mysqlPassword))

# MySQL path
$mysqlPath = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
$schemaPath = Join-Path $PSScriptRoot "database\schema.sql"
$seedPath = Join-Path $PSScriptRoot "database\seed-data.sql"

# Check if MySQL exists
if (-not (Test-Path $mysqlPath)) {
    Write-Host "❌ MySQL not found at: $mysqlPath" -ForegroundColor Red
    Write-Host "Please update the mysqlPath variable in this script." -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ MySQL found" -ForegroundColor Green
Write-Host ""

# Test connection
Write-Host "Testing MySQL connection..." -ForegroundColor Yellow
$testResult = & $mysqlPath -u root -p"$mysqlPasswordPlain" -e "SELECT 1;" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to connect to MySQL. Please check your password." -ForegroundColor Red
    Write-Host $testResult -ForegroundColor Red
    exit 1
}
Write-Host "✅ MySQL connection successful" -ForegroundColor Green
Write-Host ""

# Create database
Write-Host "Creating database 'hmherbs'..." -ForegroundColor Yellow
$createDb = "CREATE DATABASE IF NOT EXISTS hmherbs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
& $mysqlPath -u root -p"$mysqlPasswordPlain" -e $createDb 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Database 'hmherbs' created successfully" -ForegroundColor Green
} else {
    Write-Host "⚠️  Database may already exist or there was an error" -ForegroundColor Yellow
}
Write-Host ""

# Run schema
if (Test-Path $schemaPath) {
    Write-Host "Running database schema..." -ForegroundColor Yellow
    Get-Content $schemaPath | & $mysqlPath -u root -p"$mysqlPasswordPlain" hmherbs 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Database schema applied successfully" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Some errors may have occurred. Check the output above." -ForegroundColor Yellow
    }
} else {
    Write-Host "❌ Schema file not found: $schemaPath" -ForegroundColor Red
}
Write-Host ""

# Run seed data (optional)
if (Test-Path $seedPath) {
    $runSeed = Read-Host "Do you want to load seed data? (y/n)"
    if ($runSeed -eq "y" -or $runSeed -eq "Y") {
        Write-Host "Loading seed data..." -ForegroundColor Yellow
        Get-Content $seedPath | & $mysqlPath -u root -p"$mysqlPasswordPlain" hmherbs 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Seed data loaded successfully" -ForegroundColor Green
        } else {
            Write-Host "⚠️  Some errors may have occurred loading seed data." -ForegroundColor Yellow
        }
    }
}
Write-Host ""

# Update .env file
Write-Host "Updating .env file with MySQL password..." -ForegroundColor Yellow
$envPath = Join-Path $PSScriptRoot "backend\.env"
if (Test-Path $envPath) {
    $envContent = Get-Content $envPath
    $envContent = $envContent -replace "DB_PASSWORD=", "DB_PASSWORD=$mysqlPasswordPlain"
    $envContent | Set-Content $envPath
    Write-Host "✅ .env file updated" -ForegroundColor Green
} else {
    Write-Host "⚠️  .env file not found at: $envPath" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ Database setup complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Start the backend server: cd backend && npm start" -ForegroundColor White
Write-Host "2. Start the frontend: python -m http.server 8000" -ForegroundColor White
Write-Host ""

