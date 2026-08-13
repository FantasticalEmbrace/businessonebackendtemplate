#!/usr/bin/env node

/**
 * Quick script to set admin password to 'admin1'
 * Usage: node set-admin-password.js
 */

const bcrypt = require('bcrypt');
const { loadBackendEnv, createConnection } = require('../utils/dbConfig');

loadBackendEnv();

async function setAdminPassword() {
    console.log('🔑 Setting admin password to "admin1"...\n');

    try {
        const connection = await createConnection();
        console.log('✅ Connected to database\n');

        // Hash the password
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash('admin1', saltRounds);
        console.log('✅ Password hashed\n');

        // Check if admin exists
        const [admins] = await connection.execute(
            'SELECT id, email FROM admin_users WHERE email = ?',
            ['hmherbs1@gmail.com']
        );

        if (admins.length === 0) {
            // Create admin if doesn't exist
            await connection.execute(
                `INSERT INTO admin_users (email, password_hash, first_name, last_name, role, is_active) 
                 VALUES (?, ?, 'Admin', 'User', 'admin', 1)`,
                ['hmherbs1@gmail.com', passwordHash]
            );
            console.log('✅ Admin user created\n');
        } else {
            // Update existing admin
            await connection.execute(
                'UPDATE admin_users SET password_hash = ?, updated_at = NOW() WHERE email = ?',
                [passwordHash, 'hmherbs1@gmail.com']
            );
            console.log('✅ Admin password updated\n');
        }

        await connection.end();
        
        console.log('📋 Admin Credentials:');
        console.log('   Email: hmherbs1@gmail.com');
        console.log('   Password: admin1');
        console.log('\n✅ Password set successfully!');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.error('\n💡 Make sure MySQL is running and check your .env file for database credentials.');
        }
        process.exit(1);
    }
}

setAdminPassword();

