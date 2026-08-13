'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const logger = require('../utils/logger');
const personnel = require('../services/posPersonnel');
const { hasMinAdminRole, normalizeAdminRole } = require('../utils/adminRoles');

async function authenticateAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Admin access token required' });
    if (!process.env.JWT_SECRET) return res.status(500).json({ error: 'Server configuration error' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const [rows] = await req.pool.execute(
            'SELECT id, email, first_name, last_name, role FROM admin_users WHERE id = ? AND is_active = 1',
            [decoded.adminId]
        );
        if (!rows.length) return res.status(401).json({ error: 'Invalid admin token' });
        req.admin = {
            ...rows[0],
            role: normalizeAdminRole(rows[0].role),
        };
        next();
    } catch {
        return res.status(403).json({ error: 'Invalid admin token' });
    }
}

router.use(authenticateAdmin);

function requireManager(req, res, next) {
    const role = req.admin?.role;
    if (!hasMinAdminRole(role, 'assistant_manager')) {
        return res.status(403).json({ error: 'Manager access required' });
    }
    next();
}

function assertCanChangeRestrictedRegisterPermission(req, body, fieldNames, label) {
    const touched = fieldNames.some((key) => body?.[key] != null);
    if (!touched) return;
    if (!hasMinAdminRole(req.admin?.role, 'admin')) {
        const err = new Error(`Only Admin or Developer can change ${label}`);
        err.status = 403;
        err.code = 'REGISTER_PERMISSION_ADMIN_ONLY';
        throw err;
    }
}

function assertCanChangeRefundPermission(req, body) {
    assertCanChangeRestrictedRegisterPermission(
        req,
        body,
        ['canProcessRefunds', 'can_process_refunds'],
        'refund permission'
    );
}

function assertCanChangeOpenDrawerPermission(req, body) {
    assertCanChangeRestrictedRegisterPermission(
        req,
        body,
        ['canOpenDrawer', 'can_open_drawer'],
        'manual drawer permission'
    );
}

function assertCanChangeViewCostPermission(req, body) {
    assertCanChangeRestrictedRegisterPermission(
        req,
        body,
        ['canViewCost', 'can_view_cost'],
        'view cost permission'
    );
}

function mapPosEmployeeRow(e) {
    return {
        id: e.id,
        employeeCode: e.employee_code,
        firstName: e.first_name,
        lastName: e.last_name,
        email: e.email,
        isActive: Boolean(e.is_active),
        hourlyRate: e.hourly_rate != null ? Number(e.hourly_rate) : null,
        adminUserId: e.admin_user_id != null ? Number(e.admin_user_id) : null,
        canAuthorize: Boolean(e.can_authorize),
        canProcessRefunds: Boolean(e.can_process_refunds),
        canOpenDrawer: Boolean(e.can_open_drawer),
        allowManualDiscounts: Boolean(e.allow_manual_discounts),
        canViewCost: Boolean(e.can_view_cost),
        createdAt: e.created_at,
        updatedAt: e.updated_at,
    };
}

router.get('/employees', async (req, res) => {
    try {
        const employees = await personnel.listEmployees(req.pool);
        res.json({
            employees: employees.map(mapPosEmployeeRow),
        });
    } catch (e) {
        logger.error('List POS employees error:', e);
        res.status(500).json({ error: 'Failed to list employees' });
    }
});

router.post('/employees', requireManager, async (req, res) => {
    try {
        assertCanChangeRefundPermission(req, req.body);
        assertCanChangeOpenDrawerPermission(req, req.body);
        assertCanChangeViewCostPermission(req, req.body);
        const employee = await personnel.createEmployee(req.pool, req.body, req.admin.id);
        res.status(201).json({
            employee: {
                id: employee.id,
                employeeCode: employee.employee_code,
                firstName: employee.first_name,
                lastName: employee.last_name,
                email: employee.email,
                isActive: Boolean(employee.is_active)
            }
        });
    } catch (e) {
        const status = e.status || (e.code === 'ER_DUP_ENTRY' ? 409 : e.code ? 400 : 500);
        res.status(status).json({ error: e.message, code: e.code });
    }
});

router.put('/employees/:id', requireManager, async (req, res) => {
    try {
        assertCanChangeRefundPermission(req, req.body);
        assertCanChangeOpenDrawerPermission(req, req.body);
        assertCanChangeViewCostPermission(req, req.body);
        const employee = await personnel.updateEmployee(req.pool, Number(req.params.id), req.body);
        if (!employee) return res.status(404).json({ error: 'Employee not found' });
        res.json({
            employee: mapPosEmployeeRow(employee),
        });
    } catch (e) {
        res.status(e.status || (e.code ? 400 : 500)).json({ error: e.message, code: e.code });
    }
});

router.put('/register-for-admin/:adminUserId', requireManager, async (req, res) => {
    try {
        assertCanChangeRefundPermission(req, req.body);
        assertCanChangeOpenDrawerPermission(req, req.body);
        assertCanChangeViewCostPermission(req, req.body);
        const adminUserId = Number(req.params.adminUserId);
        if (!Number.isInteger(adminUserId) || adminUserId <= 0) {
            return res.status(400).json({ error: 'Invalid admin user id' });
        }
        const employee = await personnel.upsertRegisterForAdminUser(req.pool, adminUserId, req.body);
        res.json({
            register: employee ? mapPosEmployeeRow(employee) : null,
        });
    } catch (e) {
        const status = e.status || (e.code === 'ER_DUP_ENTRY' ? 409 : e.code ? 400 : 500);
        res.status(status).json({ error: e.message, code: e.code });
    }
});

router.get('/pos-devices', requireManager, async (req, res) => {
    try {
        const { listDevices } = require('../services/posDeviceRegistry');
        const devices = await listDevices(req.pool);
        res.json({
            devices: devices.map((d) => ({
                id: d.id,
                deviceLabel: d.device_label,
                keyPrefix: d.key_prefix,
                isActive: Boolean(d.is_active),
                lastSeenAt: d.last_seen_at,
                createdAt: d.created_at
            }))
        });
    } catch (e) {
        logger.error('List POS devices error:', e);
        res.status(500).json({ error: 'Failed to list POS devices' });
    }
});

router.post('/pos-devices', requireManager, async (req, res) => {
    try {
        const { createDevice } = require('../services/posDeviceRegistry');
        const created = await createDevice(req.pool, req.body?.deviceLabel || req.body?.device_label);
        res.status(201).json({
            device: {
                id: created.id,
                deviceLabel: created.deviceLabel,
                keyPrefix: created.keyPrefix
            },
            apiKey: created.apiKey
        });
    } catch (e) {
        const status =
            e.code === 'DUPLICATE_DEVICE_LABEL' ? 409 : e.code ? 400 : 500;
        res.status(status).json({
            error: e.message,
            code: e.code,
            existingDeviceId: e.existingDeviceId,
        });
    }
});

router.post('/pos-devices/:id/regenerate-key', requireManager, async (req, res) => {
    try {
        const { regenerateDeviceKey } = require('../services/posDeviceRegistry');
        const regenerated = await regenerateDeviceKey(req.pool, Number(req.params.id));
        res.json({
            device: {
                id: regenerated.id,
                deviceLabel: regenerated.deviceLabel,
                keyPrefix: regenerated.keyPrefix,
            },
            apiKey: regenerated.apiKey,
        });
    } catch (e) {
        const status = e.code === 'DEVICE_NOT_FOUND' ? 404 : e.code ? 400 : 500;
        res.status(status).json({ error: e.message, code: e.code });
    }
});

router.delete('/pos-devices/:id', requireManager, async (req, res) => {
    try {
        const { revokeDevice } = require('../services/posDeviceRegistry');
        const ok = await revokeDevice(req.pool, Number(req.params.id));
        if (!ok) return res.status(404).json({ error: 'Device not found' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to revoke device' });
    }
});

router.get('/shifts/scheduled', async (req, res) => {
    try {
        const rows = await personnel.listScheduledShifts(req.pool, {
            from: req.query.from,
            to: req.query.to,
            employeeId: req.query.employeeId ? Number(req.query.employeeId) : null
        });
        res.json({ shifts: rows });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load scheduled shifts' });
    }
});

router.post('/shifts/scheduled', requireManager, async (req, res) => {
    try {
        const id = await personnel.createScheduledShift(
            req.pool,
            {
                employeeId: Number(req.body.employeeId),
                startsAt: req.body.startsAt,
                endsAt: req.body.endsAt,
                notes: req.body.notes
            },
            req.admin.id
        );
        res.status(201).json({ id });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

router.get('/timesheets', async (req, res) => {
    try {
        const entries = await personnel.listTimeEntries(req.pool, {
            from: req.query.from,
            to: req.query.to,
            employeeId: req.query.employeeId ? Number(req.query.employeeId) : null
        });
        res.json({ entries });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load timesheets' });
    }
});

router.get('/shift-sessions', async (req, res) => {
    try {
        let sql = `
            SELECT ss.*, e.employee_code, e.first_name, e.last_name
            FROM pos_shift_sessions ss
            JOIN pos_employees e ON e.id = ss.employee_id WHERE 1=1`;
        const params = [];
        if (req.query.from) {
            sql += ' AND ss.opened_at >= ?';
            params.push(req.query.from);
        }
        if (req.query.to) {
            sql += ' AND ss.opened_at <= ?';
            params.push(req.query.to);
        }
        if (req.query.employeeId) {
            sql += ' AND ss.employee_id = ?';
            params.push(Number(req.query.employeeId));
        }
        sql += ' ORDER BY ss.opened_at DESC LIMIT 500';
        const [rows] = await req.pool.execute(sql, params);
        res.json({ sessions: rows });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load shift sessions' });
    }
});

router.get('/reports/shift/:id', async (req, res) => {
    try {
        const report = await personnel.getShiftReport(req.pool, Number(req.params.id));
        if (!report) return res.status(404).json({ error: 'Shift not found' });
        res.json(report);
    } catch (e) {
        res.status(500).json({ error: 'Failed to generate shift report' });
    }
});

router.get('/reports/sales-summary', async (req, res) => {
    try {
        const from = req.query.from || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        const to = req.query.to || new Date().toISOString().slice(0, 10);
        const [rows] = await req.pool.execute(
            `SELECT DATE(created_at) AS sale_date,
                    COUNT(*) AS order_count,
                    COALESCE(SUM(total_amount), 0) AS total_sales,
                    COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END), 0) AS cash_total,
                    COALESCE(SUM(CASE WHEN payment_method = 'check' THEN total_amount ELSE 0 END), 0) AS check_total,
                    COALESCE(SUM(CASE WHEN payment_method = 'card_terminal' THEN total_amount ELSE 0 END), 0) AS card_total
             FROM orders
             WHERE sales_channel = 'in_store' AND payment_status = 'paid'
               AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
             GROUP BY DATE(created_at)
             ORDER BY sale_date DESC`,
            [from, to]
        );
        res.json({ from, to, rows });
    } catch (e) {
        res.status(500).json({ error: 'Failed to generate sales summary' });
    }
});

router.get('/reports/day', async (req, res) => {
    try {
        const posSalesReports = require('../services/posSalesReports');
        const date = String(req.query.date || '').slice(0, 10) || posSalesReports.localDateKey();
        const report = await posSalesReports.getDaySalesSummary(req.pool, date);
        res.json({ success: true, report });
    } catch (e) {
        res.status(500).json({ error: 'Failed to generate day summary' });
    }
});

router.post('/reports/send-daily-sales', requireManager, async (req, res) => {
    try {
        const { sendDailySalesEmail } = require('../services/posDailySalesEmail');
        const date = String(req.body?.date || '').slice(0, 10) || undefined;
        const result = await sendDailySalesEmail(req.pool, { date, force: true });
        if (!result.sent) {
            return res.status(400).json({ error: result.reason || 'Email not sent', ...result });
        }
        res.json(result);
    } catch (e) {
        logger.error('Send daily sales email error:', e);
        res.status(500).json({ error: e.message || 'Failed to send daily sales email' });
    }
});

router.post('/reports/send-payroll', requireManager, async (req, res) => {
    try {
        const { sendPayrollTimesheetEmail } = require('../services/posPayrollEmail');
        const { resolvePayrollPeriod, loadPosPayrollSettings } = require('../services/posPayrollSettings');
        const body = req.body || {};
        const toEmail = String(body.toEmail || '').trim() || undefined;
        const fromRaw = body.from || body.periodFrom;
        const toRaw = body.periodTo || body.rangeTo;
        const from = fromRaw ? String(fromRaw).slice(0, 32) : undefined;
        const to = toRaw ? String(toRaw).slice(0, 32) : undefined;
        let opts = {
            force: true,
            markSent: body.markSent === true,
            toEmail
        };
        if (from && to) {
            opts.from = from.includes('T') ? from : `${from}T00:00:00`;
            opts.to = to.includes('T') ? to : `${to}T23:59:59`;
        } else {
            const settings = await loadPosPayrollSettings(req.pool);
            opts.period = resolvePayrollPeriod(new Date(), settings);
        }
        const result = await sendPayrollTimesheetEmail(req.pool, opts);
        if (!result.sent) {
            return res.status(400).json({ error: result.reason || 'Email not sent', ...result });
        }
        res.json({
            sent: true,
            to: result.to,
            fromKey: result.period?.fromKey,
            toKey: result.period?.toKey,
            employees: result.report?.totals?.employees,
            hours: result.report?.totals?.hours
        });
    } catch (e) {
        logger.error('Send payroll email error:', e);
        res.status(500).json({ error: e.message || 'Failed to send payroll email' });
    }
});

module.exports = router;
