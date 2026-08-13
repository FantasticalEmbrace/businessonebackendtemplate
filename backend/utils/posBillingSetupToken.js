'use strict';

const jwt = require('jsonwebtoken');

const PURPOSE = 'pos_billing_setup';
const DEFAULT_EXPIRY = '7d';

function createSetupToken({ adminId, expiresIn = DEFAULT_EXPIRY } = {}) {
    if (!process.env.JWT_SECRET) {
        const err = new Error('JWT_SECRET is not configured');
        err.code = 'SERVER_MISCONFIGURED';
        throw err;
    }
    return jwt.sign(
        {
            purpose: PURPOSE,
            adminId: adminId || null
        },
        process.env.JWT_SECRET,
        { expiresIn }
    );
}

function verifySetupToken(token) {
    if (!token || !process.env.JWT_SECRET) return null;
    try {
        const decoded = jwt.verify(String(token).trim(), process.env.JWT_SECRET);
        if (decoded.purpose !== PURPOSE) return null;
        return decoded;
    } catch {
        return null;
    }
}

module.exports = {
    createSetupToken,
    verifySetupToken,
    DEFAULT_EXPIRY
};
