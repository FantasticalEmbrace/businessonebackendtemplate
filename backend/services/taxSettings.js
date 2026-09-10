'use strict';

/**
 * Destination-tax settings stored in `settings` (admin UI).
 * The Ziptax key is the same value as backend/.env `ZIPTAX_API_KEY` — saving in admin
 * persists it in the DB and syncs `process.env.ZIPTAX_API_KEY` so checkout uses it immediately.
 *
 * Tenants:
 * - storefront / default — online shipping checkout (may list tax-exempt destination states)
 * - business_one — signup / hardware / custom billing (no exempt states by default)
 *
 * Listed states = sell OK, $0 tax (never a ship/sales blocklist).
 *
 * Preferred DB keys: `store_tax_exempt_states` / `bo_tax_exempt_states`.
 * Legacy `*_tax_ignore_states` (and older `hm_tax_*` keys) are read once and write-forwarded.
 */

const REDACT_PLACEHOLDER = '[configured]';

/** DB key_name matches the env var name so admin UI and .env are the same slot. */
const KEYS = Object.freeze({
    /** Storefront online checkout Ziptax key (env: ZIPTAX_API_KEY). */
    ZIPTAX_API_KEY: 'ZIPTAX_API_KEY',
    ZIPTAX_API_KEY_LEGACY: 'cred_ziptax_api_key',
    /** Platform / billing Ziptax key — separate account from storefront checkout. */
    BO_ZIPTAX_API_KEY: 'BO_ZIPTAX_API_KEY',
    /** Tenant-neutral tax-exempt destination states (CSV) — sales/shipping allowed, tax = $0. */
    STORE_EXEMPT_STATES: 'store_tax_exempt_states',
    /** Legacy alias still read for older principal-store rows. */
    HM_EXEMPT_STATES: 'hm_tax_exempt_states',
    /** Tax-exempt destination states for Business One billing (CSV). */
    BO_EXEMPT_STATES: 'bo_tax_exempt_states',
    STORE_ACCOUNTANT_EMAIL: 'store_tax_accountant_email',
    HM_ACCOUNTANT_EMAIL: 'hm_tax_accountant_email',
    BO_ACCOUNTANT_EMAIL: 'bo_tax_accountant_email'
});

/** Legacy DB keys — read fallback only; cleared after successful migrate/save. */
const LEGACY_KEYS = Object.freeze({
    STORE_EXEMPT_STATES: 'store_tax_ignore_states',
    HM_EXEMPT_STATES: 'hm_tax_ignore_states',
    BO_EXEMPT_STATES: 'bo_tax_ignore_states'
});

const ALL_KEYS = [
    KEYS.ZIPTAX_API_KEY,
    KEYS.ZIPTAX_API_KEY_LEGACY,
    KEYS.BO_ZIPTAX_API_KEY,
    KEYS.STORE_EXEMPT_STATES,
    KEYS.HM_EXEMPT_STATES,
    KEYS.BO_EXEMPT_STATES,
    LEGACY_KEYS.STORE_EXEMPT_STATES,
    LEGACY_KEYS.HM_EXEMPT_STATES,
    LEGACY_KEYS.BO_EXEMPT_STATES,
    KEYS.STORE_ACCOUNTANT_EMAIL,
    KEYS.HM_ACCOUNTANT_EMAIL,
    KEYS.BO_ACCOUNTANT_EMAIL
];

/** @type {Record<string, string>} */
let cache = {};

function trim(v) {
    return v != null ? String(v).trim() : '';
}

function isSecretPlaceholder(value) {
    const v = trim(value);
    if (!v) return true;
    if (v === '••••••••' || v === '********') return true;
    return v === REDACT_PLACEHOLDER || v.startsWith(REDACT_PLACEHOLDER);
}

function maskSecret(value) {
    const v = trim(value);
    if (!v) return '';
    if (v.length <= 4) return REDACT_PLACEHOLDER;
    return `${REDACT_PLACEHOLDER} (…${v.slice(-4)})`;
}

function parseStateList(raw) {
    const parts = String(raw || '')
        .split(/[\s,;]+/)
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z]{2}$/.test(s));
    return [...new Set(parts)];
}

function formatStateList(states) {
    return parseStateList(states).join(',');
}

/**
 * Keep process.env in sync for the keys we just loaded/saved.
 */
function syncZiptaxKeyIntoEnv(key, envName = 'ZIPTAX_API_KEY') {
    const v = trim(key);
    if (!v) return;
    process.env[envName] = v;
}

/** Skip repeated settings SELECTs during a single checkout (order create + pay). */
let lastHydrateAt = 0;
const HYDRATE_TTL_MS = 60 * 1000;

async function clearSetting(pool, key) {
    if (!pool || !key) return;
    await pool.execute(`DELETE FROM settings WHERE key_name = ?`, [key]);
    delete cache[key];
}

/**
 * If new exempt key is empty but legacy ignore key has a CSV, copy forward and drop legacy.
 * Safe: only runs when new is empty so we never overwrite a deliberate new value.
 */
async function migrateLegacyExemptKey(pool, newKey, legacyKey, description) {
    const nextVal = trim(cache[newKey]);
    const legacyVal = trim(cache[legacyKey]);
    if (nextVal || !legacyVal) return false;
    await upsertSetting(pool, newKey, formatStateList(legacyVal), description);
    cache[newKey] = formatStateList(legacyVal);
    await clearSetting(pool, legacyKey);
    return true;
}

async function hydrateFromDatabase(pool, opts = {}) {
    if (!pool) {
        cache = {};
        lastHydrateAt = 0;
        return;
    }
    const force = Boolean(opts.force);
    if (!force && lastHydrateAt && Date.now() - lastHydrateAt < HYDRATE_TTL_MS && Object.keys(cache).length) {
        return;
    }
    const placeholders = ALL_KEYS.map(() => '?').join(', ');
    const [rows] = await pool.execute(
        `SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`,
        ALL_KEYS
    );
    const next = {};
    for (const row of rows || []) {
        next[row.key_name] = row.value != null ? String(row.value) : '';
    }
    cache = next;
    lastHydrateAt = Date.now();

    // One-time write-forward so admin/checkout share a single source of truth.
    await migrateLegacyExemptKey(
        pool,
        KEYS.STORE_EXEMPT_STATES,
        LEGACY_KEYS.STORE_EXEMPT_STATES,
        'Tax-exempt destination states for online shipping (CSV) — sales allowed, $0 tax'
    );
    await migrateLegacyExemptKey(
        pool,
        KEYS.HM_EXEMPT_STATES,
        LEGACY_KEYS.HM_EXEMPT_STATES,
        'Tax-exempt destination states for online shipping (CSV) — sales allowed, $0 tax'
    );
    await migrateLegacyExemptKey(
        pool,
        KEYS.BO_EXEMPT_STATES,
        LEGACY_KEYS.BO_EXEMPT_STATES,
        'Tax-exempt destination states for Business One billing (CSV; usually empty) — sales allowed, $0 tax'
    );

    const hmKey = getHmZiptaxApiKeyFromCacheOnly();
    if (hmKey) syncZiptaxKeyIntoEnv(hmKey, 'ZIPTAX_API_KEY');
    const boKey = getBoZiptaxApiKeyFromCacheOnly();
    if (boKey) syncZiptaxKeyIntoEnv(boKey, 'BO_ZIPTAX_API_KEY');
}

function resolveDbOrEnv(dbKey, envKeys, fallback = '') {
    const fromDb = trim(cache[dbKey]);
    if (fromDb) return fromDb;
    for (const envKey of envKeys || []) {
        const fromEnv = trim(process.env[envKey]);
        if (fromEnv) return fromEnv;
    }
    return fallback;
}

function getHmZiptaxApiKeyFromCacheOnly() {
    return trim(cache[KEYS.ZIPTAX_API_KEY]) || trim(cache[KEYS.ZIPTAX_API_KEY_LEGACY]) || '';
}

function getBoZiptaxApiKeyFromCacheOnly() {
    return trim(cache[KEYS.BO_ZIPTAX_API_KEY]) || '';
}

/** Primary storefront Ziptax key (ZIPTAX_API_KEY). */
function getHmZiptaxApiKey() {
    return (
        getHmZiptaxApiKeyFromCacheOnly() ||
        trim(process.env.ZIPTAX_API_KEY) ||
        trim(process.env.BILLING_ZIPTAX_API_KEY) ||
        ''
    );
}

/** Business One billing key only — never falls back to storefront ZIPTAX_API_KEY. */
function getBoZiptaxApiKey() {
    return getBoZiptaxApiKeyFromCacheOnly() || trim(process.env.BO_ZIPTAX_API_KEY) || '';
}

/**
 * Tenant-scoped Ziptax API key.
 * @param {'storefront'|'business_one'|'hmherbs'} [tenant]
 */
function getZiptaxApiKey(tenant = 'business_one') {
    const t = String(tenant || '').toLowerCase();
    if (t === 'business_one' || t === 'bo' || t === 'business-one') {
        return getBoZiptaxApiKey();
    }
    return getHmZiptaxApiKey();
}

/**
 * States where destination tax is not collected (sales/shipping still allowed).
 * Prefers store-generic / BO keys, then legacy ignore keys, then env.
 */
function getExemptStates(tenant = 'business_one') {
    const t = String(tenant || '').toLowerCase();
    if (t === 'business_one' || t === 'bo' || t === 'business-one') {
        const fromStore = trim(cache[KEYS.STORE_EXEMPT_STATES]) || trim(cache[LEGACY_KEYS.STORE_EXEMPT_STATES]);
        const fromNew = trim(cache[KEYS.BO_EXEMPT_STATES]);
        const fromLegacy = trim(cache[LEGACY_KEYS.BO_EXEMPT_STATES]);
        return parseStateList(
            fromStore ||
                fromNew ||
                fromLegacy ||
                resolveDbOrEnv(
                    KEYS.BO_EXEMPT_STATES,
                    [
                        'BO_TAX_EXEMPT_STATES',
                        'BO_TAX_IGNORE_STATES',
                        'BILLING_TAX_EXEMPT_STATES',
                        'BILLING_TAX_IGNORE_STATES',
                        'TAX_EXEMPT_STATES',
                        'TAX_IGNORE_STATES'
                    ],
                    ''
                )
        );
    }
    const fromStore = trim(cache[KEYS.STORE_EXEMPT_STATES]) || trim(cache[LEGACY_KEYS.STORE_EXEMPT_STATES]);
    const fromNew = trim(cache[KEYS.HM_EXEMPT_STATES]);
    const fromLegacy = trim(cache[LEGACY_KEYS.HM_EXEMPT_STATES]);
    return parseStateList(
        fromStore ||
            fromNew ||
            fromLegacy ||
            resolveDbOrEnv(
                KEYS.STORE_EXEMPT_STATES,
                ['STORE_TAX_EXEMPT_STATES', 'STORE_TAX_IGNORE_STATES', 'TAX_EXEMPT_STATES', 'TAX_IGNORE_STATES'],
                ''
            )
    );
}

/** True when destination state is tax-exempt for online shipping (tax = $0; selling allowed). */
function isStateTaxExempt(state, tenant = 'business_one') {
    const code = String(state || '')
        .trim()
        .toUpperCase()
        .slice(0, 2);
    if (!/^[A-Z]{2}$/.test(code)) return false;
    return getExemptStates(tenant).includes(code);
}

function getHmAccountantEmail() {
    return resolveDbOrEnv(
        KEYS.STORE_ACCOUNTANT_EMAIL,
        ['TAX_ACCOUNTANT_EMAIL', 'STORE_TAX_ACCOUNTANT_EMAIL'],
        ''
    ) || resolveDbOrEnv(KEYS.HM_ACCOUNTANT_EMAIL, ['HM_TAX_ACCOUNTANT_EMAIL'], '');
}

function getBoAccountantEmail() {
    return resolveDbOrEnv(KEYS.BO_ACCOUNTANT_EMAIL, [
        'BO_TAX_ACCOUNTANT_EMAIL',
        'BILLING_TAX_ACCOUNTANT_EMAIL'
    ]);
}

function getAccountantEmail(tenant = 'business_one') {
    const t = String(tenant || '').toLowerCase();
    if (t === 'business_one' || t === 'bo' || t === 'business-one') {
        return getBoAccountantEmail();
    }
    return getHmAccountantEmail();
}

async function upsertSetting(pool, key, value, description) {
    await pool.execute(
        `INSERT INTO settings (key_name, value, description, type)
         VALUES (?, ?, ?, 'string')
         ON DUPLICATE KEY UPDATE value = VALUES(value), type = VALUES(type)`,
        [key, value, description || `Tax setting: ${key}`]
    );
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {object} updates
 */
async function saveTaxSettings(pool, updates = {}) {
    if (!pool) throw new Error('Database not available');

    const saved = [];

    if ('ziptaxApiKey' in updates || KEYS.ZIPTAX_API_KEY in updates || 'cred_ziptax_api_key' in updates) {
        const raw =
            updates.ziptaxApiKey != null
                ? updates.ziptaxApiKey
                : updates[KEYS.ZIPTAX_API_KEY] != null
                  ? updates[KEYS.ZIPTAX_API_KEY]
                  : updates.cred_ziptax_api_key;
        const value = trim(raw);
        if (!isSecretPlaceholder(value)) {
            await upsertSetting(
                pool,
                KEYS.ZIPTAX_API_KEY,
                value,
                'Ziptax API key for online destination tax (ZIPTAX_API_KEY)'
            );
            syncZiptaxKeyIntoEnv(value, 'ZIPTAX_API_KEY');
            saved.push(KEYS.ZIPTAX_API_KEY);
        }
    }

    if (
        'boZiptaxApiKey' in updates ||
        KEYS.BO_ZIPTAX_API_KEY in updates ||
        'businessOneZiptaxApiKey' in updates
    ) {
        const raw =
            updates.boZiptaxApiKey != null
                ? updates.boZiptaxApiKey
                : updates.businessOneZiptaxApiKey != null
                  ? updates.businessOneZiptaxApiKey
                  : updates[KEYS.BO_ZIPTAX_API_KEY];
        const value = trim(raw);
        if (!isSecretPlaceholder(value)) {
            await upsertSetting(
                pool,
                KEYS.BO_ZIPTAX_API_KEY,
                value,
                'Business One Ziptax API key (BO_ZIPTAX_API_KEY) — separate from storefront checkout'
            );
            syncZiptaxKeyIntoEnv(value, 'BO_ZIPTAX_API_KEY');
            saved.push(KEYS.BO_ZIPTAX_API_KEY);
        }
    }

    const hmExemptTouched =
        'hmExemptStates' in updates ||
        'hmIgnoreStates' in updates ||
        'storeExemptStates' in updates ||
        KEYS.STORE_EXEMPT_STATES in updates ||
        KEYS.HM_EXEMPT_STATES in updates ||
        LEGACY_KEYS.STORE_EXEMPT_STATES in updates ||
        LEGACY_KEYS.HM_EXEMPT_STATES in updates;
    if (hmExemptTouched) {
        const raw =
            updates.hmExemptStates != null
                ? updates.hmExemptStates
                : updates.storeExemptStates != null
                  ? updates.storeExemptStates
                  : updates.hmIgnoreStates != null
                    ? updates.hmIgnoreStates
                    : updates[KEYS.STORE_EXEMPT_STATES] != null
                      ? updates[KEYS.STORE_EXEMPT_STATES]
                      : updates[KEYS.HM_EXEMPT_STATES] != null
                        ? updates[KEYS.HM_EXEMPT_STATES]
                        : updates[LEGACY_KEYS.STORE_EXEMPT_STATES] != null
                          ? updates[LEGACY_KEYS.STORE_EXEMPT_STATES]
                          : updates[LEGACY_KEYS.HM_EXEMPT_STATES];
        const value = formatStateList(raw);
        await upsertSetting(
            pool,
            KEYS.STORE_EXEMPT_STATES,
            value,
            'Tax-exempt destination states for online shipping (CSV) — sales allowed, $0 tax'
        );
        await clearSetting(pool, LEGACY_KEYS.STORE_EXEMPT_STATES);
        await clearSetting(pool, LEGACY_KEYS.HM_EXEMPT_STATES);
        saved.push(KEYS.STORE_EXEMPT_STATES);
    }

    const boExemptTouched =
        'boExemptStates' in updates ||
        'boIgnoreStates' in updates ||
        KEYS.BO_EXEMPT_STATES in updates ||
        LEGACY_KEYS.BO_EXEMPT_STATES in updates;
    if (boExemptTouched) {
        const raw =
            updates.boExemptStates != null
                ? updates.boExemptStates
                : updates.boIgnoreStates != null
                  ? updates.boIgnoreStates
                  : updates[KEYS.BO_EXEMPT_STATES] != null
                    ? updates[KEYS.BO_EXEMPT_STATES]
                    : updates[LEGACY_KEYS.BO_EXEMPT_STATES];
        const value = formatStateList(raw);
        await upsertSetting(
            pool,
            KEYS.BO_EXEMPT_STATES,
            value,
            'Tax-exempt destination states for Business One billing (CSV; usually empty) — sales allowed, $0 tax'
        );
        await clearSetting(pool, LEGACY_KEYS.BO_EXEMPT_STATES);
        saved.push(KEYS.BO_EXEMPT_STATES);
    }

    if (
        'hmAccountantEmail' in updates ||
        'storeAccountantEmail' in updates ||
        KEYS.STORE_ACCOUNTANT_EMAIL in updates ||
        KEYS.HM_ACCOUNTANT_EMAIL in updates
    ) {
        const raw =
            updates.hmAccountantEmail != null
                ? updates.hmAccountantEmail
                : updates.storeAccountantEmail != null
                  ? updates.storeAccountantEmail
                  : updates[KEYS.STORE_ACCOUNTANT_EMAIL] != null
                    ? updates[KEYS.STORE_ACCOUNTANT_EMAIL]
                    : updates[KEYS.HM_ACCOUNTANT_EMAIL];
        const value = trim(raw).toLowerCase();
        if (value && !value.includes('@')) {
            const err = new Error('Accountant email must be a valid email address');
            err.code = 'INVALID_EMAIL';
            throw err;
        }
        await upsertSetting(
            pool,
            KEYS.STORE_ACCOUNTANT_EMAIL,
            value,
            'Monthly online sales tax report recipient'
        );
        saved.push(KEYS.STORE_ACCOUNTANT_EMAIL);
    }

    if ('boAccountantEmail' in updates || KEYS.BO_ACCOUNTANT_EMAIL in updates) {
        const raw =
            updates.boAccountantEmail != null ? updates.boAccountantEmail : updates[KEYS.BO_ACCOUNTANT_EMAIL];
        const value = trim(raw).toLowerCase();
        if (value && !value.includes('@')) {
            const err = new Error('Business One accountant email must be a valid email address');
            err.code = 'INVALID_EMAIL';
            throw err;
        }
        await upsertSetting(
            pool,
            KEYS.BO_ACCOUNTANT_EMAIL,
            value,
            'Business One monthly tax report recipient'
        );
        saved.push(KEYS.BO_ACCOUNTANT_EMAIL);
    }

    await hydrateFromDatabase(pool, { force: true });
    return { saved, settings: buildApiPayload() };
}

function buildApiPayload() {
    const hmKey = getHmZiptaxApiKey();
    const boKey = getBoZiptaxApiKey();
    const storeExempt = getExemptStates('storefront').join(',');
    const boExempt = getExemptStates('business_one').join(',');
    return {
        ziptaxApiKeyConfigured: Boolean(hmKey),
        ziptaxApiKey: hmKey ? maskSecret(hmKey) : '',
        ziptaxEnvVar: 'ZIPTAX_API_KEY',
        boZiptaxApiKeyConfigured: Boolean(boKey),
        boZiptaxApiKey: boKey ? maskSecret(boKey) : '',
        boZiptaxEnvVar: 'BO_ZIPTAX_API_KEY',
        hmExemptStates: storeExempt,
        storeExemptStates: storeExempt,
        boExemptStates: boExempt,
        hmAccountantEmail: getHmAccountantEmail(),
        storeAccountantEmail: getHmAccountantEmail(),
        boAccountantEmail: getBoAccountantEmail(),
        keys: KEYS
    };
}

module.exports = {
    KEYS,
    LEGACY_KEYS,
    REDACT_PLACEHOLDER,
    hydrateFromDatabase,
    getZiptaxApiKey,
    getHmZiptaxApiKey,
    getBoZiptaxApiKey,
    getExemptStates,
    isStateTaxExempt,
    getHmAccountantEmail,
    getBoAccountantEmail,
    getAccountantEmail,
    saveTaxSettings,
    buildApiPayload,
    parseStateList,
    formatStateList,
    isSecretPlaceholder,
    syncZiptaxKeyIntoEnv
};
