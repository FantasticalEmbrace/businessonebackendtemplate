const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const {
    normalizeAdminRole,
    hasMinAdminRole,
    isDeveloperRole,
} = require('../utils/adminRoles');

async function authenticateAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Admin access token required' });
    }

    if (!process.env.JWT_SECRET) {
        logger.error('CRITICAL: JWT_SECRET environment variable is not set');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        let rows;
        try {
            [rows] = await req.pool.execute(
                'SELECT id, email, first_name, last_name, role, is_active, merchant_id FROM admin_users WHERE id = ? AND is_active = 1',
                [decoded.adminId]
            );
        } catch {
            [rows] = await req.pool.execute(
                'SELECT id, email, first_name, last_name, role, is_active FROM admin_users WHERE id = ? AND is_active = 1',
                [decoded.adminId]
            );
        }

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid admin token' });
        }

        req.admin = {
            ...rows[0],
            role: normalizeAdminRole(rows[0].role),
        };
        if (rows[0].merchant_id) {
            req.merchantId = rows[0].merchant_id;
            req.merchantAccount = req.merchantAccount || { id: rows[0].merchant_id };
        }
        next();
    } catch {
        return res.status(403).json({ error: 'Invalid admin token' });
    }
}

function requirePermission(minRole) {
    return (req, res, next) => {
        if (!hasMinAdminRole(req.admin?.role, minRole)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}

function requireDeveloperRole(req, res, next) {
    if (!isDeveloperRole(req.admin?.role)) {
        return res.status(403).json({ error: 'Developer access required' });
    }
    next();
}

const { isPrincipalStore } = require('../services/storeBranding');

async function requirePrincipalStore(req, res, next) {
    try {
        const principal = await isPrincipalStore(req.pool);
        if (!principal) {
            return res.status(403).json({
                error: 'This feature is only available on the principal Business One store.',
                code: 'PRINCIPAL_STORE_REQUIRED',
            });
        }
        next();
    } catch (error) {
        logger.error('Principal store check failed:', error);
        return res.status(500).json({ error: 'Failed to verify store account' });
    }
}

/** Chain used on admin routes */
const adminAuth = [authenticateAdmin];
const principalAuth = [...adminAuth, requirePrincipalStore];

module.exports = {
    authenticateAdmin,
    requirePermission,
    requireDeveloperRole,
    requirePrincipalStore,
    adminAuth,
    principalAuth,
};
