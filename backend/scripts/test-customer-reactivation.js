'use strict';

require('../utils/dbConfig').loadBackendEnv();
const { createPool } = require('../utils/dbConfig');
const bcrypt = require('bcrypt');
const {
    reactivateCustomerForLocalSignup,
    reactivateCustomerForGoogle,
    findCustomerByEmailAnyStatus
} = require('../utils/customerAccountReactivation');

async function main() {
    const pool = createPool();
    const email = `reactivation-test-${Date.now()}@example.com`;

    try {
        const [ins] = await pool.execute(
            `INSERT INTO users (email, password_hash, auth_provider, first_name, last_name, date_of_birth, is_active, email_verified)
             VALUES (?, ?, 'local', 'Old', 'User', '1990-01-01', 1, 0)`,
            [email, await bcrypt.hash('OldPass1!', 12)]
        );
        const id = ins.insertId;

        try {
            await pool.execute(
                "UPDATE users SET is_active = 0, customer_status = 'inactive' WHERE id = ?",
                [id]
            );
        } catch (e) {
            if (e.code === 'ER_BAD_FIELD_ERROR') {
                await pool.execute('UPDATE users SET is_active = 0 WHERE id = ?', [id]);
            } else {
                throw e;
            }
        }

        await reactivateCustomerForLocalSignup(pool, id, {
            passwordHash: await bcrypt.hash('NewPass1!', 12),
            firstName: 'New',
            lastName: 'Name',
            phone: null,
            dateOfBirth: '1991-02-02',
            email
        });

        let row = await findCustomerByEmailAnyStatus(pool, email);
        if (!row || row.is_active !== 1 || row.first_name !== 'New') {
            throw new Error('Manual reactivation failed');
        }
        console.log('PASS manual reactivation');

        try {
            await pool.execute(
                "UPDATE users SET is_active = 0, customer_status = 'inactive', auth_provider = 'google', oauth_subject = 'google-sub-test' WHERE id = ?",
                [id]
            );
        } catch (e) {
            await pool.execute(
                "UPDATE users SET is_active = 0, auth_provider = 'google', oauth_subject = 'google-sub-test' WHERE id = ?",
                [id]
            );
        }

        await reactivateCustomerForGoogle(pool, id, {
            subject: 'google-sub-test',
            email,
            firstName: 'Google',
            lastName: 'User'
        });

        row = await findCustomerByEmailAnyStatus(pool, email);
        if (!row || row.is_active !== 1 || row.auth_provider !== 'google') {
            throw new Error('Google reactivation failed');
        }
        console.log('PASS google reactivation');
    } finally {
        await pool.execute('DELETE FROM users WHERE email LIKE ?', ['reactivation-test-%@example.com']);
        await pool.end();
    }
}

main().catch((err) => {
    console.error('FAIL', err.message);
    process.exit(1);
});
