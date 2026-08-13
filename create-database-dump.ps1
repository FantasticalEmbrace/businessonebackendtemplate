# MySQL Database Dump Script for H&M Herbs
# Creates a backup of your MySQL database

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "H&M Herbs Database Dump Utility" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Set default database values
$DB_HOST = "localhost"
$DB_USER = "root"
$DB_PASSWORD = ""
$DB_NAME = "hmherbs"

# Check if .env file exists and read values
$envPath = "backend\.env"
if (Test-Path $envPath) {
    Write-Host "Reading database configuration from backend\.env..." -ForegroundColor Yellow
    $envContent = Get-Content $envPath
    
    foreach ($line in $envContent) {
        if ($line -match "^DB_HOST=(.+)$") {
            $DB_HOST = $matches[1].Trim()
        }
        elseif ($line -match "^DB_USER=(.+)$") {
            $DB_USER = $matches[1].Trim()
        }
        elseif ($line -match "^DB_PASSWORD=(.+)$") {
            $DB_PASSWORD = $matches[1].Trim()
        }
        elseif ($line -match "^DB_NAME=(.+)$") {
            $DB_NAME = $matches[1].Trim()
        }
    }
}

Write-Host ""
Write-Host "Database Configuration:" -ForegroundColor Green
Write-Host "  Host: $DB_HOST"
Write-Host "  User: $DB_USER"
Write-Host "  Database: $DB_NAME"
Write-Host ""

# Create dump filename with timestamp
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$DUMP_FILE = "database\hmherbs_backup_$timestamp.sql"

Write-Host "Creating database dump..." -ForegroundColor Yellow
Write-Host "Output file: $DUMP_FILE"
Write-Host ""

# Create database directory if it doesn't exist
if (-not (Test-Path "database")) {
    New-Item -ItemType Directory -Path "database" | Out-Null
}

# Try to find mysqldump
$mysqldumpPath = $null

# Check common MySQL installation paths
$possiblePaths = @(
    "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe",
    "C:\Program Files\MySQL\MySQL Server 8.1\bin\mysqldump.exe",
    "C:\Program Files\MySQL\MySQL Server 8.2\bin\mysqldump.exe",
    "C:\Program Files\MySQL\MySQL Server 8.3\bin\mysqldump.exe",
    "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe",
    "C:\Program Files (x86)\MySQL\MySQL Server 8.0\bin\mysqldump.exe",
    "C:\xampp\mysql\bin\mysqldump.exe",
    "C:\wamp64\bin\mysql\mysql8.0.31\bin\mysqldump.exe",
    "C:\wamp\bin\mysql\mysql8.0.31\bin\mysqldump.exe"
)

foreach ($path in $possiblePaths) {
    if (Test-Path $path) {
        $mysqldumpPath = $path
        Write-Host "Found MySQL at: $path" -ForegroundColor Green
        break
    }
}

# If not found, try to find it in PATH
if (-not $mysqldumpPath) {
    try {
        $mysqlCmd = Get-Command mysql -ErrorAction Stop
        $mysqlDir = Split-Path $mysqlCmd.Source
        $mysqldumpPath = Join-Path $mysqlDir "mysqldump.exe"
        if (Test-Path $mysqldumpPath) {
            Write-Host "Found mysqldump at: $mysqldumpPath" -ForegroundColor Green
        }
        else {
            $mysqldumpPath = $null
        }
    }
    catch {
        $mysqldumpPath = $null
    }
}

# If still not found, try just "mysqldump" (might be in PATH)
if (-not $mysqldumpPath) {
    try {
        $cmd = Get-Command mysqldump -ErrorAction Stop
        $mysqldumpPath = "mysqldump"
        Write-Host "Found mysqldump in PATH" -ForegroundColor Green
    }
    catch {
        $mysqldumpPath = $null
    }
}

# Run mysqldump
if ($mysqldumpPath) {
    try {
        if ($DB_PASSWORD -eq "") {
            & $mysqldumpPath -h $DB_HOST -u $DB_USER $DB_NAME | Out-File -FilePath $DUMP_FILE -Encoding UTF8
        }
        else {
            $env:MYSQL_PWD = $DB_PASSWORD
            & $mysqldumpPath -h $DB_HOST -u $DB_USER $DB_NAME | Out-File -FilePath $DUMP_FILE -Encoding UTF8
            Remove-Item Env:\MYSQL_PWD
        }
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Host "========================================" -ForegroundColor Green
            Write-Host "Database dump created successfully!" -ForegroundColor Green
            Write-Host "========================================" -ForegroundColor Green
            Write-Host ""
            Write-Host "File: $DUMP_FILE" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "Import to Linode:" -ForegroundColor Yellow
            Write-Host "  npm run db:build-staging  (or use this dump in build-deploy-bundle.js)" -ForegroundColor Yellow
            Write-Host "  See database/DEPLOY-DATABASE.md" -ForegroundColor Yellow
            Write-Host ""
            
            # Show file size
            $fileInfo = Get-Item $DUMP_FILE
            Write-Host "File size: $([math]::Round($fileInfo.Length / 1MB, 2)) MB" -ForegroundColor Gray
        }
        else {
            throw "mysqldump failed with exit code $LASTEXITCODE"
        }
    }
    catch {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Red
        Write-Host "ERROR: Failed to create database dump" -ForegroundColor Red
        Write-Host "========================================" -ForegroundColor Red
        Write-Host ""
        Write-Host "Error: $_" -ForegroundColor Red
        Write-Host ""
        Write-Host "Possible issues:" -ForegroundColor Yellow
        Write-Host "  1. MySQL is not running"
        Write-Host "  2. Database credentials are incorrect"
        Write-Host "  3. Database '$DB_NAME' does not exist"
        Write-Host ""
        Write-Host "Please check:" -ForegroundColor Yellow
        Write-Host "  - Database name: $DB_NAME"
        Write-Host "  - MySQL username: $DB_USER"
        Write-Host "  - MySQL password: (check backend\.env)"
        Write-Host ""
    }
}
else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "ERROR: mysqldump not found" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Could not find mysqldump.exe" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please:" -ForegroundColor Yellow
    Write-Host "  1. Install MySQL if not installed"
    Write-Host "  2. Add MySQL bin directory to your PATH"
    Write-Host "  3. Or manually run mysqldump with full path"
    Write-Host ""
    Write-Host "Common MySQL locations:" -ForegroundColor Cyan
    Write-Host "  C:\Program Files\MySQL\MySQL Server 8.0\bin\"
    Write-Host "  C:\xampp\mysql\bin\"
    Write-Host "  C:\wamp64\bin\mysql\mysql8.0.31\bin\"
    Write-Host ""
    Write-Host "Manual command example:" -ForegroundColor Cyan
    if ($DB_PASSWORD -eq "") {
        Write-Host "  `"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe`" -h $DB_HOST -u $DB_USER $DB_NAME > database\dump.sql"
    }
    else {
        Write-Host "  `"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe`" -h $DB_HOST -u $DB_USER -p$DB_PASSWORD $DB_NAME > database\dump.sql"
    }
    Write-Host ""
}
