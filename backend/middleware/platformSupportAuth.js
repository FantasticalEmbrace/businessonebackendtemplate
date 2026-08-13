'use strict';

const jwt = require('jsonwebtoken');
const { verifyPlatformHubSecret } = require('../utils/platformSupportEnv');

function authenticatePlatformHubSecret(req, res, next) {
    const header =
        req.headers['x-platform-hub-secret'] ||
        req.headers['x-platform-support-key'] ||
        '';
    if (!verifyPlatformHubSecret(header)) {
        return res.status(401).json({ error: 'Invalid platform support credentials' });
    }
    req.platformSupport = { authenticated: true };
    next();
}

async function authenticatePlatformSupportOrAdmin(req, res, next) {
    const platformHeader =
        req.headers['x-platform-hub-secret'] ||
        req.headers['x-platform-support-key'] ||
        '';
    if (verifyPlatformHubSecret(platformHeader)) {
        req.platformSupport = { authenticated: true };
        req.admin = { id: null, role: 'platform', email: 'platform-support' };
        return next();
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Admin or platform support credentials required' });
    if (!process.env.JWT_SECRET) return res.status(500).json({ error: 'Server configuration error' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const [rows] = await req.pool.execute(
            'SELECT id, email, first_name, last_name, role FROM admin_users WHERE id = ? AND is_active = 1',
            [decoded.adminId]
        );
        if (!rows.length) return res.status(401).json({ error: 'Invalid admin token' });
        req.admin = rows[0];
        next();
    } catch {
        return res.status(403).json({ error: 'Invalid admin token' });
    }
}

module.exports = {
    authenticatePlatformHubSecret,
    authenticatePlatformSupportOrAdmin
};
