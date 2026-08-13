#!/usr/bin/env node
'use strict';

/**
 * Set a storefront customer password by email (local/dev recovery when reset email is not set up).
 *
 *   cd backend
 *   node scripts/set-customer-password.js --email you@example.com --password "NewStr0ng!Pass"
 *
 * Loads backend/.env for DB_* (same as other backend scripts).
 */

const bcrypt = require('bcrypt');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');

loadBackendEnv();

function parseArgs(argv) {
    const out = { email: null, password: null };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--email' && argv[i + 1]) {
            out.email = argv[++i];
        } else if (argv[i] === '--password' && argv[i + 1]) {
            out.password = argv[++i];
        }
    }
    return out;
}

async function main() {
    const { email, password } = parseArgs(process.argv);
    if (!email || !password) {
        console.error('Usage: node scripts/set-customer-password.js --email <customer@email> --password "<newPassword>"');
        process.exit(1);
    }
    const emailNorm = String(email).trim().toLowerCase();
    if (password.length < 8) {
        console.error('Password must be at least 8 characters.');
        process.exit(1);
    }

    const pool = createPool({ connectionLimit: 2 });
    try {
        const [rows] = await pool.execute(
            'SELECT id, email FROM users WHERE LOWER(TRIM(email)) = ? AND is_active = 1',
            [emailNorm]
        );
        if (!rows.length) {
            console.error(`No active user found for email: ${emailNorm}`);
            process.exit(1);
        }
        const hash = await bcrypt.hash(password, 12);
        await pool.execute(
            `UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_token_expires = NULL, updated_at = NOW() WHERE id = ?`,
            [hash, rows[0].id]
        );
        console.log(`Updated password for user id ${rows[0].id} (${rows[0].email}). You can sign in now.`);
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
