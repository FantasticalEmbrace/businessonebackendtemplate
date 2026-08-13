'use strict';

const PROVIDER = 'google';

async function findCustomerByEmailAnyStatus(pool, email) {
    const [rows] = await pool.execute(
        `SELECT id, email, first_name, last_name, phone, date_of_birth, customer_number, is_active,
                auth_provider, oauth_subject
           FROM users
          WHERE LOWER(TRIM(email)) = ?
          LIMIT 1`,
        [String(email).trim().toLowerCase()]
    );
    return rows[0] || null;
}

async function findCustomerByOAuthAnyStatus(pool, subject, provider = PROVIDER) {
    const [rows] = await pool.execute(
        `SELECT id, email, first_name, last_name, phone, date_of_birth, customer_number, is_active,
                auth_provider, oauth_subject
           FROM users
          WHERE auth_provider = ? AND oauth_subject = ?
          LIMIT 1`,
        [provider, subject]
    );
    return rows[0] || null;
}

async function loadCustomerRow(pool, userId) {
    const [rows] = await pool.execute(
        `SELECT id, email, first_name, last_name, phone, date_of_birth, customer_number, is_active
           FROM users WHERE id = ?`,
        [userId]
    );
    return rows[0] || null;
}

async function reactivateCustomerForLocalSignup(pool, userId, {
    passwordHash,
    firstName,
    lastName,
    phone,
    dateOfBirth,
    email
}) {
    try {
        await pool.execute(
            `UPDATE users
                SET is_active = 1,
                    customer_status = 'active',
                    password_hash = ?,
                    auth_provider = 'local',
                    oauth_subject = NULL,
                    first_name = ?,
                    last_name = ?,
                    phone = ?,
                    date_of_birth = ?,
                    email = ?,
                    email_verified = 0,
                    last_login = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
            [passwordHash, firstName, lastName, phone || null, dateOfBirth, email, userId]
        );
    } catch (e) {
        if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
        await pool.execute(
            `UPDATE users
                SET is_active = 1,
                    password_hash = ?,
                    auth_provider = 'local',
                    oauth_subject = NULL,
                    first_name = ?,
                    last_name = ?,
                    phone = ?,
                    date_of_birth = ?,
                    email = ?,
                    email_verified = 0,
                    last_login = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
            [passwordHash, firstName, lastName, phone || null, dateOfBirth, email, userId]
        );
    }
}

async function reactivateCustomerForGoogle(pool, userId, profile) {
    try {
        await pool.execute(
            `UPDATE users
                SET is_active = 1,
                    customer_status = 'active',
                    auth_provider = ?,
                    oauth_subject = ?,
                    email = ?,
                    first_name = COALESCE(NULLIF(?, ''), first_name, ?),
                    last_name = COALESCE(NULLIF(?, ''), last_name, ?),
                    email_verified = 1,
                    last_login = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
            [
                PROVIDER,
                profile.subject,
                profile.email,
                profile.firstName,
                profile.firstName,
                profile.lastName,
                profile.lastName,
                userId
            ]
        );
    } catch (e) {
        if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
        await pool.execute(
            `UPDATE users
                SET is_active = 1,
                    auth_provider = ?,
                    oauth_subject = ?,
                    email = ?,
                    first_name = COALESCE(NULLIF(?, ''), first_name, ?),
                    last_name = COALESCE(NULLIF(?, ''), last_name, ?),
                    email_verified = 1,
                    last_login = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
            [
                PROVIDER,
                profile.subject,
                profile.email,
                profile.firstName,
                profile.firstName,
                profile.lastName,
                profile.lastName,
                userId
            ]
        );
    }
}

module.exports = {
    findCustomerByEmailAnyStatus,
    findCustomerByOAuthAnyStatus,
    loadCustomerRow,
    reactivateCustomerForLocalSignup,
    reactivateCustomerForGoogle
};
