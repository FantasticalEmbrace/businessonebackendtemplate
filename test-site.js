// HM Herbs Site Functionality Test Script
// Checks if all components are properly set up and working

const fs = require('fs');
const path = require('path');
const http = require('http');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkFile(filePath, description) {
    const fullPath = path.join(__dirname, filePath);
    if (fs.existsSync(fullPath)) {
        log(`✓ ${description}`, 'green');
        return true;
    } else {
        log(`✗ ${description} - NOT FOUND: ${filePath}`, 'red');
        return false;
    }
}

function checkDirectory(dirPath, description) {
    const fullPath = path.join(__dirname, dirPath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        log(`✓ ${description}`, 'green');
        return true;
    } else {
        log(`✗ ${description} - NOT FOUND: ${dirPath}`, 'red');
        return false;
    }
}

function checkPackageInstalled(packageName, description) {
    try {
        require.resolve(packageName);
        log(`✓ ${description}`, 'green');
        return true;
    } catch (e) {
        log(`✗ ${description} - NOT INSTALLED: ${packageName}`, 'yellow');
        return false;
    }
}

function testBackendAPI(endpoint, description) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'localhost',
            port: 3001,
            path: endpoint,
            method: 'GET',
            timeout: 2000
        };

        const req = http.request(options, (res) => {
            if (res.statusCode === 200 || res.statusCode === 404) {
                log(`✓ ${description} - Backend responding`, 'green');
                resolve(true);
            } else {
                log(`✗ ${description} - Status: ${res.statusCode}`, 'yellow');
                resolve(false);
            }
        });

        req.on('error', (_e) => {
            log(`✗ ${description} - Backend not running or not accessible`, 'red');
            resolve(false);
        });

        req.on('timeout', () => {
            req.destroy();
            log(`✗ ${description} - Request timeout`, 'red');
            resolve(false);
        });

        req.end();
    });
}

async function runTests() {
    log('\n=== HM Herbs Site Functionality Test ===\n', 'blue');

    let passed = 0;
    let failed = 0;
    let warnings = 0;

    // File Structure Tests
    log('\n📁 File Structure:', 'blue');
    if (checkFile('index.html', 'Main page (index.html)')) passed++; else failed++;
    if (checkFile('products.html', 'Products page')) passed++; else failed++;
    if (checkFile('admin.html', 'Admin panel')) passed++; else failed++;
    if (checkFile('script.js', 'Main JavaScript')) passed++; else failed++;
    if (checkFile('styles.css', 'Main stylesheet')) passed++; else failed++;
    if (checkFile('backend/server.js', 'Backend server')) passed++; else failed++;
    if (checkFile('database/schema.sql', 'Database schema')) passed++; else failed++;

    // Directory Tests
    log('\n📂 Directories:', 'blue');
    if (checkDirectory('js', 'JavaScript files directory')) passed++; else failed++;
    if (checkDirectory('css', 'CSS files directory')) passed++; else failed++;
    if (checkDirectory('images', 'Images directory')) passed++; else failed++;
    if (checkDirectory('backend/routes', 'Backend routes')) passed++; else failed++;
    if (checkDirectory('backend/services', 'Backend services')) passed++; else failed++;

    // Key JavaScript Files
    log('\n📜 JavaScript Files:', 'blue');
    if (checkFile('js/edsa-booking.js', 'EDSA booking system')) passed++; else failed++;
    if (checkFile('js/products.js', 'Products page script')) passed++; else failed++;
    if (checkFile('js/pwa-manager.js', 'PWA manager')) passed++; else failed++;
    if (checkFile('admin-app.js', 'Admin panel script')) passed++; else failed++;

    // CSS Files
    log('\n🎨 CSS Files:', 'blue');
    if (checkFile('css/edsa-booking.css', 'EDSA booking styles')) passed++; else failed++;
    if (checkFile('css/products.css', 'Products page styles')) passed++; else failed++;

    // Backend Dependencies
    log('\n📦 Backend Dependencies:', 'blue');
    const backendPath = path.join(__dirname, 'backend');
    if (fs.existsSync(path.join(backendPath, 'node_modules'))) {
        log('✓ node_modules exists in backend', 'green');
        passed++;
    } else {
        log('✗ node_modules NOT FOUND - Run: cd backend && npm install', 'red');
        failed++;
    }

    // Check Critical Backend Packages
    log('\n🔧 Critical Packages:', 'blue');
    if (checkPackageInstalled('express', 'Express.js')) passed++; else warnings++;
    if (checkPackageInstalled('mysql2', 'MySQL driver')) passed++; else warnings++;
    if (checkPackageInstalled('jsonwebtoken', 'JWT authentication')) passed++; else warnings++;
    
    // Check Google Calendar (optional)
    try {
        require.resolve('googleapis');
        log('✓ Google Calendar API (googleapis) - installed', 'green');
        passed++;
    } catch (e) {
        log('⚠ Google Calendar API (googleapis) - not installed (optional)', 'yellow');
        log('  Install with: cd backend && npm install googleapis', 'yellow');
        warnings++;
    }

    // Environment File
    log('\n⚙️  Configuration:', 'blue');
    if (checkFile('backend/.env', 'Backend .env file')) {
        passed++;
    } else {
        if (checkFile('backend/.env.example', '.env.example exists')) {
            log('⚠ Create .env file: cp backend/.env.example backend/.env', 'yellow');
            warnings++;
        } else {
            log('✗ No .env or .env.example found', 'red');
            failed++;
        }
    }

    // Backend API Tests
    log('\n🌐 Backend API Tests:', 'blue');
    const apiTests = [
        ['/api/health', 'Health check endpoint'],
        ['/api/public/products?limit=1', 'Products API'],
        ['/api/edsa/info', 'EDSA info API']
    ];

    for (const [endpoint, description] of apiTests) {
        const result = await testBackendAPI(endpoint, description);
        if (result) passed++; else warnings++;
    }

    // Summary
    log('\n=== Test Summary ===', 'blue');
    log(`✓ Passed: ${passed}`, 'green');
    if (warnings > 0) {
        log(`⚠ Warnings: ${warnings}`, 'yellow');
    }
    if (failed > 0) {
        log(`✗ Failed: ${failed}`, 'red');
    }

    log('\n📋 Next Steps:', 'blue');
    if (failed > 0 || warnings > 0) {
        log('1. Install missing dependencies: cd backend && npm install', 'yellow');
        log('2. Create .env file: cp backend/.env.example backend/.env (prod: .env.linode.example)', 'yellow');
        log('3. Configure database in backend/.env', 'yellow');
        log('4. Run database schema: mysql -u root -p hmherbs < database/schema.sql', 'yellow');
        log('5. Start backend: cd backend && npm start', 'yellow');
        log('6. Start frontend: python -m http.server 8000', 'yellow');
    } else {
        log('✓ All tests passed! Your site is ready to use.', 'green');
        log('\nTo start the site:', 'blue');
        log('1. Backend: cd backend && npm start', 'yellow');
        log('2. Frontend: python -m http.server 8000', 'yellow');
        log('3. Open: http://localhost:8000', 'yellow');
    }

    log('\n');
}

// Run tests
runTests().catch(console.error);

