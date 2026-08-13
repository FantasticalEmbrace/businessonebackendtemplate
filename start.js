#!/usr/bin/env node

/**
 * HM Herbs Quick Start — runs the API server without spawning npm (avoids Windows
 * spawn EINVAL with npm.cmd + shell:false and Node DEP0190 with shell:true).
 */

const { spawn } = require('child_process');
const path = require('path');

const backendDir = path.join(__dirname, 'backend');
const serverEntry = path.join(backendDir, 'server.js');

console.log('🌿 Starting HM Herbs Backend Server...');

const server = spawn(process.execPath, [serverEntry], {
    cwd: backendDir,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env }
});

server.on('close', (code) => {
    if (code === 0) {
        console.log(`\n🛑 Server stopped gracefully`);
    } else {
        console.log(`\n🛑 Server stopped with code ${code}`);
        console.error('💡 Non-zero exit code indicates an error occurred');
    }
});

server.on('error', (error) => {
    console.error('❌ Failed to start server:', error.message);

    if (error.code === 'ENOENT') {
        console.error('💡 Suggestion: Node could not find server.js. Check that backend/server.js exists.');
    } else if (error.code === 'EADDRINUSE') {
        console.error('💡 Suggestion: Port is already in use. Try stopping other servers or change PORT in backend/.env');
    } else if (error.message.includes('permission')) {
        console.error('💡 Suggestion: Try running with elevated permissions');
    }

    console.error('📋 For more help, check the backend/README.md file or contact support');
    process.exit(1);
});

process.on('SIGINT', () => {
    console.log('\n👋 Shutting down server...');
    server.kill('SIGINT');
});
