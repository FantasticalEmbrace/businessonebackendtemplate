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
    let shopConfig = null;
    if (row.shop_config != null) {
        try {
            shopConfig =
                typeof row.shop_config === 'string' ? JSON.parse(row.shop_config) : row.shop_config;
        } catch {
            shopConfig = null;
        }
    }
    return {
        id: row.id,
        slug: row.slug,
        businessName: row.business_name,
        billingEmail: row.billing_email || '',
        websiteOrigin: row.website_origin || '',
        status: row.status,
        shopConfig,
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
        return { adminId: existing[0].id, tempPassword: null };
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

function normalizeSignupAddons(raw) {
    const a = raw && typeof raw === 'object' ? raw : {};
    const tirePro = Boolean(a.tirePro || a.tire_pro);
    const warehouse = Boolean(a.warehouse || tirePro);
    const vinFitment = Boolean(a.vinFitment || a.vin_fitment || tirePro);
    const extraDistributors = Math.max(
        0,
        Math.min(10, Math.floor(Number(a.extraDistributors ?? a.extra_distributors) || 0))
    );
    return {
        warehouse,
        vinFitment,
        tirePro,
        extraDistributors: warehouse || tirePro ? extraDistributors : 0
    };
}

function normalizeSignupVerticals(raw) {
    const allowed = new Set(['auto', 'body', 'upholstery', 'tire', 'contractor']);
    let list = [];
    if (Array.isArray(raw)) list = raw;
    else if (typeof raw === 'string' && raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            list = Array.isArray(parsed) ? parsed : String(raw).split(/[,+|]/);
        } catch {
            list = String(raw).split(/[,+|]/);
        }
    }
    const unique = [];
    for (const v of list) {
        const key = String(v || '')
            .trim()
            .toLowerCase();
        if (!allowed.has(key) || unique.includes(key)) continue;
        unique.push(key);
    }
    if (unique.includes('contractor') && unique.length > 1) return ['contractor'];
    return unique;
}

async function upsertSetting(pool, keyName, value, description, type = 'string') {
    await pool.execute(
        `INSERT INTO settings (key_name, value, description, type)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value), description = VALUES(description), type = VALUES(type)`,
        [keyName, value == null ? '' : String(value), description || keyName, type]
    );
}

/**
 * Persist shop modes + add-ons for a merchant (DB JSON + settings used by admin/POS).
 */
async function applySignupShopConfig(pool, merchantId, input = {}) {
    const shopVerticals = normalizeSignupVerticals(input.shopVerticals ?? input.verticals);
    const addons = normalizeSignupAddons(input.addons);
    const storeType = String(input.storeType || '').trim().toLowerCase() === 'retail' ? 'retail' : 'shop';
    const shopConfig = {
        storeType: shopVerticals.length ? 'shop' : storeType,
        shopVerticals,
        addons,
        updatedAt: new Date().toISOString()
    };

    try {
        await pool.execute(`UPDATE platform_merchants SET shop_config = ? WHERE id = ?`, [
            JSON.stringify(shopConfig),
            merchantId
        ]);
    } catch (e) {
        // Column may not exist yet on older DBs — settings fallback still applies.
        if (!String(e.message || '').includes('shop_config')) throw e;
    }

    // Settings table drives admin POS form + loadPosShopSettings (global keys).
    // Merchant-scoped overlay also reads platform_merchants.shop_config when merchantId is known.
    const vehicleVerticals = shopVerticals.filter((v) => v !== 'contractor');
    await upsertSetting(
        pool,
        'pos_shop_verticals',
        JSON.stringify(vehicleVerticals),
        'JSON array of shop verticals: auto, body, upholstery, tire',
        'string'
    );
    if (shopVerticals.includes('contractor')) {
        await upsertSetting(pool, 'pos_shop_contractor', 'true', 'Contractor / estimate mode enabled', 'boolean');
    }
    await upsertSetting(
        pool,
        'pos_addon_warehouse',
        addons.warehouse ? 'true' : 'false',
        'POS add-on: live warehouse inventory',
        'boolean'
    );
    await upsertSetting(
        pool,
        'pos_addon_vin_fitment',
        addons.vinFitment ? 'true' : 'false',
        'POS add-on: VIN & vehicle fitment',
        'boolean'
    );
    await upsertSetting(
        pool,
        'pos_addon_tire_pro',
        addons.tirePro ? 'true' : 'false',
        'POS add-on: Tire Pro bundle',
        'boolean'
    );
    await upsertSetting(
        pool,
        'pos_addon_extra_distributors',
        String(addons.extraDistributors || 0),
        'POS add-on: extra wholesale distributors',
        'number'
    );

    return shopConfig;
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
        // Re-apply modes if signup retries with verticals/addons (idempotent update).
        let shopConfig = null;
        try {
            shopConfig = await applySignupShopConfig(pool, existing.id, input);
        } catch {
            shopConfig = null;
        }
        return {
            alreadyProvisioned: true,
            merchant: { ...publicMerchant(existing), shopConfig: shopConfig || publicMerchant(existing).shopConfig },
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

    let shopConfig = null;
    try {
        shopConfig = await applySignupShopConfig(pool, id, input);
    } catch (e) {
        // Non-fatal: merchant + admin still usable; modes can be set in admin.
        console.warn('[tenantProvision] applySignupShopConfig failed:', e.message);
    }

    try {
        const { persistMerchantStoreBranding } = require('./storeBranding');
        await persistMerchantStoreBranding(pool, {
            storeName: businessName,
            logoUrl: input.logoUrl || input.storeLogoUrl || undefined
        });
    } catch {
        /* branding sync is best-effort during provision */
    }

    const row = await findById(pool, id);
    return {
        alreadyProvisioned: false,
        merchant: { ...publicMerchant(row), shopConfig },
        websiteApiKey,
        websiteApiKeyPrefix: websitePrefix,
        tempAdminPassword: owner && owner.tempPassword ? owner.tempPassword : null,
        sharedPosApiOrigin: String(
            process.env.SHARED_POS_PUBLIC_ORIGIN || process.env.FRONTEND_URL || 'http://127.0.0.1:3011'
        )
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
    ensureOwnerAdmin,
    applySignupShopConfig,
    normalizeSignupAddons,
    normalizeSignupVerticals
};
