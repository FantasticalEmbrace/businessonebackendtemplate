#!/usr/bin/env node

/**
 * HM Herbs Complete Setup Script
 * 
 * This script handles the complete setup of the HM Herbs application:
 * - Installs dependencies
 * - Sets up environment variables
 * - Creates database and tables
 * - Loads seed data
 * - Creates admin user
 * - Starts the server
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

function execCommand(command, options = {}) {
    try {
        console.log(`🔄 Running: ${command}`);
        const result = execSync(command, { 
            stdio: 'inherit', 
            cwd: options.cwd || process.cwd(),
            ...options 
        });
        console.log(`✅ Command completed successfully: ${command}`);
        return result;
    } catch (error) {
        console.error(`❌ Command failed: ${command}`);
        console.error(`💡 Error details: ${error.message}`);
        
        // Provide helpful suggestions based on common errors
        if (error.message.includes('npm')) {
            console.error('💡 Suggestion: Make sure Node.js and npm are installed and up to date');
            console.error('   You can download Node.js from: https://nodejs.org/');
        } else if (error.message.includes('permission')) {
            console.error('💡 Suggestion: Try running with elevated permissions or check file permissions');
        } else if (error.message.includes('ENOENT')) {
            console.error('💡 Suggestion: Check if the required files/directories exist');
        } else if (error.message.includes('ECONNREFUSED')) {
            console.error('💡 Suggestion: Check your internet connection or firewall settings');
        }
        
        console.error('📋 For more help, please check the README.md file or contact support');
        throw error;
    }
}

async function setupEnvironment() {
    console.log('🔧 Setting up environment variables...');
    
    const envPath = path.join(__dirname, 'backend', '.env');
    const envExamplePath = path.join(__dirname, 'backend', '.env.example');
    
    if (!fs.existsSync(envPath)) {
        if (fs.existsSync(envExamplePath)) {
            fs.copyFileSync(envExamplePath, envPath);
            console.log('✅ Created .env file from template');
        } else {
            // Create basic .env file with improved configuration
            const envContent = `# HM Herbs Environment Configuration
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:8000

# Production Configuration (update for deployment)
PRODUCTION_DOMAIN=your-domain.com

# Database Configuration
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=hmherbs

# Security (auto-generated secure keys)
JWT_SECRET=${require('crypto').randomBytes(32).toString('hex')}
POS_ENCRYPTION_KEY=${require('crypto').randomBytes(32).toString('hex')}

# Logging
LOG_LEVEL=info

# Optional: Redis for caching
# REDIS_URL=redis://localhost:6379

# Optional: Email configuration
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=your_email@gmail.com
# SMTP_PASS=your_email_password
`;
            fs.writeFileSync(envPath, envContent);
            console.log('✅ Created basic .env file');
        }
    } else {
        console.log('✅ .env file already exists');
    }
    
    // Get database credentials
    console.log('\n📋 Database Setup:');
    const dbPassword = await question('Enter MySQL root password (press Enter if no password): ');
    
    // Update .env with database password if provided
    if (dbPassword.trim()) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        envContent = envContent.replace(/DB_PASSWORD=.*/, `DB_PASSWORD=${dbPassword}`);
        fs.writeFileSync(envPath, envContent);
        console.log('✅ Updated database password in .env');
    }
    
    return dbPassword;
}

async function setupDatabase(dbPassword) {
    console.log('\n💾 Setting up database...');
    
    const passwordFlag = dbPassword ? `-p${dbPassword}` : '';
    
    try {
        // Create database
        console.log('🔄 Creating database...');
        execCommand(`mysql -u root ${passwordFlag} -e "CREATE DATABASE IF NOT EXISTS hmherbs;"`);
        console.log('✅ Database created');
        
        // Run schema
        console.log('🔄 Creating tables...');
        execCommand(`mysql -u root ${passwordFlag} hmherbs < database/schema.sql`);
        console.log('✅ Tables created');
        
        // Load seed data
        console.log('🔄 Loading seed data...');
        execCommand(`mysql -u root ${passwordFlag} hmherbs < database/seed-data.sql`);
        console.log('✅ Seed data loaded');
        
    } catch (error) {
        console.error('❌ Database setup failed. Please check:');
        console.error('  1. MySQL is running');
        console.error('  2. Root password is correct');
        console.error('  3. You have permission to create databases');
        throw error;
    }
}

async function installDependencies() {
    console.log('\n📦 Installing dependencies...');
    
    // Install backend dependencies
    console.log('🔄 Installing backend dependencies...');
    execCommand('npm install', { cwd: path.join(__dirname, 'backend') });
    console.log('✅ Backend dependencies installed');
    
    // Check if frontend has dependencies
    const frontendPackageJson = path.join(__dirname, 'package.json');
    if (fs.existsSync(frontendPackageJson)) {
        console.log('🔄 Installing frontend dependencies...');
        execCommand('npm install');
        console.log('✅ Frontend dependencies installed');
    }
}

async function createVSCodeConfig() {
    console.log('\n🔧 Setting up VS Code configuration...');
    
    const vscodeDir = path.join(__dirname, '.vscode');
    if (!fs.existsSync(vscodeDir)) {
        fs.mkdirSync(vscodeDir);
    }
    
    // Create tasks.json
    const tasksConfig = {
        "version": "2.0.0",
        "tasks": [
            {
                "label": "Start HM Herbs Backend",
                "type": "shell",
                "command": "npm",
                "args": ["start"],
                "options": {
                    "cwd": "${workspaceFolder}/backend"
                },
                "group": {
                    "kind": "build",
                    "isDefault": true
                },
                "presentation": {
                    "echo": true,
                    "reveal": "always",
                    "focus": false,
                    "panel": "new"
                },
                "problemMatcher": []
            },
            {
                "label": "Reset Admin Password",
                "type": "shell",
                "command": "node",
                "args": ["scripts/reset-admin-password.js"],
                "options": {
                    "cwd": "${workspaceFolder}/backend"
                },
                "group": "build",
                "presentation": {
                    "echo": true,
                    "reveal": "always",
                    "focus": true,
                    "panel": "new"
                }
            }
        ]
    };
    
    fs.writeFileSync(
        path.join(vscodeDir, 'tasks.json'),
        JSON.stringify(tasksConfig, null, 2)
    );
    
    // Create launch.json
    const launchConfig = {
        "version": "0.2.0",
        "configurations": [
            {
                "name": "Start HM Herbs Backend",
                "type": "node",
                "request": "launch",
                "program": "${workspaceFolder:Backend}/server.js",
                "cwd": "${workspaceFolder:Backend}",
                "env": {
                    "NODE_ENV": "development"
                },
                "console": "integratedTerminal",
                "restart": true,
                "runtimeExecutable": "node"
            }
        ]
    };
    
    fs.writeFileSync(
        path.join(vscodeDir, 'launch.json'),
        JSON.stringify(launchConfig, null, 2)
    );
    
    // Create settings.json
    const settingsConfig = {
        "liveServer.settings.port": 8000,
        "liveServer.settings.root": "/",
        "liveServer.settings.CustomBrowser": "chrome",
        "files.associations": {
            "*.html": "html"
        }
    };
    
    fs.writeFileSync(
        path.join(vscodeDir, 'settings.json'),
        JSON.stringify(settingsConfig, null, 2)
    );
    
    console.log('✅ VS Code configuration created');
}

async function createStartupScript() {
    console.log('\n📝 Creating startup scripts...');
    
    // Create start.js for easy startup
    const startScript = `#!/usr/bin/env node

/**
 * HM Herbs Quick Start Script
 * Run this to start the backend server
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🌿 Starting HM Herbs Backend Server...');

const server = spawn('npm', ['start'], {
    cwd: path.join(__dirname, 'backend'),
    stdio: 'inherit'
});

server.on('close', (code) => {
    console.log(\`\\n🛑 Server stopped with code \${code}\`);
});

server.on('error', (error) => {
    console.error('❌ Failed to start server:', error.message);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('\\n👋 Shutting down server...');
    server.kill('SIGINT');
});
`;
    
    fs.writeFileSync(path.join(__dirname, 'start.js'), startScript);
    
    // Create package.json script if it doesn't exist
    const packageJsonPath = path.join(__dirname, 'package.json');
    let packageJson = {};
    
    if (fs.existsSync(packageJsonPath)) {
        packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } else {
        packageJson = {
            "name": "hmherbs",
            "version": "1.0.0",
            "description": "HM Herbs & Vitamins E-commerce Platform"
        };
    }
    
    if (!packageJson.scripts) {
        packageJson.scripts = {};
    }
    
    packageJson.scripts = {
        ...packageJson.scripts,
        "start": "node start.js",
        "backend": "cd backend && npm start",
        "setup": "node setup.js",
        "reset-password": "cd backend && node scripts/reset-admin-password.js"
    };
    
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    
    console.log('✅ Startup scripts created');
}

async function main() {
    console.log('🌿 HM Herbs Complete Setup\n');
    console.log('This script will set up everything you need to run HM Herbs locally.\n');
    
    try {
        // Install dependencies
        await installDependencies();
        
        // Setup environment
        const dbPassword = await setupEnvironment();
        
        // Setup database
        await setupDatabase(dbPassword);
        
        // Create VS Code configuration
        await createVSCodeConfig();
        
        // Create startup scripts
        await createStartupScript();
        
        console.log('\n🎉 Setup Complete!');
        console.log('\n📋 Next Steps:');
        console.log('1. 🔑 Reset admin password:');
        console.log('   npm run reset-password');
        console.log('\n2. 🚀 Start the server:');
        console.log('   npm start');
        console.log('   OR press F5 in VS Code');
        console.log('   OR Ctrl+Shift+P → "Run Task" → "Start HM Herbs Backend"');
        console.log('\n3. 🌐 Access your website:');
        console.log('   Frontend: http://localhost:8000');
        console.log('   Admin Panel: http://localhost:8000/admin.html');
        
        const startNow = await question('\n🚀 Would you like to start the server now? (y/n): ');
        
        if (startNow.toLowerCase() === 'y' || startNow.toLowerCase() === 'yes') {
            console.log('\n🌿 Starting HM Herbs Backend Server...');
            
            const server = spawn('npm', ['start'], {
                cwd: path.join(__dirname, 'backend'),
                stdio: 'inherit'
            });
            
            // Handle Ctrl+C
            process.on('SIGINT', () => {
                console.log('\n👋 Shutting down server...');
                server.kill('SIGINT');
                process.exit(0);
            });
        }
        
    } catch (error) {
        console.error('\n❌ Setup failed:', error.message);
        console.error('\n💡 Please check the error above and try again.');
        console.error('You may need to:');
        console.error('  - Install MySQL and make sure it\'s running');
        console.error('  - Check your MySQL credentials');
        console.error('  - Install Node.js dependencies manually');
    }
    
    rl.close();
}

// Handle script termination
process.on('SIGINT', () => {
    console.log('\n\n👋 Setup cancelled');
    rl.close();
    process.exit(0);
});

// Run the setup
if (require.main === module) {
    main();
}

module.exports = { main };
