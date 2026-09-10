'use strict';

const KEYS = Object.freeze({
    ZIPTAX_API_KEY: 'ZIPTAX_API_KEY',
    ZIPTAX_LEGACY: 'cred_ziptax_api_key',
    STORE_ACCOUNTANT_EMAIL: 'store_tax_accountant_email',
    HM_ACCOUNTANT_EMAIL: 'hm_tax_accountant_email',
    STORE_EXEMPT_STATES: 'store_tax_exempt_states',
    HM_EXEMPT_STATES: 'hm_tax_exempt_states'
});

const LEGACY_KEYS = Object.freeze({
    STORE_EXEMPT_STATES: 'store_tax_ignore_states',
    HM_EXEMPT_STATES: 'hm_tax_ignore_states'
});

const ALL_KEYS = [
    KEYS.ZIPTAX_API_KEY,
    KEYS.ZIPTAX_LEGACY,
    KEYS.STORE_ACCOUNTANT_EMAIL,
    KEYS.HM_ACCOUNTANT_EMAIL,
    KEYS.STORE_EXEMPT_STATES,
    KEYS.HM_EXEMPT_STATES,
    LEGACY_KEYS.STORE_EXEMPT_STATES,
    LEGACY_KEYS.HM_EXEMPT_STATES
];

const REDACT_PLACEHOLDER = '[configured]';

function trim(value) {
    return value != null ? String(value).trim() : '';
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

async function loadSettingsMap(pool) {
    const map = new Map();
    if (!pool) return map;
    const placeholders = ALL_KEYS.map(() => '?').join(', ');
    const [rows] = await pool.execute(
        `SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`,
        ALL_KEYS
    );
    for (const row of rows || []) {
        map.set(row.key_name, row.value != null ? String(row.value) : '');
    }
    return map;
}

function resolveZiptaxKey(map) {
    return trim(map.get(KEYS.ZIPTAX_API_KEY)) || trim(map.get(KEYS.ZIPTAX_LEGACY)) || trim(process.env.ZIPTAX_API_KEY);
}

function resolveExemptStates(map, { isPrincipalStore = false } = {}) {
    const store =
        formatStateList(map.get(KEYS.STORE_EXEMPT_STATES)) ||
        formatStateList(map.get(LEGACY_KEYS.STORE_EXEMPT_STATES));
    if (store) return store;
    if (isPrincipalStore) {
        return (
            formatStateList(map.get(KEYS.HM_EXEMPT_STATES)) ||
            formatStateList(
                map.get(LEGACY_KEYS.HM_EXEMPT_STATES) ||
                    process.env.HM_TAX_EXEMPT_STATES ||
                    process.env.HM_TAX_IGNORE_STATES ||
                    ''
            )
        );
    }
    return '';
}

function resolveSavedAccountantEmail(map, { isPrincipalStore = false } = {}) {
    const store = trim(map.get(KEYS.STORE_ACCOUNTANT_EMAIL)).toLowerCase();
    if (store) return store;
    if (isPrincipalStore) {
        return trim(map.get(KEYS.HM_ACCOUNTANT_EMAIL)).toLowerCase();
    }
    return '';
}

async function getAccountantEmail(pool, { isPrincipalStore = false } = {}) {
    const map = await loadSettingsMap(pool);
    const saved = resolveSavedAccountantEmail(map, { isPrincipalStore });
    if (saved) return saved;
    if (isPrincipalStore) {
        return trim(process.env.TAX_ACCOUNTANT_EMAIL || '').toLowerCase();
    }
    return '';
}

async function buildApiPayload(pool, { isPrincipalStore = false } = {}) {
    let map = await loadSettingsMap(pool);
    await migrateLegacyExemptKeys(pool, map, { isPrincipalStore });
    map = await loadSettingsMap(pool);
    const ziptaxKey = resolveZiptaxKey(map);
    const savedEmail = resolveSavedAccountantEmail(map, { isPrincipalStore });
    return {
        ziptaxApiKeyConfigured: Boolean(ziptaxKey),
        ziptaxApiKey: ziptaxKey ? maskSecret(ziptaxKey) : '',
        hmExemptStates: resolveExemptStates(map, { isPrincipalStore }),
        hmAccountantEmail: savedEmail,
        accountantEmailConfigured: Boolean(savedEmail)
    };
}

async function upsertSetting(pool, key, value, description) {
    await pool.execute(
        `INSERT INTO settings (key_name, value, description, type)
         VALUES (?, ?, ?, 'string')
         ON DUPLICATE KEY UPDATE value = VALUES(value), type = VALUES(type)`,
        [key, value, description || `Tax setting: ${key}`]
    );
}

async function clearSetting(pool, key) {
    if (!pool || !key) return;
    await pool.execute(`DELETE FROM settings WHERE key_name = ?`, [key]);
}

/**
 * Write-forward legacy ignore keys when new exempt keys are empty.
 */
async function migrateLegacyExemptKeys(pool, map, { isPrincipalStore = false } = {}) {
    const storeNew = trim(map.get(KEYS.STORE_EXEMPT_STATES));
    const storeLegacy = trim(map.get(LEGACY_KEYS.STORE_EXEMPT_STATES));
    if (!storeNew && storeLegacy) {
        const value = formatStateList(storeLegacy);
        await upsertSetting(
            pool,
            KEYS.STORE_EXEMPT_STATES,
            value,
            'Tax-exempt destination states for online shipping (CSV) — sales allowed, $0 tax'
        );
        await clearSetting(pool, LEGACY_KEYS.STORE_EXEMPT_STATES);
        map.set(KEYS.STORE_EXEMPT_STATES, value);
        map.delete(LEGACY_KEYS.STORE_EXEMPT_STATES);
    }

    if (isPrincipalStore) {
        const hmNew = trim(map.get(KEYS.HM_EXEMPT_STATES));
        const hmLegacy = trim(map.get(LEGACY_KEYS.HM_EXEMPT_STATES));
        if (!hmNew && hmLegacy) {
            const value = formatStateList(hmLegacy);
            await upsertSetting(
                pool,
                KEYS.HM_EXEMPT_STATES,
                value,
                'Tax-exempt destination states (CSV) — sales allowed, $0 tax'
            );
            await clearSetting(pool, LEGACY_KEYS.HM_EXEMPT_STATES);
            map.set(KEYS.HM_EXEMPT_STATES, value);
            map.delete(LEGACY_KEYS.HM_EXEMPT_STATES);
        }
    }
}

async function saveTaxSettings(pool, updates = {}, { isPrincipalStore = false } = {}) {
    if (!pool) throw new Error('Database not available');
    const saved = [];

    if ('ziptaxApiKey' in updates || KEYS.ZIPTAX_API_KEY in updates) {
        const raw = updates.ziptaxApiKey != null ? updates.ziptaxApiKey : updates[KEYS.ZIPTAX_API_KEY];
        const value = trim(raw);
        if (!isSecretPlaceholder(value)) {
            await upsertSetting(pool, KEYS.ZIPTAX_API_KEY, value, 'Ziptax API key for online destination tax');
            process.env.ZIPTAX_API_KEY = value;
            saved.push(KEYS.ZIPTAX_API_KEY);
        }
    }

    const exemptTouched =
        'hmExemptStates' in updates ||
        'hmIgnoreStates' in updates ||
        KEYS.STORE_EXEMPT_STATES in updates ||
        LEGACY_KEYS.STORE_EXEMPT_STATES in updates;
    if (exemptTouched) {
        const raw =
            updates.hmExemptStates != null
                ? updates.hmExemptStates
                : updates.hmIgnoreStates != null
                  ? updates.hmIgnoreStates
                  : updates[KEYS.STORE_EXEMPT_STATES] != null
                    ? updates[KEYS.STORE_EXEMPT_STATES]
                    : updates[LEGACY_KEYS.STORE_EXEMPT_STATES];
        const value = formatStateList(raw);
        await upsertSetting(
            pool,
            KEYS.STORE_EXEMPT_STATES,
            value,
            'Tax-exempt destination states for online shipping (CSV) — sales allowed, $0 tax'
        );
        await clearSetting(pool, LEGACY_KEYS.STORE_EXEMPT_STATES);
        if (isPrincipalStore) {
            await upsertSetting(
                pool,
                KEYS.HM_EXEMPT_STATES,
                value,
                'Tax-exempt destination states (CSV) — sales allowed, $0 tax'
            );
            await clearSetting(pool, LEGACY_KEYS.HM_EXEMPT_STATES);
        }
        saved.push(KEYS.STORE_EXEMPT_STATES);
    }

    if ('hmAccountantEmail' in updates || KEYS.STORE_ACCOUNTANT_EMAIL in updates) {
        const raw =
            updates.hmAccountantEmail != null ? updates.hmAccountantEmail : updates[KEYS.STORE_ACCOUNTANT_EMAIL];
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
        if (isPrincipalStore) {
            await upsertSetting(pool, KEYS.HM_ACCOUNTANT_EMAIL, value, 'Monthly online sales tax report recipient');
        }
        saved.push(KEYS.STORE_ACCOUNTANT_EMAIL);
    }

    const map = await loadSettingsMap(pool);
    await migrateLegacyExemptKeys(pool, map, { isPrincipalStore });

    return {
        saved,
        settings: await buildApiPayload(pool, { isPrincipalStore })
    };
}

module.exports = {
    KEYS,
    LEGACY_KEYS,
    loadSettingsMap,
    getAccountantEmail,
    buildApiPayload,
    saveTaxSettings,
    parseStateList,
    formatStateList
};
