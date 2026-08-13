#!/usr/bin/env node
/**
 * Create or update an admin panel user (team login).
 * Usage:
 *   node scripts/create-admin-user.js --email staff@example.com --password 'YourPass123' --first Jane --last Doe --role assistant_manager
 *
 * Roles: developer | admin | manager | assistant_manager
 */

const bcrypt = require('bcrypt');
const { loadBackendEnv, createConnection } = require('../utils/dbConfig');
const { ADMIN_ROLES, normalizeAdminRole, ROLE_LABELS } = require('../utils/adminRoles');

loadBackendEnv();

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--email') out.email = argv[++i];
        else if (a === '--password') out.password = argv[++i];
        else if (a === '--first') out.firstName = argv[++i];
        else if (a === '--last') out.lastName = argv[++i];
        else if (a === '--role') out.role = argv[++i];
    }
    return out;
}

async function main() {
    const args = parseArgs(process.argv);
    const email = String(args.email || '').trim().toLowerCase();
    const password = String(args.password || '');
    const firstName = String(args.firstName || '').trim();
    const lastName = String(args.lastName || '').trim();
    const role = normalizeAdminRole(args.role || 'assistant_manager');

    if (!email || !password || password.length < 8) {
        console.error('Usage: --email you@domain.com --password "8+ chars" --first Name --last Name [--role assistant_manager]');
        process.exit(1);
    }
    if (!firstName || !lastName) {
        console.error('First and last name are required.');
        process.exit(1);
    }
    if (!ADMIN_ROLES.includes(role)) {
        console.error(`Invalid role. Use one of: ${ADMIN_ROLES.join(', ')}`);
        process.exit(1);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const connection = await createConnection();

    try {
        const [existing] = await connection.execute(
            'SELECT id FROM admin_users WHERE email = ?',
            [email]
        );

        if (existing.length) {
            await connection.execute(
                `UPDATE admin_users SET password_hash = ?, first_name = ?, last_name = ?, role = ?, is_active = 1, updated_at = NOW() WHERE email = ?`,
                [passwordHash, firstName, lastName, role, email]
            );
            console.log(`Updated existing account: ${email}`);
        } else {
            await connection.execute(
                `INSERT INTO admin_users (email, password_hash, first_name, last_name, role, is_active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())`,
                [email, passwordHash, firstName, lastName, role]
            );
            console.log(`Created account: ${email}`);
        }

        console.log(`  Role: ${ROLE_LABELS[role] || role}`);
        console.log('  Share the password securely. No approval step — account is active immediately.');
    } finally {
        await connection.end();
    }
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
