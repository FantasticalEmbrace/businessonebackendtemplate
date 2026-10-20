/**
 * Clean storefront URLs: /products serves products.html; /products.html → 301 /products.
 * Admin / OAuth callback shells keep .html. /api/* and asset paths are untouched.
 */

const fs = require('fs');
const path = require('path');

/** Public pages that get extensionless URLs (file must exist as {name}.html). */
const PUBLIC_CLEAN_PAGES = new Set([
    'products',
    'product',
    'about',
    'contact',
    'checkout',
    'shipping-returns',
    'brands',
    'categories',
    'gift-cards',
    'account',
    'privacy-policy',
    'terms-and-conditions',
    'ccpa-privacy-rights',
    'order-confirmation',
    'newsletter-subscribe',
    'newsletter-landing',
    'newsletter-landing-mailchimp',
    'card',
    'oauth-complete-profile',
    'reset-password',
]);

/** Keep these as *.html (admin, OAuth registered callbacks, internal tools). */
const KEEP_HTML_PAGES = new Set([
    'admin',
    'admin-reset-password',
    'admin-oauth-callback',
    'oauth-callback',
    'menu-admin',
    'platform-support',
    'support-viewer',
    'check-upload',
    'pos-billing',
    'billing-portal',
]);

function querySuffix(req) {
    const i = String(req.url || '').indexOf('?');
    return i >= 0 ? String(req.url).slice(i) : '';
}

function createHtmlToCleanRedirectMiddleware() {
    return function htmlToCleanRedirect(req, res, next) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const p = String(req.path || '');
        if (!p.endsWith('.html') && !p.endsWith('.htm')) return next();

        const base = p.replace(/^\//, '').replace(/\.html?$/i, '');
        if (!base || KEEP_HTML_PAGES.has(base)) return next();

        if (base === 'index') {
            return res.redirect(301, `/${querySuffix(req)}`);
        }
        if (!PUBLIC_CLEAN_PAGES.has(base)) return next();

        return res.redirect(301, `/${base}${querySuffix(req)}`);
    };
}

/**
 * Serve {page}.html for GET /{page}. Skip when a later route should handle
 * (product/products SSR is registered before this middleware).
 */
function createCleanHtmlServeMiddleware({ rootPath, skipPages = [] } = {}) {
    const root = rootPath || path.join(__dirname, '..', '..');
    const skip = new Set(skipPages.map((s) => String(s).toLowerCase()));

    return function cleanHtmlServe(req, res, next) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const p = String(req.path || '');
        if (!p || p === '/' || p.includes('.') || p.startsWith('/api/') || p.startsWith('/uploads/')) {
            return next();
        }
        // Multi-segment paths (/brands/foo, /products/slug) are SEO/legacy — not page shells.
        const name = p.replace(/^\//, '').replace(/\/+$/, '');
        if (!name || name.includes('/')) return next();
        if (!PUBLIC_CLEAN_PAGES.has(name) || skip.has(name)) return next();

        const filePath = path.join(root, `${name}.html`);
        if (!fs.existsSync(filePath)) return next();

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.sendFile(path.resolve(filePath));
    };
}

module.exports = {
    PUBLIC_CLEAN_PAGES,
    KEEP_HTML_PAGES,
    createHtmlToCleanRedirectMiddleware,
    createCleanHtmlServeMiddleware,
};
