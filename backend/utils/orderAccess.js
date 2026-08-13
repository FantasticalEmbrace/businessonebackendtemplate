'use strict';

const jwt = require('jsonwebtoken');

async function getAuthenticatedUserFromRequest(req) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return null;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = Number(decoded?.userId);
        if (!Number.isInteger(userId) || userId <= 0) return null;

        const [rows] = await req.pool.execute(
            'SELECT id, email, tax_exempt, tax_exempt_id, customer_type FROM users WHERE id = ? LIMIT 1',
            [userId]
        );
        return rows[0] || null;
    } catch {
        return null;
    }
}

/**
 * Customer may access their order; guest must supply matching email in body or query.
 */
async function assertCanAccessOrder(req, orderRow, { email } = {}) {
    const authUser = await getAuthenticatedUserFromRequest(req);

    if (orderRow.user_id) {
        if (!authUser || Number(authUser.id) !== Number(orderRow.user_id)) {
            const err = new Error('FORBIDDEN');
            err.status = 403;
            throw err;
        }
        return authUser;
    }

    const guestEmail = String(email || req.body?.customerEmail || req.body?.email || req.query?.email || '')
        .trim()
        .toLowerCase();
    if (guestEmail && String(orderRow.email || '').trim().toLowerCase() === guestEmail) {
        return null;
    }

    const err = new Error('FORBIDDEN');
    err.status = 403;
    throw err;
}

function assertInternalOrderSecret(req) {
    const expected = String(process.env.ORDER_INTERNAL_SECRET || '').trim();
    if (!expected) return false;
    const provided = String(req.headers['x-internal-order-secret'] || '').trim();
    return provided && provided === expected;
}

module.exports = {
    getAuthenticatedUserFromRequest,
    assertCanAccessOrder,
    assertInternalOrderSecret
};
