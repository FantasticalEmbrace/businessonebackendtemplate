'use strict';

const express = require('express');
const { tenancyShared } = require('../utils/ensureTenantsSchema');
const {
    provisionTenant,
    registerDeviceKey,
    resolveByKey,
    publicMerchant,
    findById
} = require('../services/tenantProvision');
const { sendMail, isSmtpConfigured } = require('../utils/mailTransporter');
const logger = require('../utils/logger');

const router = express.Router();

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
    const email = String(result?.merchant?.billingEmail || '').trim();
    const deviceKey = result?.deviceApiKey ? String(result.deviceApiKey).trim() : '';
    const websiteKey = result?.websiteApiKey ? String(result.websiteApiKey).trim() : '';
    if (!email || result.alreadyProvisioned || !isSmtpConfigured()) {
        return false;
    }
    if (!password && !deviceKey && !websiteKey) {
        return false;
    }
    const adminUrl = String(
        process.env.MERCHANT_ADMIN_URL || 'https://pos.businessonecomprehensive.com/admin.html'
    ).trim();
    const businessName = String(result.merchant.businessName || 'Your business').trim();
    const deviceLabel = String(result.deviceLabel || 'Front counter').trim();
    const unlockHtml = developerTestMode
        ? `<p><strong>Developer test mode:</strong> this signup was unlocked for testing — <strong>$0 charged</strong> today.</p>`
        : '';
    const unlockText = developerTestMode
        ? 'Developer test mode: this signup was unlocked for testing — $0 charged today.\n\n'
        : '';
    const passwordHtml = password
        ? `<p><strong>Admin login:</strong> <a href="${adminUrl}">${adminUrl}</a><br>
           <strong>Email:</strong> ${email}<br>
           <strong>Temporary password:</strong> ${password}</p>
           <p>Please sign in and change your password after your first login.</p>`
        : '';
    const passwordText = password
        ? `Admin login: ${adminUrl}\nEmail: ${email}\nTemporary password: ${password}\n\nPlease sign in and change your password after your first login.\n\n`
        : '';
    const deviceHtml = deviceKey
        ? `<p><strong>Register key</strong> for “${deviceLabel}” (paste into the POS app — keep this email; the key is shown once at signup):<br>
           <code style="word-break:break-all;">${deviceKey}</code></p>`
        : '';
    const deviceText = deviceKey ? `Register key (${deviceLabel}): ${deviceKey}\n\n` : '';
    const websiteHtml = websiteKey
        ? `<p><strong>Website key</strong> (for your store website / integrations — keep this email):<br>
           <code style="word-break:break-all;">${websiteKey}</code></p>`
        : '';
    const websiteText = websiteKey ? `Website key: ${websiteKey}\n\n` : '';
    try {
        await sendMail({
            to: email,
            subject: `Your Business One shop account is ready — ${businessName}`,
            html: `<p>Hi,</p>
                   <p>Welcome — your shop account for <strong>${businessName}</strong> is ready.</p>
                   ${unlockHtml}
                   ${passwordHtml}
                   ${deviceHtml}
                   ${websiteHtml}
                   <p>If you do not see an admin login or these keys, call <strong>(850) 290-2084</strong>.</p>
                   <p>— Business One</p>`,
            text: [
                'Hi,',
                '',
                `Welcome — your shop account for ${businessName} is ready.`,
                '',
                unlockText.trimEnd(),
                passwordText.trimEnd(),
                deviceText.trimEnd(),
                websiteText.trimEnd(),
                'If you do not see an admin login or these keys, call (850) 290-2084.',
                '',
                '— Business One'
            ]
                .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
                .join('\n'),
            logTag: 'Merchant credentials'
        });
        return true;
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
            account: {
                id: result.merchant.id,
                slug: result.merchant.slug,
                businessName: result.merchant.businessName,
                billingEmail: result.merchant.billingEmail,
                websiteApiKeyPrefix: result.websiteApiKeyPrefix || null,
                sharedPosApiOrigin: result.sharedPosApiOrigin,
                status: result.merchant.status
            },
            secrets: result.websiteApiKey || result.deviceApiKey
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
