'use strict';

/**
 * Shared-schema merchant tenancy middleware.
 * MERCHANT_TENANCY=shared (or MERCHANT_ACCOUNTS_ENABLED=true): resolve shop, set req.merchantId.
 * Single shared DB pool — no per-merchant databases.
 */

const { tenancyShared } = require('../utils/ensureTenantsSchema');
const { resolveByKey, publicMerchant } = require('../services/tenantProvision');

function extractPosDeviceKey(req) {
    const headerKey = String(req.headers['x-pos-api-key'] || '').trim();
    if (headerKey) return headerKey;
    const authHeader = String(req.headers.authorization || '');
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!bearer) return '';
    const bearerLooksLikeJwt = bearer.split('.').length === 3;
    return bearerLooksLikeJwt ? '' : bearer;
}

function shouldSkipMerchantResolve(req) {
    const path = String(req.path || '');
    if (path === '/api/health' || path.startsWith('/api/health/')) return true;
    if (path.startsWith('/api/platform/tenants') || path.startsWith('/api/platform/directory')) return true;
    // Customer portal + pay-by-link (token auth only)
    if (path.startsWith('/api/shop/') || path === '/api/shop') return true;
    // US address type-ahead (storefront + POS contractor job site) — public, rate-limited
    if (path === '/api/address-suggest' || path.startsWith('/api/address-suggest?')) return true;
    if (req.method === 'GET' && !path.startsWith('/api/')) return true;
    // Admin login before merchant context exists on the token
    if (path === '/api/admin/login' || path === '/api/auth/login') return true;
    return false;
}

function createMerchantAccountsMiddleware(fallbackPool) {
    return async function merchantTenancyMiddleware(req, res, next) {
        req.pool = fallbackPool;

        if (!tenancyShared()) {
            return next();
        }

        if (shouldSkipMerchantResolve(req)) {
            return next();
        }

        try {
            const websiteKey = String(req.headers['x-website-api-key'] || '').trim();
            const slug = String(req.headers['x-merchant-account'] || '').trim();
            const deviceKey = extractPosDeviceKey(req);
            const jwtMerchantId = req.adminUser?.merchantId || req.user?.merchantId || null;

            let row = null;
            if (websiteKey || deviceKey || slug) {
                row = await resolveByKey(req.pool, {
                    websiteApiKey: websiteKey || undefined,
                    deviceKey: deviceKey || undefined,
                    slug: slug || undefined
                });
            } else if (jwtMerchantId) {
                const { findById } = require('../services/tenantProvision');
                row = await findById(req.pool, jwtMerchantId);
            }

            // Admin JWT routes: merchant comes from token after authenticateAdmin runs —
            // allow through; authenticateAdmin will set req.merchantId from admin row.
            const isAdminApi = String(req.path || '').startsWith('/api/admin');
            const isPosApi = String(req.path || '').startsWith('/api/pos');

            if (!row && isAdminApi) {
                return next();
            }

            if (!row) {
                return res.status(400).json({
                    error:
                        'Shop account required. Send X-Website-Api-Key, X-Pos-Api-Key, or X-Merchant-Account.',
                    code: 'MERCHANT_ACCOUNT_REQUIRED'
                });
            }

            if (row.status !== 'active') {
                return res.status(403).json({
                    error: 'Shop account is not active',
                    code: 'MERCHANT_SUSPENDED'
                });
            }

            const account = publicMerchant(row);
            req.merchantAccount = account;
            req.merchantId = account.id;

            if (isPosApi && deviceKey) {
                // Device auth still validates the key against pos_devices for this merchant
            }

            return next();
        } catch (e) {
            const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
            return res.status(status).json({
                error: e.message || 'Could not resolve shop account',
                code: e.code || 'MERCHANT_RESOLVE_FAILED'
            });
        }
    };
}

module.exports = {
    accountsEnabled: tenancyShared,
    createMerchantAccountsMiddleware,
    tenancyShared
};
