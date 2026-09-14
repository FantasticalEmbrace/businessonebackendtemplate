'use strict';

/**
 * Best-effort client IP for Express (trust proxy + X-Forwarded-For).
 * Prefer req.ip when app.set('trust proxy') is enabled.
 */
function getRequestClientIp(req) {
    if (!req) return '';
    let ip = String(req.ip || '').trim();
    if (!ip) {
        const xff = req.headers && req.headers['x-forwarded-for'];
        if (typeof xff === 'string' && xff.trim()) {
            ip = xff.split(',')[0].trim();
        } else if (Array.isArray(xff) && xff[0]) {
            ip = String(xff[0]).split(',')[0].trim();
        }
    }
    if (!ip) {
        ip = String(req.socket?.remoteAddress || req.connection?.remoteAddress || '').trim();
    }
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    return ip;
}

module.exports = { getRequestClientIp };
