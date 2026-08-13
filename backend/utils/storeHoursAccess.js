'use strict';

const { normalizeAdminRole, canManageStoreHours } = require('./adminRoles');

async function managerMayEditStoreHours(pool, adminUserId) {
    if (!pool || !adminUserId) return false;
    const [rows] = await pool.execute(
        'SELECT can_manage_store_hours FROM admin_users WHERE id = ? LIMIT 1',
        [adminUserId]
    );
    return Boolean(rows?.[0]?.can_manage_store_hours);
}

async function resolveCanManageStoreHours(pool, role, adminUserId) {
    const normalized = normalizeAdminRole(role);
    if (canManageStoreHours(normalized)) return true;
    if (normalized === 'manager' && adminUserId && (await managerMayEditStoreHours(pool, adminUserId))) {
        return true;
    }
    return false;
}

module.exports = {
    managerMayEditStoreHours,
    resolveCanManageStoreHours,
};
