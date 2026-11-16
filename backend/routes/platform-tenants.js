'use strict';

const express = require('express');
const { tenancyShared } = require('../utils/ensureTenantsSchema');
const {
    provisionTenant,
    registerDeviceKey,
    rotateWebsiteKey,
    resolveByKey,
    publicMerchant,
    findById,
    findByBillingEmail,
    resetOwnerAdminCredentials
} = require('../services/tenantProvision');
const { sendMail, isMailConfigured } = require('../utils/mailTransporter');
const {
    buildMerchantCredentialsEmailHtml,
    escapeHtml: escapeEmailHtml,
    resolveMerchantAdminLoginUrl,
    MERCHANT_ADMIN_DEFAULT
} = require('../utils/businessOneCredentialsEmail');
const logger = require('../utils/logger');

const router = express.Router();

/** Merchant Portal only — never marketing Ops desk (businessonecomprehensive.com/admin.html). */
function merchantAdminLoginUrl() {
    return resolveMerchantAdminLoginUrl(
        process.env.MERCHANT_ADMIN_URL || process.env.FRONTEND_URL || MERCHANT_ADMIN_DEFAULT
    );
}

function provisionSecretOk(req) {
    const expected = String(
        process.env.PLATFORM_PROVISION_SECRET ||
            process.env.MERCHANT_ACCOUNTS_ADMIN_SECRET ||
            process.env.POS_PLATFORM_HUB_SECRET ||
            ''
    ).trim();
    if (!expected) {
        // Local default: allow when tenancy is on and no secret configured
        return process.env.NODE_ENV !== 'production';
    }
    const got = String(
        req.get('X-Platform-Provision-Secret') ||
            req.get('X-Merchant-Accounts-Admin') ||
            ''
    ).trim();
    return got && got === expected;
}

function requireProvisionAuth(req, res, next) {
    if (!tenancyShared()) {
        return res.status(503).json({ error: 'Shared tenancy is not enabled', code: 'TENANCY_DISABLED' });
    }
    if (!provisionSecretOk(req)) {
        return res.status(401).json({ error: 'Provision secret required', code: 'UNAUTHORIZED' });
    }
    return next();
}

async function emailNewMerchantCredentials(result, { developerTestMode = false } = {}) {
    const password = result?.tempAdminPassword ? String(result.tempAdminPassword).trim() : '';
    const email = String(result?.merchant?.billingEmail || result?.email || '').trim();
    const deviceKey = result?.deviceApiKey ? String(result.deviceApiKey).trim() : '';
    const websiteKey = result?.websiteApiKey ? String(result.websiteApiKey).trim() : '';
    if (!email || result.alreadyProvisioned || !isMailConfigured()) {
        return false;
    }
    if (!password && !deviceKey && !websiteKey) {
        return false;
    }
    const adminUrl = merchantAdminLoginUrl();
    const businessName = String(result.merchant?.businessName || result.businessName || 'Your business').trim();
    const deviceLabel = String(result.deviceLabel || 'Front counter').trim();
    const unlockHtml = developerTestMode
        ? `<p style="margin:0 0 14px;"><strong>Developer test mode:</strong> this signup was unlocked for testing — <strong>$0 charged</strong> today.</p>`
        : '';
    const unlockText = developerTestMode
        ? 'Developer test mode: this signup was unlocked for testing — $0 charged today.\n\n'
        : '';
    const passwordText = password
        ? `Sign in to Merchant Portal: ${adminUrl}\nUsername (email): ${email}\nTemporary password: ${password}\n\nPlease sign in and change your password after your first login.\n\n`
        : '';
    const eLabel = escapeEmailHtml(deviceLabel);
    const eDeviceKey = escapeEmailHtml(deviceKey);
    const eWebsiteKey = escapeEmailHtml(websiteKey);
    const deviceHtml = deviceKey
        ? `<p style="margin:0 0 14px;"><strong>Register key</strong> for “${eLabel}” (paste into the POS app — keep this email; the key is shown once at signup):<br>
           <code style="word-break:break-all;font-size:13px;">${eDeviceKey}</code></p>`
        : '';
    const deviceText = deviceKey ? `Register key (${deviceLabel}): ${deviceKey}\n\n` : '';
    const websiteHtml = websiteKey
        ? `<p style="margin:0 0 14px;"><strong>Website key</strong> (for your store website / integrations — keep this email):<br>
           <code style="word-break:break-all;font-size:13px;">${eWebsiteKey}</code></p>`
        : '';
    const websiteText = websiteKey ? `Website key: ${websiteKey}\n\n` : '';
    const html = buildMerchantCredentialsEmailHtml({
        businessName,
        loginEmail: password ? email : '',
        password,
        adminUrl: password ? adminUrl : '',
        introHtml: unlockHtml,
        extraHtml: `${deviceHtml}${websiteHtml}<p style="margin:0 0 8px;font-size:14px;color:#475569;">If you do not see a Merchant Portal login or these keys, call <strong style="color:#0f172a;">(850) 290-2084</strong>.</p>`
    });
    try {
        const mailed = await sendMail({
            to: email,
            subject: `Your Business One Merchant Portal login — ${businessName}`,
            html,
            text: [
                'Business One — Merchant Portal login',
                '',
                `Welcome — your shop account for ${businessName} is ready.`,
                '',
                unlockText.trimEnd(),
                passwordText.trimEnd(),
                deviceText.trimEnd(),
                websiteText.trimEnd(),
                'If you do not see a Merchant Portal login or these keys, call (850) 290-2084.',
                '',
                '— Business One'
            ]
                .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
                .join('\n'),
            logTag: 'Merchant credentials'
        });
        return Boolean(mailed?.sent);
    } catch (e) {
        logger.warn('[platform-tenants] credentials email failed', { message: e.message });
        return false;
    }
}

/** Idempotent shop tenant create (called from billing signup / ops). */
router.post('/tenants', requireProvisionAuth, async (req, res) => {
    try {
        const result = await provisionTenant(req.pool, req.body || {});
        const developerTestMode = Boolean(
            req.body?.developerTestMode || req.body?.developerUnlock || req.body?.devSignupUnlock
        );
        const credentialsEmailed = await emailNewMerchantCredentials(result, { developerTestMode });
        res.status(result.alreadyProvisioned ? 200 : 201).json({
            success: true,
            alreadyProvisioned: result.alreadyProvisioned,
            credentialsEmailed,
            adminUrl: merchantAdminLoginUrl(),
            account: {
                id: result.merchant.id,
                slug: result.merchant.slug,
                businessName: result.merchant.businessName,
                billingEmail: result.merchant.billingEmail,
                websiteApiKeyPrefix: result.websiteApiKeyPrefix || null,
                sharedPosApiOrigin: result.sharedPosApiOrigin,
                status: result.merchant.status
            },
            secrets: result.websiteApiKey || result.deviceApiKey || result.tempAdminPassword
                ? {
                      websiteApiKey: result.websiteApiKey || null,
                      tempAdminPassword: result.tempAdminPassword || null,
                      deviceApiKey: result.deviceApiKey || null,
                      deviceLabel: result.deviceLabel || null,
                      note: 'Keys shown once. Temp admin password shown once if a new owner was created.'
                  }
                : null
        });
    } catch (e) {
        const status = e.code === 'VALIDATION' ? 400 : e.code === 'TENANCY_DISABLED' ? 503 : 500;
        res.status(status).json({ error: e.message || 'Provision failed', code: e.code });
    }
});

/**
 * Reset owner password and email credentials (username, password, Merchant Portal CTA).
 * Body optional: { billingEmail } to resolve by email instead of :id.
 */
router.post('/tenants/:id/resend-credentials', requireProvisionAuth, async (req, res) => {
    try {
        let merchantId = String(req.params.id || '').trim();
        if (merchantId === 'by-email') {
            const email = String(req.body?.billingEmail || req.body?.email || '')
                .trim()
                .toLowerCase();
            const row = await findByBillingEmail(req.pool, email);
            if (!row) {
                return res.status(404).json({ error: 'Shop account not found', code: 'NOT_FOUND' });
            }
            merchantId = row.id;
        }
        const fallbackEmail = String(req.body?.billingEmail || req.body?.email || '')
            .trim()
            .toLowerCase();
        const reset = await resetOwnerAdminCredentials(
            req.pool,
            merchantId,
            fallbackEmail.includes('@') ? fallbackEmail : null
        );
        const credentialsEmailed = await emailNewMerchantCredentials(
            {
                alreadyProvisioned: false,
                merchant: reset.merchant,
                email: reset.email,
                tempAdminPassword: reset.tempPassword
            },
            {}
        );
        res.json({
            success: true,
            credentialsEmailed,
            adminUrl: merchantAdminLoginUrl(),
            account: {
                id: reset.merchant.id,
                slug: reset.merchant.slug,
                businessName: reset.merchant.businessName,
                billingEmail: reset.email
            },
            // One-time plaintext for Ops to copy if email fails.
            tempAdminPassword: credentialsEmailed ? null : reset.tempPassword
        });
    } catch (e) {
        const status =
            e.code === 'NOT_FOUND' ? 404 : e.code === 'VALIDATION' ? 400 : e.code === 'TENANCY_DISABLED' ? 503 : 500;
        res.status(status).json({ error: e.message || 'Resend failed', code: e.code });
    }
});

router.post('/tenants/:id/device-keys', requireProvisionAuth, async (req, res) => {
    try {
        const result = await registerDeviceKey(
            req.pool,
            req.params.id,
            req.body?.deviceKey,
            req.body?.label
        );
        res.status(201).json(result);
    } catch (e) {
        const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'VALIDATION' ? 400 : 500;
        res.status(status).json({ error: e.message || 'Register failed', code: e.code });
    }
});

/** Rotate website API key — plaintext returned once for Ops / face-site env. */
router.post('/tenants/:id/rotate-website-key', requireProvisionAuth, async (req, res) => {
    try {
        const result = await rotateWebsiteKey(req.pool, req.params.id);
        res.json({
            success: true,
            account: {
                id: result.merchant.id,
                slug: result.merchant.slug,
                businessName: result.merchant.businessName,
                billingEmail: result.merchant.billingEmail,
                websiteApiKeyPrefix: result.websiteApiKeyPrefix,
                sharedPosApiOrigin: result.sharedPosApiOrigin,
                status: result.merchant.status
            },
            secrets: {
                websiteApiKey: result.websiteApiKey,
                note: 'Website key shown once. Copy into the face site NEXT_PUBLIC_WEBSITE_API_KEY.'
            }
        });
    } catch (e) {
        const status =
            e.code === 'NOT_FOUND'
                ? 404
                : e.code === 'VALIDATION'
                  ? 400
                  : e.code === 'TENANCY_DISABLED'
                    ? 503
                    : 500;
        res.status(status).json({ error: e.message || 'Rotate failed', code: e.code });
    }
});

router.post('/directory/resolve', async (req, res) => {
    try {
        if (!tenancyShared()) {
            return res.status(503).json({ error: 'Shared tenancy is not enabled', code: 'TENANCY_DISABLED' });
        }
        const row = await resolveByKey(req.pool, req.body || {});
        if (!row) {
            return res.status(404).json({ error: 'Shop not found', code: 'NOT_FOUND' });
        }
        res.json({
            account: publicMerchant(row),
            resolvedVia: req.body?.websiteApiKey
                ? 'website_key'
                : req.body?.deviceKey
                  ? 'device_key'
                  : 'slug'
        });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Resolve failed' });
    }
});

router.get('/tenants/:id', requireProvisionAuth, async (req, res) => {
    try {
        const row = await findById(req.pool, req.params.id);
        if (!row) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
        res.json({ account: publicMerchant(row) });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Lookup failed' });
    }
});

module.exports = router;
