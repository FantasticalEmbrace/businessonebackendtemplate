'use strict';

const bcrypt = require('bcrypt');
const {
    tenancyShared,
    hashTenantSecret,
    randomId,
    slugify
} = require('../utils/ensureTenantsSchema');

function publicMerchant(row) {
    if (!row) return null;
    return {
        id: row.id,
        slug: row.slug,
        businessName: row.business_name,
        billingEmail: row.billing_email || '',
        websiteOrigin: row.website_origin || '',
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

async function findByBillingEmail(pool, email) {
    const billingEmail = String(email || '').trim().toLowerCase();
    if (!billingEmail) return null;
    const [rows] = await pool.execute(
        `SELECT * FROM platform_merchants WHERE billing_email = ? LIMIT 1`,
        [billingEmail]
    );
    return rows[0] || null;
}

async function findById(pool, id) {
    const [rows] = await pool.execute(`SELECT * FROM platform_merchants WHERE id = ? LIMIT 1`, [id]);
    return rows[0] || null;
}

async function findBySlug(pool, slug) {
    const [rows] = await pool.execute(`SELECT * FROM platform_merchants WHERE slug = ? LIMIT 1`, [
        String(slug || '').trim().toLowerCase()
    ]);
    return rows[0] || null;
}

async function resolveByKey(pool, { websiteApiKey, deviceKey, slug } = {}) {
    if (websiteApiKey) {
        const hash = hashTenantSecret(websiteApiKey);
        const [rows] = await pool.execute(
            `SELECT m.* FROM platform_merchants m
             INNER JOIN platform_merchant_keys k ON k.merchant_id = m.id
             WHERE k.kind = 'website_key' AND k.key_hash = ? AND m.status = 'active'
             LIMIT 1`,
            [hash]
        );
        return rows[0] || null;
    }
    if (deviceKey) {
        const dirHash = hashTenantSecret(deviceKey);
        const [byDir] = await pool.execute(
            `SELECT m.* FROM platform_merchants m
             INNER JOIN platform_merchant_keys k ON k.merchant_id = m.id
             WHERE k.kind = 'device_key' AND k.key_hash = ? AND m.status = 'active'
             LIMIT 1`,
            [dirHash]
        );
        if (byDir[0]) return byDir[0];

        const { hashDeviceKey } = require('./posDeviceRegistry');
        const posHash = hashDeviceKey(deviceKey);
        const [devRows] = await pool.execute(
            `SELECT m.* FROM platform_merchants m
             INNER JOIN pos_devices d ON d.merchant_id = m.id
             WHERE d.api_key_hash = ? AND d.is_active = 1 AND m.status = 'active'
             LIMIT 1`,
            [posHash]
        );
        return devRows[0] || null;
    }
    if (slug) return findBySlug(pool, slug);
    return null;
}

async function ensureOwnerAdmin(pool, merchantId, billingEmail, businessName) {
    const email = String(billingEmail || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return null;

    const [existing] = await pool.execute(
        `SELECT id FROM admin_users WHERE email = ? AND (merchant_id = ? OR merchant_id IS NULL) LIMIT 1`,
        [email, merchantId]
    );
    if (existing[0]) {
        await pool
            .execute(`UPDATE admin_users SET merchant_id = ? WHERE id = ?`, [merchantId, existing[0].id])
            .catch(() => {});
        return existing[0].id;
    }

    const tempPassword = `Bo-${randomId().slice(0, 8)}!`;
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const first = String(businessName || 'Owner').trim().slice(0, 80) || 'Owner';
    const [result] = await pool.execute(
        `INSERT INTO admin_users (email, password_hash, first_name, last_name, role, is_active, merchant_id)
         VALUES (?, ?, ?, '', 'admin', 1, ?)`,
        [email, passwordHash, first, merchantId]
    );
    return { adminId: result.insertId, tempPassword };
}

/**
 * Idempotent tenant provision: same billing email returns existing merchant.
 */
async function provisionTenant(pool, input = {}) {
    if (!tenancyShared()) {
        const err = new Error('Shared merchant tenancy is not enabled on this server');
        err.code = 'TENANCY_DISABLED';
        throw err;
    }

    const businessName = String(input.businessName || '').trim().slice(0, 200);
    const billingEmail = String(input.billingEmail || '').trim().toLowerCase().slice(0, 255);
    if (!businessName) {
        const err = new Error('businessName is required');
        err.code = 'VALIDATION';
        throw err;
    }
    if (!billingEmail || !billingEmail.includes('@')) {
        const err = new Error('billingEmail is required');
        err.code = 'VALIDATION';
        throw err;
    }

    const existing = await findByBillingEmail(pool, billingEmail);
    if (existing) {
        return {
            alreadyProvisioned: true,
            merchant: publicMerchant(existing),
            websiteApiKey: null,
            tempAdminPassword: null
        };
    }

    let slug = slugify(input.slug || businessName);
    if (await findBySlug(pool, slug)) {
        slug = `${slug}-${randomId().slice(0, 4)}`;
    }

    const id = randomId();
    const websiteOrigin = String(input.websiteOrigin || '').trim().replace(/\/+$/, '').slice(0, 500);
    const websiteApiKey = `web_${require('crypto').randomBytes(24).toString('hex')}`;
    const websiteHash = hashTenantSecret(websiteApiKey);
    const websitePrefix = websiteApiKey.slice(0, 12);

    await pool.execute(
        `INSERT INTO platform_merchants
         (id, slug, business_name, billing_email, website_origin, status)
         VALUES (?, ?, ?, ?, ?, 'active')`,
        [id, slug, businessName, billingEmail, websiteOrigin]
    );

    await pool.execute(
        `INSERT INTO platform_merchant_keys
         (merchant_id, kind, key_hash, key_prefix, label)
         VALUES (?, 'website_key', ?, ?, 'Primary website key')`,
        [id, websiteHash, websitePrefix]
    );

    const owner = await ensureOwnerAdmin(pool, id, billingEmail, businessName);

    try {
        const { persistMerchantStoreBranding } = require('./storeBranding');
        await persistMerchantStoreBranding(pool, {
            storeName: businessName,
            logoUrl: input.logoUrl || input.storeLogoUrl || undefined,
        });
    } catch {
        /* branding sync is best-effort during provision */
    }

    const row = await findById(pool, id);
    return {
        alreadyProvisioned: false,
        merchant: publicMerchant(row),
        websiteApiKey,
        websiteApiKeyPrefix: websitePrefix,
        tempAdminPassword: owner && owner.tempPassword ? owner.tempPassword : null,
        sharedPosApiOrigin: String(process.env.SHARED_POS_PUBLIC_ORIGIN || process.env.FRONTEND_URL || 'http://127.0.0.1:3011')
            .trim()
            .replace(/\/+$/, '')
    };
}

async function registerDeviceKey(pool, merchantId, deviceKey, label = '') {
    const merchant = await findById(pool, merchantId);
    if (!merchant || merchant.status !== 'active') {
        const err = new Error('Shop account not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    const key = String(deviceKey || '').trim();
    if (!key) {
        const err = new Error('deviceKey is required');
        err.code = 'VALIDATION';
        throw err;
    }
    const keyHash = hashTenantSecret(key);
    await pool.execute(
        `INSERT INTO platform_merchant_keys
         (merchant_id, kind, key_hash, key_prefix, label)
         VALUES (?, 'device_key', ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           merchant_id = VALUES(merchant_id),
           label = VALUES(label)`,
        [merchantId, keyHash, key.slice(0, 16), String(label || '').slice(0, 120)]
    );
    return { ok: true, merchantId, keyPrefix: key.slice(0, 16) };
}

module.exports = {
    publicMerchant,
    findByBillingEmail,
    findById,
    findBySlug,
    resolveByKey,
    provisionTenant,
    registerDeviceKey,
    ensureOwnerAdmin
};
