'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { provisionWebCustomerProfile } = require('../utils/provisionCustomerProfile');

function splitRecipientName(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { firstName: 'Gift', lastName: 'Recipient' };
    if (parts.length === 1) return { firstName: parts[0], lastName: 'Recipient' };
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function trim(value) {
    return String(value || '').trim();
}

async function saveRecipientAddress(db, userId, recipientName, address) {
    const line1 = trim(address?.line1 ?? address?.address_line_1);
    const city = trim(address?.city);
    const state = trim(address?.state);
    const postal = trim(address?.postalCode ?? address?.postal_code);
    if (!line1 || !city || !state || !postal) return;

    const [[existing]] = await db.execute(
        `SELECT id FROM user_addresses WHERE user_id = ? AND type = 'shipping' LIMIT 1`,
        [userId]
    );
    if (existing) return;

    const { firstName, lastName } = splitRecipientName(recipientName);
    await db.execute(
        `INSERT INTO user_addresses
            (user_id, type, first_name, last_name, company,
             address_line_1, address_line_2, city, state, postal_code, country, is_default)
         VALUES (?, 'shipping', ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1)`,
        [
            userId,
            firstName,
            lastName,
            line1,
            trim(address?.line2 ?? address?.address_line_2) || null,
            city,
            state,
            postal,
            trim(address?.country) || 'United States'
        ]
    );
}

/**
 * Find or create a customer account for a gift card recipient.
 * Sends no email — caller handles notifications.
 * @param {import('mysql2/promise').Pool|import('mysql2/promise').PoolConnection} db
 */
async function ensureGiftCardRecipientAccount(db, { email, recipientName, recipientPhone, recipientAddress }) {
    const emailNorm = normalizeEmail(email);
    if (!emailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
        return { userId: null, isNew: false, resetToken: null };
    }

    const { firstName, lastName } = splitRecipientName(recipientName);
    const phone = trim(recipientPhone) || null;

    const [existing] = await db.execute(
        'SELECT id, is_active FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1',
        [emailNorm]
    );

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 7 * 24 * 3600000);

    if (existing.length && existing[0].is_active) {
        const userId = existing[0].id;
        if (phone) {
            await db.execute(
                `UPDATE users SET
                    first_name = CASE WHEN ? != '' THEN ? ELSE first_name END,
                    last_name = CASE WHEN ? != '' THEN ? ELSE last_name END,
                    phone = CASE WHEN ? != '' THEN ? ELSE phone END,
                    updated_at = NOW()
                 WHERE id = ?`,
                [firstName, firstName, lastName, lastName, phone, phone, userId]
            );
        }
        await saveRecipientAddress(db, userId, recipientName, recipientAddress);
        await provisionWebCustomerProfile(db, userId);
        return { userId, isNew: false, resetToken: null };
    }

    const randomPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(randomPassword, 12);

    let userId;
    let isNew = false;

    if (existing.length && !existing[0].is_active) {
        userId = existing[0].id;
        await db.execute(
            `UPDATE users SET password_hash = ?, auth_provider = 'local', first_name = ?, last_name = ?, phone = ?,
                    is_active = 1, email_verified = 0, updated_at = NOW()
             WHERE id = ?`,
            [passwordHash, firstName, lastName, phone, userId]
        );
    } else {
        try {
            const [r] = await db.execute(
                `INSERT INTO users (email, password_hash, auth_provider, first_name, last_name, phone, email_verified)
                 VALUES (?, ?, 'local', ?, ?, ?, 0)`,
                [emailNorm, passwordHash, firstName, lastName, phone]
            );
            userId = r.insertId;
            isNew = true;
        } catch (e) {
            if (e.code !== 'ER_DUP_ENTRY') throw e;
            const [dup] = await db.execute(
                'SELECT id, is_active FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1',
                [emailNorm]
            );
            if (!dup.length) throw e;
            userId = dup[0].id;
            isNew = false;
        }
    }

    await saveRecipientAddress(db, userId, recipientName, recipientAddress);
    await provisionWebCustomerProfile(db, userId);

    await db.execute(
        'UPDATE users SET password_reset_token = ?, password_reset_token_expires = ? WHERE id = ?',
        [resetToken, resetExpires, userId]
    );

    return { userId, isNew, resetToken, email: emailNorm, firstName };
}

module.exports = { ensureGiftCardRecipientAccount, normalizeEmail, splitRecipientName };
