'use strict';

const bcrypt = require('bcrypt');
const {
    tenancyShared,
    hashTenantSecret,
    randomId,
    slugify
} = require('../utils/ensureTenantsSchema');
const {
    ADMIN_PASSWORD_BCRYPT_ROUNDS,
    generateTempAdminPassword
} = require('../utils/adminPassword');

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

async function setAdminTempPassword(pool, adminId) {
    const tempPassword = generateTempAdminPassword();
    const passwordHash = await bcrypt.hash(tempPassword, ADMIN_PASSWORD_BCRYPT_ROUNDS);
    try {
        await pool.execute(
            `UPDATE admin_users
             SET password_hash = ?, must_change_password = 1, updated_at = NOW()
             WHERE id = ?`,
            [passwordHash, adminId]
        );
    } catch (err) {
        if (err && (err.code === 'ER_BAD_FIELD_ERROR' || /must_change_password/i.test(String(err.message || '')))) {
            await pool.execute(
                `UPDATE admin_users SET password_hash = ?, updated_at = NOW() WHERE id = ?`,
                [passwordHash, adminId]
            );
        } else {
            throw err;
        }
    }
    return tempPassword;
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
        // Existing row had no one-time password to email — mint a fresh temp password
        // so provision / resend can deliver credentials for a brand-new shop.
        const tempPassword = await setAdminTempPassword(pool, existing[0].id);
        return { adminId: existing[0].id, tempPassword };
    }

    const tempPassword = generateTempAdminPassword();
    const passwordHash = await bcrypt.hash(tempPassword, ADMIN_PASSWORD_BCRYPT_ROUNDS);
    const first = String(businessName || 'Owner').trim().slice(0, 80) || 'Owner';
    let result;
    try {
        [result] = await pool.execute(
            `INSERT INTO admin_users (email, password_hash, first_name, last_name, role, is_active, merchant_id, must_change_password)
             VALUES (?, ?, ?, '', 'admin', 1, ?, 1)`,
            [email, passwordHash, first, merchantId]
        );
    } catch (err) {
        if (err && (err.code === 'ER_BAD_FIELD_ERROR' || /must_change_password/i.test(String(err.message || '')))) {
            [result] = await pool.execute(
                `INSERT INTO admin_users (email, password_hash, first_name, last_name, role, is_active, merchant_id)
                 VALUES (?, ?, ?, '', 'admin', 1, ?)`,
                [email, passwordHash, first, merchantId]
            );
        } else {
            throw err;
        }
    }
    return { adminId: result.insertId, tempPassword };
}

/**
 * Rotate owner admin password for an existing merchant (credentials resend).
 * findById returns a raw DB row (snake_case). Optional fallbackEmail is used when
 * platform_merchants.billing_email is empty (Ops project contact / billing email).
 * @returns {Promise<{ merchant: object, email: string, tempPassword: string }>}
 */
async function resetOwnerAdminCredentials(pool, merchantId, fallbackEmail = null) {
    const row = await findById(pool, merchantId);
    if (!row || row.status === 'deleted') {
        const err = new Error('Shop account not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    let email = String(row.billing_email || row.billingEmail || '')
        .trim()
        .toLowerCase();
    const fallback = String(fallbackEmail || '')
        .trim()
        .toLowerCase();
    if ((!email || !email.includes('@')) && fallback.includes('@')) {
        email = fallback.slice(0, 255);
        await pool.execute(`UPDATE platform_merchants SET billing_email = ? WHERE id = ?`, [
            email,
            merchantId
        ]);
        row.billing_email = email;
    }
    if (!email || !email.includes('@')) {
        const err = new Error('Merchant billing email is missing');
        err.code = 'VALIDATION';
        throw err;
    }

    const businessName = String(row.business_name || row.businessName || 'Owner');
    const [rows] = await pool.execute(
        `SELECT id FROM admin_users
         WHERE email = ? AND (merchant_id = ? OR merchant_id IS NULL)
         ORDER BY CASE WHEN merchant_id = ? THEN 0 ELSE 1 END, id ASC
         LIMIT 1`,
        [email, merchantId, merchantId]
    );
    let adminId = rows[0]?.id || null;
    if (!adminId) {
        const created = await ensureOwnerAdmin(pool, merchantId, email, businessName);
        adminId = created?.adminId || null;
        if (created?.tempPassword) {
            return {
                merchant: publicMerchant(row),
                email,
                tempPassword: created.tempPassword
            };
        }
    }
    if (!adminId) {
        const err = new Error('Owner admin user not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    await pool
        .execute(`UPDATE admin_users SET merchant_id = ? WHERE id = ?`, [merchantId, adminId])
        .catch(() => {});
    const tempPassword = await setAdminTempPassword(pool, adminId);
    return {
        merchant: publicMerchant(row),
        email,
        tempPassword
    };
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
    const { normalizeHostingTier, buildTierFromHosting } = require('./merchantEntitlements');
    const hostingTier = normalizeHostingTier(input.hostingTier ?? input.hosting_tier);
    const buildTier = buildTierFromHosting(hostingTier) || null;
    const shopConfig = {
        storeType: shopVerticals.length ? 'shop' : storeType,
        shopVerticals,
        addons,
        hostingTier: hostingTier || null,
        buildTier,
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
    // Keep contractor inside pos_shop_verticals so Admin checkboxes match signup choices.
    await upsertSetting(
        pool,
        'pos_shop_verticals',
        JSON.stringify(shopVerticals),
        'JSON array of shop verticals: contractor, auto, body, upholstery, tire',
        'string'
    );
    await upsertSetting(
        pool,
        'pos_shop_contractor',
        shopVerticals.includes('contractor') ? 'true' : 'false',
        'Contractor / estimate mode enabled',
        'boolean'
    );
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

    // Create first register key so signup includes a usable POS device key.
    let deviceApiKey = null;
    let deviceLabel = 'Front counter';
    let deviceKeyPrefix = null;
    try {
        const {
            getStoreBaseUrl,
            setStoreBaseUrlOverride,
            normalizeStoreBaseUrl
        } = require('../utils/platformSupportEnv');
        let storeUrl = getStoreBaseUrl();
        if (!storeUrl) {
            storeUrl =
                normalizeStoreBaseUrl(
                    process.env.SHARED_POS_PUBLIC_ORIGIN ||
                        process.env.FRONTEND_URL ||
                        process.env.POS_PLATFORM_STORE_URL ||
                        'https://pos.businessonecomprehensive.com'
                ) || 'https://pos.businessonecomprehensive.com';
            setStoreBaseUrlOverride(storeUrl);
            try {
                await upsertSetting(
                    pool,
                    'pos_store_base_url',
                    storeUrl,
                    'Public store / POS API base URL embedded in register keys',
                    'string'
                );
            } catch {
                /* settings write is best-effort */
            }
        }
        const { createDevice } = require('./posDeviceRegistry');
        const created = await createDevice(pool, deviceLabel, id);
        deviceApiKey = created.apiKey || null;
        deviceLabel = created.deviceLabel || deviceLabel;
        deviceKeyPrefix = created.keyPrefix || null;
        if (!deviceApiKey) {
            console.warn('[tenantProvision] createDevice returned no apiKey');
        }
    } catch (e) {
        console.warn('[tenantProvision] createDevice failed:', e.message);
    }

    const row = await findById(pool, id);
    return {
        alreadyProvisioned: false,
        merchant: { ...publicMerchant(row), shopConfig },
        websiteApiKey,
        websiteApiKeyPrefix: websitePrefix,
        tempAdminPassword: owner && owner.tempPassword ? owner.tempPassword : null,
        deviceApiKey,
        deviceLabel,
        deviceKeyPrefix,
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

/**
 * Issue a new website API key (invalidates the previous hash).
 * Plaintext is returned once for Ops / face-site env.
 */
async function rotateWebsiteKey(pool, merchantId) {
    if (!tenancyShared()) {
        const err = new Error('Shared tenancy is not enabled');
        err.code = 'TENANCY_DISABLED';
        throw err;
    }
    const id = String(merchantId || '').trim();
    if (!id) {
        const err = new Error('Shop account id is required');
        err.code = 'VALIDATION';
        throw err;
    }
    const merchant = await findById(pool, id);
    if (!merchant || merchant.status !== 'active') {
        const err = new Error('Shop account not found');
        err.code = 'NOT_FOUND';
        throw err;
    }

    const websiteApiKey = `web_${require('crypto').randomBytes(24).toString('hex')}`;
    const websiteHash = hashTenantSecret(websiteApiKey);
    const websitePrefix = websiteApiKey.slice(0, 12);

    const [existing] = await pool.execute(
        `SELECT id FROM platform_merchant_keys
         WHERE merchant_id = ? AND kind = 'website_key'
         ORDER BY id ASC
         LIMIT 1`,
        [id]
    );
    if (existing[0]?.id) {
        await pool.execute(
            `UPDATE platform_merchant_keys
             SET key_hash = ?, key_prefix = ?, label = 'Primary website key'
             WHERE id = ?`,
            [websiteHash, websitePrefix, existing[0].id]
        );
    } else {
        await pool.execute(
            `INSERT INTO platform_merchant_keys
             (merchant_id, kind, key_hash, key_prefix, label)
             VALUES (?, 'website_key', ?, ?, 'Primary website key')`,
            [id, websiteHash, websitePrefix]
        );
    }

    return {
        merchant: publicMerchant(merchant),
        websiteApiKey,
        websiteApiKeyPrefix: websitePrefix,
        sharedPosApiOrigin: String(
            process.env.SHARED_POS_PUBLIC_ORIGIN || process.env.FRONTEND_URL || 'http://127.0.0.1:3011'
        )
            .trim()
            .replace(/\/+$/, '')
    };
}

module.exports = {
    publicMerchant,
    findByBillingEmail,
    findById,
    findBySlug,
    resolveByKey,
    provisionTenant,
    registerDeviceKey,
    rotateWebsiteKey,
    ensureOwnerAdmin,
    resetOwnerAdminCredentials,
    applySignupShopConfig,
    normalizeSignupAddons,
    normalizeSignupVerticals
};
