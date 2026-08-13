'use strict';

/**
 * Developer-managed integration credentials stored in settings (cred_* keys).
 * Falls back to process.env when a DB value is unset.
 */

const REDACT_PLACEHOLDER = '[configured]';

const SECRET_KEYS = new Set([
    'cred_epi_public_tokenization_key',
    'cred_epi_private_api_key',
    'cred_nmi_public_tokenization_key',
    'cred_nmi_private_api_key',
    'cred_pos_nmi_public_tokenization_key',
    'cred_pos_nmi_private_api_key',
    'cred_mxmerchant_consumer_key',
    'cred_mxmerchant_consumer_secret',
    'cred_mxmerchant_username',
    'cred_mxmerchant_password',
    'cred_pos_mxmerchant_consumer_key',
    'cred_pos_mxmerchant_consumer_secret',
    'cred_pos_mxmerchant_username',
    'cred_pos_mxmerchant_password',
    'cred_shippo_api_token',
]);

const EXTRA_SETTING_KEYS = ['pos_poi_device_id', 'store_card_payment_processor', 'pos_card_payment_processor'];

function normalizeStoreProcessor(raw) {
    const id = String(raw || '').trim().toLowerCase();
    if (id === 'mxmerchant' || id === 'mx_merchant' || id === 'mx') return 'mxmerchant';
    // Accept legacy processor id from older installs
    if (id === 'nmi' || id === 'nmi_durango') return 'nmi';
    return 'epi';
}

const ALL_KEYS = [
    'cred_epi_deployment_mode',
    'cred_epi_public_tokenization_key',
    'cred_epi_private_api_key',
    'cred_epi_poi_device_id',
    'cred_nmi_deployment_mode',
    'cred_nmi_public_tokenization_key',
    'cred_nmi_private_api_key',
    'cred_nmi_sandbox',
    'cred_pos_nmi_public_tokenization_key',
    'cred_pos_nmi_private_api_key',
    'cred_pos_nmi_sandbox',
    'cred_pos_poi_device_id',
    'cred_mxmerchant_merchant_id',
    'cred_mxmerchant_auth_method',
    'cred_mxmerchant_consumer_key',
    'cred_mxmerchant_consumer_secret',
    'cred_mxmerchant_username',
    'cred_mxmerchant_password',
    'cred_mxmerchant_sandbox',
    'cred_mxmerchant_deployment_mode',
    'cred_mxmerchant_terminal_id',
    'cred_pos_mxmerchant_merchant_id',
    'cred_pos_mxmerchant_auth_method',
    'cred_pos_mxmerchant_consumer_key',
    'cred_pos_mxmerchant_consumer_secret',
    'cred_pos_mxmerchant_username',
    'cred_pos_mxmerchant_password',
    'cred_pos_mxmerchant_sandbox',
    'cred_shippo_api_token',
    'cred_shippo_test_mode',
    'cred_shippo_carriers',
    'cred_shippo_from_name',
    'cred_shippo_from_street1',
    'cred_shippo_from_street2',
    'cred_shippo_from_city',
    'cred_shippo_from_state',
    'cred_shippo_from_zip',
    'cred_shippo_from_phone',
    'cred_shippo_from_email',
];

const ENV_FALLBACKS = Object.freeze({
    cred_epi_public_tokenization_key: ['EPI_PUBLIC_TOKENIZATION_KEY', 'EPI_PUBLIC_KEY'],
    cred_epi_private_api_key: ['EPI_PRIVATE_API_KEY', 'EPI_API_KEY', 'EPI_SECURITY_KEY'],
    cred_epi_poi_device_id: [],
    cred_epi_deployment_mode: [],
    cred_nmi_deployment_mode: [],
    cred_nmi_public_tokenization_key: ['NMI_PUBLIC_TOKENIZATION_KEY', 'NMI_PUBLIC_KEY'],
    cred_nmi_private_api_key: ['NMI_PRIVATE_API_KEY', 'NMI_PRIVATE_KEY', 'NMI_API_KEY'],
    cred_nmi_sandbox: ['NMI_SANDBOX'],
    cred_pos_nmi_public_tokenization_key: ['POS_NMI_PUBLIC_TOKENIZATION_KEY', 'POS_NMI_PUBLIC_KEY'],
    cred_pos_nmi_private_api_key: ['POS_NMI_PRIVATE_API_KEY', 'POS_NMI_PRIVATE_KEY', 'POS_NMI_API_KEY'],
    cred_pos_nmi_sandbox: ['POS_NMI_SANDBOX'],
    cred_pos_poi_device_id: [],
    cred_mxmerchant_merchant_id: ['MXMERCHANT_MERCHANT_ID'],
    cred_mxmerchant_auth_method: ['MXMERCHANT_AUTH_METHOD'],
    cred_mxmerchant_consumer_key: ['MXMERCHANT_CONSUMER_KEY'],
    cred_mxmerchant_consumer_secret: ['MXMERCHANT_CONSUMER_SECRET'],
    cred_mxmerchant_username: ['MXMERCHANT_USERNAME'],
    cred_mxmerchant_password: ['MXMERCHANT_PASSWORD'],
    cred_mxmerchant_sandbox: ['MXMERCHANT_SANDBOX'],
    cred_mxmerchant_deployment_mode: [],
    cred_mxmerchant_terminal_id: ['MXMERCHANT_TERMINAL_ID', 'POS_MXMERCHANT_TERMINAL_ID'],
    cred_pos_mxmerchant_merchant_id: ['POS_MXMERCHANT_MERCHANT_ID'],
    cred_pos_mxmerchant_auth_method: ['POS_MXMERCHANT_AUTH_METHOD'],
    cred_pos_mxmerchant_consumer_key: ['POS_MXMERCHANT_CONSUMER_KEY'],
    cred_pos_mxmerchant_consumer_secret: ['POS_MXMERCHANT_CONSUMER_SECRET'],
    cred_pos_mxmerchant_username: ['POS_MXMERCHANT_USERNAME'],
    cred_pos_mxmerchant_password: ['POS_MXMERCHANT_PASSWORD'],
    cred_pos_mxmerchant_sandbox: ['POS_MXMERCHANT_SANDBOX'],
    cred_shippo_api_token: ['SHIPPO_API_TOKEN'],
    cred_shippo_test_mode: ['SHIPPO_TEST_MODE'],
    cred_shippo_carriers: ['SHIPPO_CARRIERS'],
    cred_shippo_from_name: ['SHIPPO_FROM_NAME', 'STORE_NAME'],
    cred_shippo_from_street1: ['SHIPPO_FROM_STREET1'],
    cred_shippo_from_street2: ['SHIPPO_FROM_STREET2'],
    cred_shippo_from_city: ['SHIPPO_FROM_CITY'],
    cred_shippo_from_state: ['SHIPPO_FROM_STATE'],
    cred_shippo_from_zip: ['SHIPPO_FROM_ZIP'],
    cred_shippo_from_phone: ['SHIPPO_FROM_PHONE'],
    cred_shippo_from_email: ['SHIPPO_FROM_EMAIL', 'SMTP_FROM'],
});

/** @type {Record<string, string>} */
let cache = {};

function trim(v) {
    return v != null ? String(v).trim() : '';
}

function firstEnv(keys) {
    for (const key of keys || []) {
        const v = trim(process.env[key]);
        if (v) return v;
    }
    return '';
}

function resolve(key) {
    const db = trim(cache[key]);
    if (db) return db;
    return firstEnv(ENV_FALLBACKS[key]);
}

function isTruthyFlag(raw) {
    const s = trim(raw).toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
}

function isSecretPlaceholder(value) {
    const v = trim(value);
    if (!v) return true;
    if (v === '••••••••' || v === '********') return true;
    return v === REDACT_PLACEHOLDER || v.startsWith(REDACT_PLACEHOLDER);
}

async function hydrateFromDatabase(pool) {
    if (!pool) {
        cache = {};
        return;
    }
    const queryKeys = [...ALL_KEYS, ...EXTRA_SETTING_KEYS];
    const placeholders = queryKeys.map(() => '?').join(', ');
    const [rows] = await pool.execute(
        `SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`,
        queryKeys
    );
    const next = {};
    for (const row of rows || []) {
        next[row.key_name] = row.value != null ? String(row.value) : '';
    }
    if (!trim(next.cred_pos_poi_device_id) && trim(next.pos_poi_device_id)) {
        next.cred_pos_poi_device_id = trim(next.pos_poi_device_id);
    }
    cache = next;
}

function getStoreProcessor() {
    return normalizeStoreProcessor(cache.store_card_payment_processor);
}

function getPosProcessorSetting() {
    const raw = String(cache.pos_card_payment_processor || 'inherit').trim().toLowerCase();
    if (raw && raw !== 'inherit') return normalizeStoreProcessor(raw);
    return 'inherit';
}

function getNmiDeploymentMode() {
    const raw = resolve('cred_nmi_deployment_mode');
    return raw === 'physical' ? 'physical' : 'virtual';
}

function normalizeMxmerchantDeploymentMode(raw) {
    const mode = String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/-/g, '_');
    if (mode === 'physical') return 'physical';
    if (mode === 'quick_pay' || mode === 'quickpay') return 'quick_pay';
    return 'virtual';
}

function getMxmerchantDeploymentMode() {
    return normalizeMxmerchantDeploymentMode(resolve('cred_mxmerchant_deployment_mode'));
}

function getEpiDeploymentMode() {
    const raw = resolve('cred_epi_deployment_mode');
    return raw === 'physical' ? 'physical' : 'virtual';
}

function resolvePosCheckoutDisplayMode(processorId) {
    const processor = normalizeStoreProcessor(processorId || getStoreProcessor());
    if (processor === 'mxmerchant') {
        const mode = getMxmerchantDeploymentMode();
        if (mode === 'physical') return 'mx_terminal';
        if (mode === 'quick_pay') return 'mx_quick_pay';
        return 'mx_virtual';
    }
    if (processor === 'nmi') {
        return getNmiDeploymentMode() === 'physical' ? 'nmi_terminal' : 'collect_js';
    }
    return getEpiDeploymentMode() === 'physical' ? 'nmi_terminal' : 'collect_js';
}

function resolveMxmerchantAuth(scope = 'website') {
    const prefix = scope === 'pos' ? 'cred_pos_mxmerchant_' : 'cred_mxmerchant_';
    const method = resolve(`${prefix}auth_method`) || resolve('cred_mxmerchant_auth_method') || 'consumer';
    const authMethod = String(method).toLowerCase() === 'username' ? 'username' : 'consumer';
    return {
        authMethod,
        merchantId: resolve(`${prefix}merchant_id`) || resolve('cred_mxmerchant_merchant_id'),
        consumerKey: resolve(`${prefix}consumer_key`) || resolve('cred_mxmerchant_consumer_key'),
        consumerSecret: resolve(`${prefix}consumer_secret`) || resolve('cred_mxmerchant_consumer_secret'),
        username: resolve(`${prefix}username`) || resolve('cred_mxmerchant_username'),
        password: resolve(`${prefix}password`) || resolve('cred_mxmerchant_password'),
        terminalId:
            resolve('cred_pos_mxmerchant_terminal_id') ||
            resolve('cred_mxmerchant_terminal_id') ||
            trim(process.env.POS_MXMERCHANT_TERMINAL_ID) ||
            trim(process.env.MXMERCHANT_TERMINAL_ID),
    };
}

function getMxmerchantCredentials(scope = 'website') {
    const auth = resolveMxmerchantAuth(scope);
    const hasAuth =
        auth.authMethod === 'username'
            ? Boolean(auth.username && auth.password)
            : Boolean(auth.consumerKey && auth.consumerSecret);
    return {
        ...auth,
        merchantId: String(auth.merchantId || '').trim(),
        hasAuth,
        sandbox: scope === 'pos' ? getPosMxmerchantSandbox() : isMxmerchantSandbox(),
    };
}

function isMxmerchantSandbox() {
    const raw = resolve('cred_mxmerchant_sandbox');
    if (raw) return isTruthyFlag(raw);
    const envRaw = process.env.MXMERCHANT_SANDBOX;
    if (envRaw !== undefined && trim(envRaw) !== '') return isTruthyFlag(envRaw);
    return true;
}

function getPosMxmerchantSandbox() {
    const raw = resolve('cred_pos_mxmerchant_sandbox');
    if (raw) return isTruthyFlag(raw);
    const envRaw = process.env.POS_MXMERCHANT_SANDBOX;
    if (envRaw !== undefined && trim(envRaw) !== '') return isTruthyFlag(envRaw);
    return isMxmerchantSandbox();
}

function maskSecret(value) {
    const v = trim(value);
    if (!v) return '';
    if (v.length <= 4) return REDACT_PLACEHOLDER;
    return `${REDACT_PLACEHOLDER} (…${v.slice(-4)})`;
}

function buildApiPayload() {
    const fields = {};
    for (const key of ALL_KEYS) {
        const resolved = resolve(key);
        if (SECRET_KEYS.has(key)) {
            fields[key] = resolved ? maskSecret(resolved) : '';
        } else {
            fields[key] = resolved;
        }
    }

    const epiPublic = resolve('cred_epi_public_tokenization_key');
    const epiPrivate = resolve('cred_epi_private_api_key');
    const nmiPublic = resolve('cred_nmi_public_tokenization_key');
    const nmiPrivate = resolve('cred_nmi_private_api_key');
    const posPublic = resolve('cred_pos_nmi_public_tokenization_key');
    const posPrivate = resolve('cred_pos_nmi_private_api_key');
    const shippoToken = resolve('cred_shippo_api_token');
    const shippoOrigin = resolve('cred_shippo_from_street1');
    const mxWebsite = getMxmerchantCredentials('website');
    const mxPos = getMxmerchantCredentials('pos');

    return {
        fields,
        storeProcessor: getStoreProcessor(),
        posProcessor: getPosProcessorSetting(),
        status: {
            epi: {
                configured: Boolean(epiPublic && epiPrivate),
                deploymentMode: resolve('cred_epi_deployment_mode') || 'virtual',
            },
            nmi: {
                websiteConfigured: Boolean(nmiPublic && nmiPrivate),
                posConfigured: Boolean(posPublic && posPrivate),
                deploymentMode: resolve('cred_nmi_deployment_mode') || 'virtual',
                posCheckoutMode: resolvePosCheckoutDisplayMode('nmi'),
                poiDeviceId: resolve('cred_pos_poi_device_id') || resolve('cred_epi_poi_device_id') || '',
            },
            mxmerchant: {
                websiteConfigured: Boolean(mxWebsite.merchantId && mxWebsite.hasAuth),
                posConfigured: Boolean(mxPos.merchantId && mxPos.hasAuth),
                deploymentMode: resolve('cred_mxmerchant_deployment_mode') || 'virtual',
                posCheckoutMode: resolvePosCheckoutDisplayMode('mxmerchant'),
                terminalId: resolve('cred_mxmerchant_terminal_id') || '',
            },
            shippo: {
                configured: Boolean(shippoToken),
                originConfigured: Boolean(
                    shippoOrigin && resolve('cred_shippo_from_city') && resolve('cred_shippo_from_state')
                ),
                carriers: String(resolve('cred_shippo_carriers') || process.env.SHIPPO_CARRIERS || 'usps,ups,fedex')
                    .split(',')
                    .map((c) => c.trim().toLowerCase())
                    .filter(Boolean),
                originPhoneConfigured: String(resolve('cred_shippo_from_phone') || '').replace(/\D/g, '').length >= 10,
            },
        },
    };
}

async function upsertSetting(pool, key, value, type = 'string') {
    await pool.execute(
        `INSERT INTO settings (key_name, value, description, type)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value), type = VALUES(type)`,
        [key, value, `Integration credential: ${key}`, type]
    );
}

async function saveCredentials(pool, updates = {}) {
    if (!pool) throw new Error('Database not available');

    const saved = [];
    for (const key of ALL_KEYS) {
        if (!(key in updates)) continue;
        let value = trim(updates[key]);

        if (SECRET_KEYS.has(key) && isSecretPlaceholder(value)) {
            continue;
        }

        if (key === 'cred_epi_deployment_mode' || key === 'cred_nmi_deployment_mode') {
            value = value === 'physical' ? 'physical' : 'virtual';
        }
        if (key === 'cred_mxmerchant_deployment_mode') {
            value = normalizeMxmerchantDeploymentMode(value);
        }

        if (key === 'cred_mxmerchant_auth_method' || key === 'cred_pos_mxmerchant_auth_method') {
            value = String(value).toLowerCase() === 'username' ? 'username' : 'consumer';
        }

        if (key === 'cred_nmi_sandbox' || key === 'cred_pos_nmi_sandbox' || key === 'cred_shippo_test_mode' || key === 'cred_mxmerchant_sandbox' || key === 'cred_pos_mxmerchant_sandbox') {
            value = isTruthyFlag(value) ? 'true' : 'false';
        }

        await upsertSetting(pool, key, value);
        cache[key] = value;
        saved.push(key);
    }

    if ('cred_pos_poi_device_id' in updates && !isSecretPlaceholder(updates.cred_pos_poi_device_id)) {
        const poi = trim(updates.cred_pos_poi_device_id);
        await upsertSetting(pool, 'pos_poi_device_id', poi, 'string');
        cache.pos_poi_device_id = poi;
    }

    if ('store_card_payment_processor' in updates) {
        const processor = normalizeStoreProcessor(updates.store_card_payment_processor);
        await upsertSetting(
            pool,
            'store_card_payment_processor',
            processor,
            'string'
        );
        cache.store_card_payment_processor = processor;
        saved.push('store_card_payment_processor');
    }

    if ('pos_card_payment_processor' in updates) {
        const raw = String(updates.pos_card_payment_processor || 'inherit').trim().toLowerCase();
        const value = raw === 'inherit' ? 'inherit' : normalizeStoreProcessor(raw);
        await upsertSetting(pool, 'pos_card_payment_processor', value, 'string');
        cache.pos_card_payment_processor = value;
        saved.push('pos_card_payment_processor');
    }

    if ('cred_nmi_deployment_mode' in updates) {
        const mode = trim(updates.cred_nmi_deployment_mode) === 'physical' ? 'physical' : 'virtual';
        const displayMode = mode === 'physical' ? 'nmi_terminal' : 'collect_js';
        await upsertSetting(pool, 'pos_card_display_mode', displayMode, 'string');
        saved.push('pos_card_display_mode');
    }

    if ('cred_mxmerchant_deployment_mode' in updates) {
        const mode = normalizeMxmerchantDeploymentMode(updates.cred_mxmerchant_deployment_mode);
        const displayMode =
            mode === 'physical' ? 'mx_terminal' : mode === 'quick_pay' ? 'mx_quick_pay' : 'mx_virtual';
        await upsertSetting(pool, 'pos_card_display_mode', displayMode, 'string');
        saved.push('pos_card_display_mode');
    }

    return { saved, payload: buildApiPayload() };
}

function getEpiPublicTokenizationKey() {
    return resolve('cred_epi_public_tokenization_key');
}

function getEpiPrivateApiKey() {
    return resolve('cred_epi_private_api_key');
}

function getNmiPublicTokenizationKey() {
    return resolve('cred_nmi_public_tokenization_key');
}

function getNmiPrivateApiKey() {
    return resolve('cred_nmi_private_api_key');
}

function getPosNmiPublicTokenizationKey() {
    return resolve('cred_pos_nmi_public_tokenization_key');
}

function getPosNmiPrivateApiKey() {
    return resolve('cred_pos_nmi_private_api_key');
}

function isNmiSandboxHint() {
    const raw = resolve('cred_nmi_sandbox');
    if (raw) return isTruthyFlag(raw);
    return isTruthyFlag(process.env.NMI_SANDBOX);
}

function isPosNmiSandboxHint() {
    const raw = resolve('cred_pos_nmi_sandbox');
    if (raw) return isTruthyFlag(raw);
    const envRaw = process.env.POS_NMI_SANDBOX;
    if (envRaw !== undefined && trim(envRaw) !== '') {
        return isTruthyFlag(envRaw);
    }
    return isNmiSandboxHint();
}

function getShippoApiToken() {
    return resolve('cred_shippo_api_token');
}

function isShippoTestMode() {
    const raw = resolve('cred_shippo_test_mode');
    if (raw) return isTruthyFlag(raw);
    return trim(process.env.SHIPPO_TEST_MODE || 'true').toLowerCase() !== 'false';
}

function getShippoStoreOrigin() {
    return {
        name: resolve('cred_shippo_from_name') || 'H&M Herbs & Vitamins',
        company: resolve('cred_shippo_from_name') || 'H&M Herbs & Vitamins',
        street1: resolve('cred_shippo_from_street1'),
        street2: resolve('cred_shippo_from_street2'),
        city: resolve('cred_shippo_from_city'),
        state: resolve('cred_shippo_from_state'),
        zip: resolve('cred_shippo_from_zip'),
        country: 'US',
        phone: resolve('cred_shippo_from_phone'),
        email: resolve('cred_shippo_from_email'),
    };
}

function getShippoCarrierFilter() {
    const raw =
        resolve('cred_shippo_carriers') ||
        String(process.env.SHIPPO_CARRIERS || 'usps,ups,fedex');
    return new Set(
        raw
            .split(',')
            .map((c) => c.trim().toLowerCase())
            .filter(Boolean)
    );
}

function getPosPoiDeviceId() {
    return resolve('cred_pos_poi_device_id') || trim(cache.pos_poi_device_id) || firstEnv(['POS_POI_DEVICE_ID']);
}

module.exports = {
    REDACT_PLACEHOLDER,
    SECRET_KEYS,
    ALL_KEYS,
    hydrateFromDatabase,
    buildApiPayload,
    saveCredentials,
    getEpiPublicTokenizationKey,
    getEpiPrivateApiKey,
    getNmiPublicTokenizationKey,
    getNmiPrivateApiKey,
    getPosNmiPublicTokenizationKey,
    getPosNmiPrivateApiKey,
    isNmiSandboxHint,
    isPosNmiSandboxHint,
    getShippoApiToken,
    isShippoTestMode,
    getShippoStoreOrigin,
    getShippoCarrierFilter,
    getPosPoiDeviceId,
    getStoreProcessor,
    getNmiDeploymentMode,
    getMxmerchantDeploymentMode,
    normalizeMxmerchantDeploymentMode,
    getEpiDeploymentMode,
    resolvePosCheckoutDisplayMode,
    getMxmerchantCredentials,
    isMxmerchantSandbox,
    getPosMxmerchantSandbox,
    normalizeStoreProcessor,
};
