'use strict';

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const PIN_SALT_ROUNDS = 12;
const { loadPosSecuritySettings } = require('./posSecuritySettings');
const {
    buildAttemptKey,
    assertPinNotLocked,
    recordFailedPinAttempt,
    clearPinAttempts
} = require('./posPinSecurity');

const MANAGER_ADMIN_ROLES = new Set(['admin', 'developer', 'manager', 'assistant_manager', 'super_admin']);

function normalizePin(pin) {
    return String(pin || '').replace(/\D/g, '').slice(0, 4);
}

function validatePinFormat(pin) {
    const p = normalizePin(pin);
    return p.length === 4;
}

function validateEmployeeCode(code) {
    const c = String(code || '').trim();
    return c.length >= 2 && c.length <= 8;
}

async function hashPin(pin) {
    return bcrypt.hash(normalizePin(pin), PIN_SALT_ROUNDS);
}

async function verifyPin(pin, hash) {
    if (!hash) return false;
    return bcrypt.compare(normalizePin(pin), hash);
}

function signEmployeeToken(employee, expiresIn = '30m') {
    return jwt.sign(
        {
            type: 'pos_employee',
            employeeId: employee.id,
            employeeCode: employee.employee_code,
            name: `${employee.first_name} ${employee.last_name}`.trim(),
            adminUserId: employee.admin_user_id ? Number(employee.admin_user_id) : null
        },
        process.env.JWT_SECRET,
        { expiresIn }
    );
}

function verifyEmployeeToken(token) {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.type !== 'pos_employee') {
        const err = new Error('INVALID_EMPLOYEE_TOKEN');
        err.code = 'INVALID_EMPLOYEE_TOKEN';
        throw err;
    }
    return decoded;
}

async function findEmployeeByPin(pool, pin) {
    const [rows] = await pool.execute(
        `SELECT id, employee_code, first_name, last_name, email, pin_hash, is_active, admin_user_id,
                can_authorize, can_process_refunds, can_open_drawer, allow_manual_discounts, can_view_cost
         FROM pos_employees WHERE is_active = 1`
    );
    for (const row of rows) {
        if (await verifyPin(pin, row.pin_hash)) return row;
    }
    return null;
}

async function employeeCanAuthorize(pool, employee) {
    if (!employee || !employee.is_active) return false;
    if (employee.can_authorize) return true;
    if (!employee.admin_user_id) return false;
    const [rows] = await pool.execute(
        `SELECT role FROM admin_users WHERE id = ? AND is_active = 1 LIMIT 1`,
        [employee.admin_user_id]
    );
    const role = String(rows[0]?.role || '').toLowerCase();
    return MANAGER_ADMIN_ROLES.has(role);
}

function mapAuthorizer(employee) {
    return {
        id: employee.id,
        employeeCode: employee.employee_code,
        name: `${employee.first_name} ${employee.last_name}`.trim()
    };
}

async function verifyManagerPin(pool, pin, context = {}) {
    const settings = await loadPosSecuritySettings(pool);
    const scope = context.scope || 'manager';
    const attemptKey = buildAttemptKey(`${scope}:${context.deviceId || 'device'}`, context.ip);
    await assertPinNotLocked(pool, attemptKey);

    if (!validatePinFormat(pin)) {
        await recordFailedPinAttempt(pool, attemptKey, settings).catch(() => {});
        const err = new Error('PIN must be exactly 4 digits');
        err.code = 'INVALID_PIN';
        throw err;
    }

    const employee = await findEmployeeByPin(pool, pin);
    if (!employee) {
        try {
            await recordFailedPinAttempt(pool, attemptKey, settings);
        } catch (lockErr) {
            throw lockErr;
        }
        const err = new Error('Invalid manager PIN');
        err.code = 'INVALID_MANAGER_PIN';
        throw err;
    }

    const canAuthorize = await employeeCanAuthorize(pool, employee);
    if (!canAuthorize) {
        await recordFailedPinAttempt(pool, attemptKey, settings).catch(() => {});
        const err = new Error('This PIN is not authorized for manager approval');
        err.code = 'NOT_AUTHORIZED_MANAGER';
        throw err;
    }

    await clearPinAttempts(pool, attemptKey);
    return mapAuthorizer(employee);
}

async function employeeCanProcessRefunds(employee) {
    return Boolean(employee?.can_process_refunds);
}

async function verifyRefundPin(pool, pin, context = {}) {
    const settings = await loadPosSecuritySettings(pool);
    const attemptKey = buildAttemptKey(`refund:${context.deviceId || 'device'}`, context.ip);
    await assertPinNotLocked(pool, attemptKey);

    if (!validatePinFormat(pin)) {
        await recordFailedPinAttempt(pool, attemptKey, settings).catch(() => {});
        const err = new Error('PIN must be exactly 4 digits');
        err.code = 'INVALID_PIN';
        throw err;
    }

    const employee = await findEmployeeByPin(pool, pin);
    if (!employee) {
        try {
            await recordFailedPinAttempt(pool, attemptKey, settings);
        } catch (lockErr) {
            throw lockErr;
        }
        const err = new Error('Invalid PIN');
        err.code = 'INVALID_MANAGER_PIN';
        throw err;
    }

    if (!(await employeeCanProcessRefunds(employee))) {
        await recordFailedPinAttempt(pool, attemptKey, settings).catch(() => {});
        const err = new Error('This employee is not authorized to process refunds');
        err.code = 'NOT_AUTHORIZED_REFUND';
        throw err;
    }

    await clearPinAttempts(pool, attemptKey);
    return mapAuthorizer(employee);
}

function employeeAllowManualDiscounts(employee) {
    if (!employee) return false;
    if (employee.allow_manual_discounts == null || employee.allow_manual_discounts === undefined) return false;
    return Number(employee.allow_manual_discounts) !== 0;
}

function employeeCanViewCost(employee) {
    return Boolean(employee?.can_view_cost);
}

async function getEmployeeById(pool, id) {
    const [rows] = await pool.execute(
        `SELECT id, employee_code, first_name, last_name, email, is_active, hourly_rate, admin_user_id,
                can_authorize, can_process_refunds, can_open_drawer, allow_manual_discounts, can_view_cost,
                created_at, updated_at
         FROM pos_employees WHERE id = ? LIMIT 1`,
        [id]
    );
    return rows[0] || null;
}

async function getEmployeeByAdminUserId(pool, adminUserId) {
    const [rows] = await pool.execute(
        `SELECT id, employee_code, first_name, last_name, email, is_active, hourly_rate, admin_user_id, created_at, updated_at
         FROM pos_employees WHERE admin_user_id = ? LIMIT 1`,
        [adminUserId]
    );
    return rows[0] || null;
}

async function employeeHasAdminAccess(pool, employee) {
    if (!employee?.admin_user_id) return false;
    const [rows] = await pool.execute(
        `SELECT id FROM admin_users WHERE id = ? AND is_active = 1 LIMIT 1`,
        [employee.admin_user_id]
    );
    return rows.length > 0;
}

async function getLinkedAdminEmail(pool, employee) {
    if (!employee?.admin_user_id) return null;
    const [rows] = await pool.execute(
        `SELECT email FROM admin_users WHERE id = ? AND is_active = 1 LIMIT 1`,
        [employee.admin_user_id]
    );
    const email = rows[0]?.email;
    return email ? String(email).trim() : null;
}

async function loginWithPin(pool, pin, context = {}) {
    const settings = await loadPosSecuritySettings(pool);
    const attemptKey = buildAttemptKey(context.deviceId, context.ip);
    await assertPinNotLocked(pool, attemptKey);

    if (!validatePinFormat(pin)) {
        await recordFailedPinAttempt(pool, attemptKey, settings).catch(() => {});
        const err = new Error('PIN must be exactly 4 digits');
        err.code = 'INVALID_PIN';
        throw err;
    }
    const employee = await findEmployeeByPin(pool, pin);
    if (!employee) {
        try {
            await recordFailedPinAttempt(pool, attemptKey, settings);
        } catch (lockErr) {
            throw lockErr;
        }
        const err = new Error('Invalid PIN');
        err.code = 'INVALID_PIN';
        throw err;
    }

    await clearPinAttempts(pool, attemptKey);
    const expiresIn = `${settings.sessionTimeoutMinutes}m`;
    const token = signEmployeeToken(employee, expiresIn);
    const hasAdminAccess = await employeeHasAdminAccess(pool, employee);
    const adminEmail = hasAdminAccess ? await getLinkedAdminEmail(pool, employee) : null;
    return {
        token,
        employee: {
            id: employee.id,
            employeeCode: employee.employee_code,
            firstName: employee.first_name,
            lastName: employee.last_name,
            name: `${employee.first_name} ${employee.last_name}`.trim(),
            canAuthorize: Boolean(employee.can_authorize),
            canProcessRefunds: Boolean(employee.can_process_refunds),
            canOpenDrawer: Boolean(employee.can_open_drawer),
            allowManualDiscounts: employeeAllowManualDiscounts(employee),
            canViewCost: employeeCanViewCost(employee)
        },
        hasAdminAccess,
        adminEmail,
        sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
        expiresIn
    };
}

async function createEmployee(pool, data, adminId) {
    const code = String(data.employeeCode || data.employee_code || '').trim();
    const pin = normalizePin(data.pin);
    if (!validateEmployeeCode(code)) {
        const err = new Error('Employee ID must be 2–8 characters');
        err.code = 'INVALID_EMPLOYEE_CODE';
        throw err;
    }
    if (!validatePinFormat(pin)) {
        const err = new Error('PIN must be exactly 4 digits');
        err.code = 'INVALID_PIN';
        throw err;
    }
    const pinHash = await hashPin(pin);
    const canAuthorize = data.canAuthorize || data.can_authorize ? 1 : 0;
    const canProcessRefunds = data.canProcessRefunds || data.can_process_refunds ? 1 : 0;
    const canOpenDrawer = data.canOpenDrawer || data.can_open_drawer ? 1 : 0;
    const allowManualDiscounts =
        data.allowManualDiscounts || data.allow_manual_discounts ? 1 : 0;
    const canViewCost = data.canViewCost || data.can_view_cost ? 1 : 0;
    const [result] = await pool.execute(
        `INSERT INTO pos_employees (
            employee_code, first_name, last_name, email, pin_hash, hourly_rate, admin_user_id,
            can_authorize, can_process_refunds, can_open_drawer, allow_manual_discounts, can_view_cost
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            code,
            String(data.firstName || data.first_name || '').trim(),
            String(data.lastName || data.last_name || '').trim(),
            data.email ? String(data.email).trim() : null,
            pinHash,
            data.hourlyRate != null ? Number(data.hourlyRate) : null,
            data.adminUserId || adminId || null,
            canAuthorize,
            canProcessRefunds,
            canOpenDrawer,
            allowManualDiscounts,
            canViewCost
        ]
    );
    return getEmployeeById(pool, result.insertId);
}

async function updateEmployee(pool, id, data) {
    const updates = [];
    const params = [];
    if (data.employeeCode != null || data.employee_code != null) {
        const code = String(data.employeeCode || data.employee_code).trim();
        if (!validateEmployeeCode(code)) {
            const err = new Error('Employee ID must be 2–8 characters');
            err.code = 'INVALID_EMPLOYEE_CODE';
            throw err;
        }
        updates.push('employee_code = ?');
        params.push(code);
    }
    if (data.firstName != null) {
        updates.push('first_name = ?');
        params.push(String(data.firstName).trim());
    }
    if (data.lastName != null) {
        updates.push('last_name = ?');
        params.push(String(data.lastName).trim());
    }
    if (data.email !== undefined) {
        updates.push('email = ?');
        params.push(data.email ? String(data.email).trim() : null);
    }
    if (data.isActive != null) {
        updates.push('is_active = ?');
        params.push(data.isActive ? 1 : 0);
    }
    if (data.hourlyRate !== undefined) {
        updates.push('hourly_rate = ?');
        params.push(data.hourlyRate != null ? Number(data.hourlyRate) : null);
    }
    if (data.pin) {
        if (!validatePinFormat(data.pin)) {
            const err = new Error('PIN must be exactly 4 digits');
            err.code = 'INVALID_PIN';
            throw err;
        }
        updates.push('pin_hash = ?');
        params.push(await hashPin(data.pin));
    }
    if (data.canAuthorize != null || data.can_authorize != null) {
        updates.push('can_authorize = ?');
        params.push(data.canAuthorize || data.can_authorize ? 1 : 0);
    }
    if (data.canProcessRefunds != null || data.can_process_refunds != null) {
        updates.push('can_process_refunds = ?');
        params.push(data.canProcessRefunds || data.can_process_refunds ? 1 : 0);
    }
    if (data.canOpenDrawer != null || data.can_open_drawer != null) {
        updates.push('can_open_drawer = ?');
        params.push(data.canOpenDrawer || data.can_open_drawer ? 1 : 0);
    }
    if (data.allowManualDiscounts != null || data.allow_manual_discounts != null) {
        updates.push('allow_manual_discounts = ?');
        params.push(data.allowManualDiscounts || data.allow_manual_discounts ? 1 : 0);
    }
    if (data.canViewCost != null || data.can_view_cost != null) {
        updates.push('can_view_cost = ?');
        params.push(data.canViewCost || data.can_view_cost ? 1 : 0);
    }
    if (!updates.length) return getEmployeeById(pool, id);
    params.push(id);
    await pool.execute(`UPDATE pos_employees SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
    return getEmployeeById(pool, id);
}

async function listEmployees(pool) {
    const [rows] = await pool.execute(
        `SELECT id, employee_code, first_name, last_name, email, is_active, hourly_rate, admin_user_id,
                can_authorize, can_process_refunds, can_open_drawer, allow_manual_discounts, can_view_cost,
                created_at, updated_at
         FROM pos_employees ORDER BY last_name, first_name`
    );
    return rows;
}

async function upsertRegisterForAdminUser(pool, adminUserId, data) {
    const existing = await getEmployeeByAdminUserId(pool, adminUserId);
    const enabled =
        data.registerEnabled === false ||
        data.registerEnabled === 0 ||
        String(data.registerEnabled) === '0'
            ? false
            : true;

    if (!enabled) {
        if (existing) {
            await updateEmployee(pool, existing.id, { isActive: false });
        } else if (data.pin || data.employeeCode) {
            const err = new Error('Register employee ID and PIN are both required to enable register access');
            err.code = 'REGISTER_SETUP_INCOMPLETE';
            throw err;
        }
        return null;
    }

    const payload = {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        employeeCode: data.employeeCode,
        hourlyRate: data.hourlyRate,
        isActive: data.isActive !== false && data.isActive !== 0,
    };
    if (data.pin) payload.pin = data.pin;
    if (data.canAuthorize != null || data.can_authorize != null) {
        payload.canAuthorize = Boolean(data.canAuthorize || data.can_authorize);
    }
    if (data.canProcessRefunds != null || data.can_process_refunds != null) {
        payload.canProcessRefunds = Boolean(data.canProcessRefunds || data.can_process_refunds);
    }
    if (data.canOpenDrawer != null || data.can_open_drawer != null) {
        payload.canOpenDrawer = Boolean(data.canOpenDrawer || data.can_open_drawer);
    }
    if (data.allowManualDiscounts != null || data.allow_manual_discounts != null) {
        payload.allowManualDiscounts = Boolean(data.allowManualDiscounts || data.allow_manual_discounts);
    }
    if (data.canViewCost != null || data.can_view_cost != null) {
        payload.canViewCost = Boolean(data.canViewCost || data.can_view_cost);
    }

    if (existing) {
        return updateEmployee(pool, existing.id, payload);
    }

    if (!validateEmployeeCode(data.employeeCode)) {
        const err = new Error('Register employee ID must be 2–8 characters');
        err.code = 'INVALID_EMPLOYEE_CODE';
        throw err;
    }
    if (!validatePinFormat(data.pin)) {
        const err = new Error('A 4-digit register PIN is required when enabling register access');
        err.code = 'INVALID_PIN';
        throw err;
    }

    return createEmployee(
        pool,
        {
            ...payload,
            pin: data.pin,
            adminUserId,
        },
        null
    );
}

async function getOpenShiftSession(pool, employeeId, deviceId) {
    const [rows] = await pool.execute(
        `SELECT * FROM pos_shift_sessions
         WHERE employee_id = ? AND status = 'open'
         ORDER BY opened_at DESC LIMIT 1`,
        [employeeId]
    );
    return rows[0] || null;
}

async function openShiftSession(pool, { employeeId, deviceId, openingCash, scheduledShiftId }) {
    const existing = await getOpenShiftSession(pool, employeeId, deviceId);
    if (existing) {
        const err = new Error('Employee already has an open shift');
        err.code = 'SHIFT_ALREADY_OPEN';
        err.shiftSessionId = existing.id;
        throw err;
    }
    const [result] = await pool.execute(
        `INSERT INTO pos_shift_sessions (
            employee_id, scheduled_shift_id, device_id, status, opened_at, opening_cash
        ) VALUES (?, ?, ?, 'open', NOW(), ?)`,
        [
            employeeId,
            scheduledShiftId || null,
            deviceId || null,
            Number(openingCash) || 0
        ]
    );
    const [rows] = await pool.execute('SELECT * FROM pos_shift_sessions WHERE id = ?', [result.insertId]);
    return rows[0];
}

async function sumCashDrawerAdjustments(pool, shiftSessionId) {
    const [rows] = await pool.execute(
        `SELECT event_type, COALESCE(SUM(amount), 0) AS total
         FROM pos_cash_drawer_events WHERE shift_session_id = ?
         GROUP BY event_type`,
        [shiftSessionId]
    );
    const map = { paid_out: 0, drop: 0, cash_in: 0 };
    for (const r of rows) map[r.event_type] = Number(r.total) || 0;
    return map;
}

async function computeExpectedCash(pool, shift) {
    const adj = await sumCashDrawerAdjustments(pool, shift.id);
    return (
        Number(shift.opening_cash) +
        Number(shift.cash_sales_total) +
        adj.cash_in -
        adj.paid_out -
        adj.drop
    );
}

async function assertShiftOwnedByEmployee(pool, shiftSessionId, employeeId) {
    const [rows] = await pool.execute(
        'SELECT id FROM pos_shift_sessions WHERE id = ? AND employee_id = ? LIMIT 1',
        [shiftSessionId, employeeId]
    );
    if (!rows[0]) {
        const err = new Error('Shift not found or not authorized');
        err.code = 'SHIFT_NOT_FOUND';
        throw err;
    }
}

async function addCashDrawerEvent(pool, { shiftSessionId, eventType, amount, reason, employeeId }) {
    if (employeeId) {
        await assertShiftOwnedByEmployee(pool, shiftSessionId, employeeId);
    }
    const [result] = await pool.execute(
        `INSERT INTO pos_cash_drawer_events (shift_session_id, event_type, amount, reason, recorded_by_employee_id)
         VALUES (?, ?, ?, ?, ?)`,
        [shiftSessionId, eventType, Number(amount), reason || null, employeeId || null]
    );
    return result.insertId;
}

async function recordSaleOnShift(pool, shiftSessionId, paymentMethod, totalAmount) {
    if (!shiftSessionId) return;
    const col =
        paymentMethod === 'cash'
            ? 'cash_sales_total'
            : paymentMethod === 'check'
              ? 'check_sales_total'
              : 'card_sales_total';
    await pool.execute(
        `UPDATE pos_shift_sessions SET ${col} = ${col} + ? WHERE id = ? AND status = 'open'`,
        [Number(totalAmount) || 0, shiftSessionId]
    );
}

async function closeShiftSession(pool, { shiftSessionId, closingCash, notes, employeeId }) {
    if (employeeId) {
        await assertShiftOwnedByEmployee(pool, shiftSessionId, employeeId);
    }
    const [rows] = await pool.execute('SELECT * FROM pos_shift_sessions WHERE id = ? AND status = ?', [
        shiftSessionId,
        'open'
    ]);
    const shift = rows[0];
    if (!shift) {
        const err = new Error('Open shift not found');
        err.code = 'SHIFT_NOT_FOUND';
        throw err;
    }
    const expected = await computeExpectedCash(pool, shift);
    const closing = Number(closingCash) || 0;
    const overShort = Math.round((closing - expected) * 100) / 100;
    await pool.execute(
        `UPDATE pos_shift_sessions SET
            status = 'closed', closed_at = NOW(), closing_cash = ?, expected_cash = ?,
            over_short_amount = ?, notes = COALESCE(?, notes)
         WHERE id = ?`,
        [closing, expected, overShort, notes || null, shiftSessionId]
    );
    const [updated] = await pool.execute('SELECT * FROM pos_shift_sessions WHERE id = ?', [shiftSessionId]);
    return updated[0];
}

async function clockIn(pool, employeeId, shiftSessionId) {
    const [open] = await pool.execute(
        `SELECT id FROM pos_time_entries WHERE employee_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`,
        [employeeId]
    );
    if (open.length) {
        const err = new Error('Already clocked in');
        err.code = 'ALREADY_CLOCKED_IN';
        err.timeEntryId = open[0].id;
        throw err;
    }
    const [result] = await pool.execute(
        `INSERT INTO pos_time_entries (employee_id, shift_session_id, clock_in, source) VALUES (?, ?, NOW(), 'pos')`,
        [employeeId, shiftSessionId || null]
    );
    return result.insertId;
}

async function clockOut(pool, employeeId) {
    const [open] = await pool.execute(
        `SELECT id FROM pos_time_entries WHERE employee_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`,
        [employeeId]
    );
    if (!open.length) {
        const err = new Error('Not clocked in');
        err.code = 'NOT_CLOCKED_IN';
        throw err;
    }
    await pool.execute('UPDATE pos_time_entries SET clock_out = NOW() WHERE id = ?', [open[0].id]);
    return open[0].id;
}

async function getOpenTimeEntry(pool, employeeId) {
    const [rows] = await pool.execute(
        `SELECT id, employee_id, shift_session_id, clock_in, clock_out, source
         FROM pos_time_entries
         WHERE employee_id = ? AND clock_out IS NULL
         ORDER BY clock_in DESC LIMIT 1`,
        [employeeId]
    );
    return rows[0] || null;
}

async function createScheduledShift(pool, data, adminId) {
    const [result] = await pool.execute(
        `INSERT INTO pos_scheduled_shifts (employee_id, starts_at, ends_at, notes, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [data.employeeId, data.startsAt, data.endsAt, data.notes || null, adminId || null]
    );
    return result.insertId;
}

async function listScheduledShifts(pool, filters = {}) {
    let sql = `
        SELECT s.*, e.employee_code, e.first_name, e.last_name
        FROM pos_scheduled_shifts s
        JOIN pos_employees e ON e.id = s.employee_id
        WHERE 1=1`;
    const params = [];
    if (filters.from) {
        sql += ' AND s.starts_at >= ?';
        params.push(filters.from);
    }
    if (filters.to) {
        sql += ' AND s.ends_at <= ?';
        params.push(filters.to);
    }
    if (filters.employeeId) {
        sql += ' AND s.employee_id = ?';
        params.push(filters.employeeId);
    }
    sql += ' ORDER BY s.starts_at ASC LIMIT 500';
    const [rows] = await pool.execute(sql, params);
    return rows;
}

async function listTimeEntries(pool, filters = {}) {
    let sql = `
        SELECT t.*, e.employee_code, e.first_name, e.last_name
        FROM pos_time_entries t
        JOIN pos_employees e ON e.id = t.employee_id
        WHERE 1=1`;
    const params = [];
    if (filters.from) {
        sql += ' AND t.clock_in >= ?';
        params.push(filters.from);
    }
    if (filters.to) {
        sql += ' AND t.clock_in <= ?';
        params.push(filters.to);
    }
    if (filters.employeeId) {
        sql += ' AND t.employee_id = ?';
        params.push(filters.employeeId);
    }
    sql += ' ORDER BY t.clock_in DESC LIMIT 1000';
    const [rows] = await pool.execute(sql, params);
    return rows;
}

async function getShiftReport(pool, shiftSessionId, { employeeId } = {}) {
    const [shifts] = await pool.execute(
        `SELECT ss.*, e.employee_code, e.first_name, e.last_name
         FROM pos_shift_sessions ss
         JOIN pos_employees e ON e.id = ss.employee_id
         WHERE ss.id = ?`,
        [shiftSessionId]
    );
    const shift = shifts[0];
    if (!shift) return null;
    if (employeeId != null && Number(shift.employee_id) !== Number(employeeId)) {
        return null;
    }
    const [events] = await pool.execute(
        `SELECT * FROM pos_cash_drawer_events WHERE shift_session_id = ? ORDER BY created_at`,
        [shiftSessionId]
    );
    const [sales] = await pool.execute(
        `SELECT order_number, total_amount, payment_method, created_at
         FROM orders WHERE pos_shift_session_id = ? ORDER BY created_at`,
        [shiftSessionId]
    );
    const expected = shift.expected_cash != null ? Number(shift.expected_cash) : await computeExpectedCash(pool, shift);
    return { shift, events, sales, expectedCash: expected };
}

module.exports = {
    normalizePin,
    validatePinFormat,
    loginWithPin,
    verifyManagerPin,
    verifyRefundPin,
    employeeCanAuthorize,
    employeeCanProcessRefunds,
    employeeAllowManualDiscounts,
    employeeCanViewCost,
    verifyEmployeeToken,
    createEmployee,
    updateEmployee,
    listEmployees,
    getEmployeeById,
    getEmployeeByAdminUserId,
    employeeHasAdminAccess,
    getLinkedAdminEmail,
    upsertRegisterForAdminUser,
    getOpenShiftSession,
    openShiftSession,
    closeShiftSession,
    addCashDrawerEvent,
    recordSaleOnShift,
    computeExpectedCash,
    clockIn,
    clockOut,
    getOpenTimeEntry,
    createScheduledShift,
    listScheduledShifts,
    listTimeEntries,
    getShiftReport
};
