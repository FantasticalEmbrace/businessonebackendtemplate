'use strict';

const { authenticateDevice } = require('../services/posDeviceRegistry');

async function authenticatePosDevice(req, res, next) {
    try {
        const headerKey = String(req.headers['x-pos-api-key'] || '').trim();
        const authHeader = String(req.headers.authorization || '');
        const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const bearerLooksLikeJwt = bearer.split('.').length === 3;
        const provided = headerKey || (bearerLooksLikeJwt ? '' : bearer);
        const deviceLabel = String(req.headers['x-pos-device-id'] || 'register-1').trim().slice(0, 64);

        const result = await authenticateDevice(req.pool, deviceLabel, provided);
        if (!result.ok) {
            const status = result.code === 'POS_API_DISABLED' ? 503 : 401;
            return res.status(status).json({
                error:
                    result.code === 'POS_DEVICE_REVOKED'
                        ? 'This register has been revoked. Generate a new device key in admin.'
                        : result.code === 'POS_API_DISABLED'
                          ? 'POS device API is not configured on the server.'
                          : 'Invalid POS device credentials.',
                code: result.code || 'POS_AUTH_FAILED'
            });
        }

        req.posDeviceId = result.deviceId;
        req.posDeviceRecordId = result.deviceRecordId;
        next();
    } catch (error) {
        next(error);
    }
}

module.exports = { authenticatePosDevice };
