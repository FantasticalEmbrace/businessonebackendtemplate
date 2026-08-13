'use strict';

const jwt = require('jsonwebtoken');
const personnel = require('../services/posPersonnel');

function mapPosEmployeeContext(employee, decoded = {}) {
    return {
        id: employee.id,
        employeeCode: employee.employee_code,
        name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || decoded.name,
        allowManualDiscounts: personnel.employeeAllowManualDiscounts(employee),
        canViewCost: personnel.employeeCanViewCost(employee),
    };
}

async function authenticatePosEmployee(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
        return res.status(401).json({ error: 'Employee session required', code: 'EMPLOYEE_AUTH_REQUIRED' });
    }
    try {
        const decoded = personnel.verifyEmployeeToken(token);
        const employee = await personnel.getEmployeeById(req.pool, decoded.employeeId);
        if (!employee || !employee.is_active) {
            return res.status(401).json({ error: 'Employee session is no longer active', code: 'EMPLOYEE_INACTIVE' });
        }
        req.posEmployee = mapPosEmployeeContext(employee, decoded);
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid employee session', code: 'INVALID_EMPLOYEE_TOKEN' });
    }
}

/** Attach req.posEmployee when a valid employee Bearer token is present; never fails the request. */
async function attachOptionalPosEmployee(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return next();
    try {
        const decoded = personnel.verifyEmployeeToken(token);
        const employee = await personnel.getEmployeeById(req.pool, decoded.employeeId);
        if (employee?.is_active) {
            req.posEmployee = mapPosEmployeeContext(employee, decoded);
        }
    } catch {
        /* ignore invalid optional employee token */
    }
    next();
}

module.exports = { authenticatePosEmployee, attachOptionalPosEmployee };
