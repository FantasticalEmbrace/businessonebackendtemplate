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
        const [rows] = await req.pool.execute(
            'SELECT id, email, first_name, last_name, role, is_active FROM admin_users WHERE id = ? AND is_active = 1',
            [decoded.adminId]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid admin token' });
        }

        req.admin = {
            ...rows[0],
            role: normalizeAdminRole(rows[0].role),
        };
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

/** Chain used on admin routes */
const adminAuth = [authenticateAdmin];

module.exports = {
    authenticateAdmin,
    requirePermission,
    requireDeveloperRole,
    adminAuth,
};
