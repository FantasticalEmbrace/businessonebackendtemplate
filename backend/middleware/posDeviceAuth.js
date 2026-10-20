'use strict';

const { authenticateDevice } = require('../services/posDeviceRegistry');

function bindErrorMessage(code) {
    if (code === 'DEVICE_BOUND_ELSEWHERE') {
        return 'This register key is already in use on another device. Ask an admin to reset device binding (or generate a new key) before connecting here.';
    }
    if (code === 'INSTALL_ID_REQUIRED') {
        return 'This POS client must send a stable install id (update the POS app).';
    }
    if (code === 'POS_DEVICE_REVOKED') {
        return 'This register has been revoked. Generate a new device key in admin.';
    }
    if (code === 'POS_API_DISABLED') {
        return 'POS device API is not configured on the server.';
    }
    return 'Invalid POS device credentials.';
}

async function authenticatePosDevice(req, res, next) {
    try {
        const headerKey = String(req.headers['x-pos-api-key'] || '').trim();
        const authHeader = String(req.headers.authorization || '');
        const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const bearerLooksLikeJwt = bearer.split('.').length === 3;
        const provided = headerKey || (bearerLooksLikeJwt ? '' : bearer);
        const deviceLabel = String(req.headers['x-pos-device-id'] || 'register-1').trim().slice(0, 64);
        const installId = String(
            req.headers['x-pos-install-id'] || req.headers['x-pos-device-instance-id'] || ''
        ).trim();
        const platform = String(req.headers['x-pos-platform'] || '').trim();

        const result = await authenticateDevice(req.pool, deviceLabel, provided, req.merchantId || null, {
            installId,
            platform
        });
        if (!result.ok) {
            const code = result.code || 'POS_AUTH_FAILED';
            const status =
                code === 'POS_API_DISABLED'
                    ? 503
                    : code === 'DEVICE_BOUND_ELSEWHERE' || code === 'INSTALL_ID_REQUIRED'
                      ? 403
                      : 401;
            return res.status(status).json({
                error: result.message || bindErrorMessage(code),
                code
            });
        }

        req.posDeviceId = result.deviceId;
        req.posDeviceRecordId = result.deviceRecordId;
        req.posInstallId = installId || null;
        next();
    } catch (error) {
        next(error);
    }
}

module.exports = { authenticatePosDevice };
