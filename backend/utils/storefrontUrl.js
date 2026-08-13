'use strict';

/** Base URL for customer-facing storefront links (emails, thank-you page). */
function getStorefrontPublicBaseUrl() {
    const port = String(process.env.PORT || 3001).trim();
    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    let base = String(process.env.STOREFRONT_PUBLIC_URL || process.env.FRONTEND_URL || '').trim();
    base = base.replace(/\/+$/, '');
    if (!base) {
        return `http://127.0.0.1:${port}`;
    }
    if (!isProd) {
        try {
            const u = new URL(base);
            const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
            if (loopback) {
                u.protocol = 'http:';
                u.hostname = '127.0.0.1';
                if (!u.port || u.port === '8000') {
                    u.port = port;
                }
                return u.origin;
            }
        } catch (_) {
            /* fall through */
        }
    }
    return base;
}

/** Admin panel URL for staff links in emails (OAuth callbacks, EDSA notifications). */
function getAdminAppUrl() {
    const explicit = String(process.env.ADMIN_APP_URL || '').trim().replace(/\/+$/, '');
    if (explicit) return explicit;
    return `${getStorefrontPublicBaseUrl()}/admin.html`;
}

/** Site origin for admin password-reset links (admin-reset-password.html). */
function getAdminPasswordResetBaseUrl() {
    return getStorefrontPublicBaseUrl();
}

module.exports = {
    getStorefrontPublicBaseUrl,
    getAdminAppUrl,
    getAdminPasswordResetBaseUrl
};
