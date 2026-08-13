'use strict';

function trim(value) {
    return String(value || '').trim();
}

/**
 * Normalize optional mailing address from registration payload.
 * Returns null when the customer left address fields blank.
 * @throws {Error} when partially filled
 */
function normalizeRegistrationMailingAddress(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const line1 = trim(raw.addressLine1 || raw.address_line_1);
    const line2 = trim(raw.addressLine2 || raw.address_line_2);
    const city = trim(raw.city);
    const state = trim(raw.state).toUpperCase();
    const postal = trim(raw.postalCode || raw.postal_code);
    const country = trim(raw.country) || 'United States';

    const any = [line1, line2, city, state, postal].some(Boolean);
    if (!any) return null;

    if (!line1 || !city || !state || !postal) {
        const err = new Error(
            'Mailing address requires street, city, state, and ZIP when any address field is filled.'
        );
        err.code = 'INCOMPLETE_MAILING_ADDRESS';
        throw err;
    }

    if (state.length !== 2 || !/^[A-Z]{2}$/.test(state)) {
        const err = new Error('State must be a 2-letter code (e.g. MS).');
        err.code = 'INVALID_STATE';
        throw err;
    }

    if (!/^\d{5}(-\d{4})?$/.test(postal)) {
        const err = new Error('ZIP code must be 5 digits or ZIP+4 (12345 or 12345-6789).');
        err.code = 'INVALID_POSTAL';
        throw err;
    }

    return { line1, line2, city, state, postal, country };
}

async function saveRegistrationMailingAddress(pool, userId, { firstName, lastName, mailingAddress }) {
    const normalized = normalizeRegistrationMailingAddress(mailingAddress);
    if (!normalized) return null;

    const [result] = await pool.execute(
        `INSERT INTO user_addresses
            (user_id, type, first_name, last_name, company,
             address_line_1, address_line_2, city, state, postal_code, country, is_default)
         VALUES (?, 'shipping', ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1)`,
        [
            userId,
            firstName,
            lastName,
            normalized.line1,
            normalized.line2 || null,
            normalized.city,
            normalized.state,
            normalized.postal,
            normalized.country
        ]
    );

    return result.insertId;
}

module.exports = {
    normalizeRegistrationMailingAddress,
    saveRegistrationMailingAddress
};
