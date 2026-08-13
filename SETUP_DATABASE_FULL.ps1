# HM Herbs Complete Database Setup Script
# This script will create the database, run schema, and update .env file

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "HM Herbs Complete Database Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# MySQL path
$mysqlPath = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
$schemaPath = Join-Path $PSScriptRoot "database\schema.sql"
$seedPath = Join-Path $PSScriptRoot "database\seed-data.sql"
$envPath = Join-Path $PSScriptRoot "backend\.env"

# Check if MySQL exists
if (-not (Test-Path $mysqlPath)) {
    Write-Host "❌ MySQL not found at: $mysqlPath" -ForegroundColor Red
    Write-Host "Please update the mysqlPath variable in this script." -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ MySQL found" -ForegroundColor Green
Write-Host ""

# Get MySQL root password securely
Write-Host "Please enter your MySQL root password:" -ForegroundColor Yellow
$mysqlPassword = Read-Host -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($mysqlPassword)
$mysqlPasswordPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)

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
$createResult = & $mysqlPath -u root -p"$mysqlPasswordPlain" -e $createDb 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Database 'hmherbs' created successfully" -ForegroundColor Green
} else {
    Write-Host "⚠️  Database may already exist or there was an error" -ForegroundColor Yellow
    Write-Host $createResult -ForegroundColor Yellow
}
Write-Host ""

# Run schema
if (Test-Path $schemaPath) {
    Write-Host "Running database schema..." -ForegroundColor Yellow
    $schemaResult = Get-Content $schemaPath | & $mysqlPath -u root -p"$mysqlPasswordPlain" hmherbs 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Database schema applied successfully" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Some errors may have occurred. Checking..." -ForegroundColor Yellow
        # Check if errors are just warnings about existing tables
        $errorCount = ($schemaResult | Select-String -Pattern "ERROR" -CaseSensitive).Count
        if ($errorCount -eq 0) {
            Write-Host "✅ Schema applied (warnings about existing objects are normal)" -ForegroundColor Green
        } else {
            Write-Host "❌ Errors found:" -ForegroundColor Red
            Write-Host $schemaResult -ForegroundColor Red
        }
    }
} else {
    Write-Host "❌ Schema file not found: $schemaPath" -ForegroundColor Red
}
Write-Host ""

# Ask about seed data
$runSeed = Read-Host "Do you want to load seed data? (y/n)"
if ($runSeed -eq "y" -or $runSeed -eq "Y") {
    if (Test-Path $seedPath) {
        Write-Host "Loading seed data..." -ForegroundColor Yellow
        $seedResult = Get-Content $seedPath | & $mysqlPath -u root -p"$mysqlPasswordPlain" hmherbs 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Seed data loaded successfully" -ForegroundColor Green
        } else {
            Write-Host "⚠️  Some errors may have occurred loading seed data." -ForegroundColor Yellow
            Write-Host $seedResult -ForegroundColor Yellow
        }
    } else {
        Write-Host "⚠️  Seed data file not found: $seedPath" -ForegroundColor Yellow
    }
}
Write-Host ""

# Update .env file with password
Write-Host "Updating .env file with MySQL password..." -ForegroundColor Yellow
if (Test-Path $envPath) {
    $envContent = Get-Content $envPath
    $updated = $false
    $newContent = @()
    
    foreach ($line in $envContent) {
        if ($line -match "^DB_PASSWORD=") {
            $newContent += "DB_PASSWORD=$mysqlPasswordPlain"
            $updated = $true
        } else {
            $newContent += $line
        }
    }
    
    # If DB_PASSWORD line doesn't exist, add it
    if (-not $updated) {
        # Find where to insert it (after DB_NAME)
        $insertIndex = -1
        for ($i = 0; $i -lt $newContent.Length; $i++) {
            if ($newContent[$i] -match "^DB_NAME=") {
                $insertIndex = $i + 1
                break
            }
        }
        if ($insertIndex -ge 0) {
            $newContent = $newContent[0..($insertIndex-1)] + "DB_PASSWORD=$mysqlPasswordPlain" + $newContent[$insertIndex..($newContent.Length-1)]
        } else {
            $newContent += "DB_PASSWORD=$mysqlPasswordPlain"
        }
    }
    
    $newContent | Set-Content $envPath
    Write-Host "✅ .env file updated with MySQL password" -ForegroundColor Green
} else {
    Write-Host "⚠️  .env file not found at: $envPath" -ForegroundColor Yellow
    Write-Host "Creating .env file..." -ForegroundColor Yellow
    $envContent = @"
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=$mysqlPasswordPlain
DB_NAME=hmherbs
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:8000
JWT_SECRET=hmherbs_jwt_secret_key_2024_secure_random_string_change_in_production
ADMIN_EMAIL=hmherbs1@gmail.com
ADMIN_PASSWORD=admin123
"@
    $envContent | Set-Content $envPath
    Write-Host "✅ .env file created" -ForegroundColor Green
}
Write-Host ""

# Clear password from memory
$mysqlPasswordPlain = $null
[System.GC]::Collect()

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ Database setup complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Start the backend server: cd backend && npm start" -ForegroundColor White
Write-Host "2. Start the frontend: python -m http.server 8000" -ForegroundColor White
Write-Host ""

