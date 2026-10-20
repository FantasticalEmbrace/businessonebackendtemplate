'use strict';

const jwt = require('jsonwebtoken');
const {
    normalizeAdminRole,
    ROLE_LABELS,
    allowedSectionsForRole,
    defaultSectionForRole,
    canManageStoreHours
} = require('../utils/adminRoles');
const { resolveCanManageStoreHours } = require('../utils/storeHoursAccess');

async function buildAdminAuthSuccess(pool, admin) {
    if (!process.env.JWT_SECRET) {
        const err = new Error('Server configuration error');
        err.status = 500;
        throw err;
    }
    await pool.execute(
        'UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
        [admin.id]
    );
    const role = normalizeAdminRole(admin.role);
    const canHours = await resolveCanManageStoreHours(pool, role, admin.id);
    const token = jwt.sign({ adminId: admin.id }, process.env.JWT_SECRET, { expiresIn: '8h' });
    return {
        message: 'Admin login successful',
        token,
        admin: {
            id: admin.id,
            email: admin.email,
            firstName: admin.first_name,
            lastName: admin.last_name,
            role,
            roleLabel: ROLE_LABELS[role] || role
        },
        allowedSections: allowedSectionsForRole(role),
        defaultSection: defaultSectionForRole(role),
        canManageStoreHours: canHours,
        canManageStoreHoursDelegation: canManageStoreHours(role)
    };
}

module.exports = { buildAdminAuthSuccess };
