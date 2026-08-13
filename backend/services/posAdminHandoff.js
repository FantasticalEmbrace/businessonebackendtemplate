'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { normalizeAdminRole, allowedSectionsForRole, defaultSectionForRole, ROLE_LABELS } = require('../utils/adminRoles');

function requireJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        const err = new Error('Server configuration error');
        err.code = 'SERVER_CONFIG';
        throw err;
    }
    return secret;
}

async function createHandoffCode(pool, employeeId, adminUserId) {
    const code = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 90 * 1000);

    await pool.execute(
        `INSERT INTO pos_admin_handoffs (code, admin_user_id, employee_id, expires_at)
         VALUES (?, ?, ?, ?)`,
        [code, adminUserId, employeeId, expiresAt]
    );

    return { code, expiresAt: expiresAt.toISOString() };
}

async function exchangeHandoffCode(pool, code) {
    const normalized = String(code || '').trim();
    if (!normalized) {
        const err = new Error('Handoff code required');
        err.code = 'INVALID_HANDOFF';
        throw err;
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
            `SELECT code, admin_user_id, employee_id, expires_at, used_at
             FROM pos_admin_handoffs
             WHERE code = ?
             FOR UPDATE`,
            [normalized]
        );
        const row = rows[0];
        if (!row) {
            const err = new Error('Invalid or expired handoff');
            err.code = 'INVALID_HANDOFF';
            throw err;
        }
        if (row.used_at) {
            const err = new Error('Handoff code already used');
            err.code = 'INVALID_HANDOFF';
            throw err;
        }
        if (new Date(row.expires_at) <= new Date()) {
            const err = new Error('Handoff code expired');
            err.code = 'INVALID_HANDOFF';
            throw err;
        }

        const [admins] = await connection.execute(
            `SELECT id, email, first_name, last_name, role, is_active
             FROM admin_users WHERE id = ? LIMIT 1`,
            [row.admin_user_id]
        );
        const admin = admins[0];
        if (!admin?.is_active) {
            const err = new Error('Admin account is not active');
            err.code = 'ADMIN_INACTIVE';
            throw err;
        }

        const [employees] = await connection.execute(
            `SELECT id, admin_user_id, is_active FROM pos_employees WHERE id = ? LIMIT 1`,
            [row.employee_id]
        );
        const employee = employees[0];
        if (!employee?.is_active || Number(employee.admin_user_id) !== Number(admin.id)) {
            const err = new Error('Employee is not authorized for admin access');
            err.code = 'ADMIN_ACCESS_DENIED';
            throw err;
        }

        await connection.execute(
            `UPDATE pos_admin_handoffs SET used_at = CURRENT_TIMESTAMP WHERE code = ?`,
            [normalized]
        );
        await connection.execute(`UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?`, [admin.id]);
        await connection.commit();

        const role = normalizeAdminRole(admin.role);
        const token = jwt.sign({ adminId: admin.id, via: 'pos_handoff' }, requireJwtSecret(), { expiresIn: '8h' });

        return {
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
            defaultSection: defaultSectionForRole(role)
        };
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
}

module.exports = {
    createHandoffCode,
    exchangeHandoffCode
};
