'use strict';

const METHODS = Object.freeze([
    { id: 'cash', settingKey: 'pos_payment_cash_enabled', defaultEnabled: true },
    { id: 'check', settingKey: 'pos_payment_check_enabled', defaultEnabled: true },
    { id: 'card_terminal', settingKey: 'pos_payment_card_enabled', defaultEnabled: true }
]);

const ALL_METHOD_IDS = METHODS.map((m) => m.id);

function parseBool(value, fallback = true) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    return fallback;
}

async function loadPosPaymentMethodsSettings(pool) {
    const keys = METHODS.map((m) => m.settingKey);
    let map = new Map();
    try {
        const placeholders = keys.map(() => '?').join(', ');
        const [rows] = await pool.execute(
            `SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`,
            keys
        );
        map = new Map((rows || []).map((r) => [r.key_name, r.value]));
    } catch {
        /* defaults */
    }

    const enabled = {};
    for (const m of METHODS) {
        enabled[m.id] = parseBool(map.get(m.settingKey), m.defaultEnabled);
    }
    const methods = ALL_METHOD_IDS.filter((id) => enabled[id]);
    return {
        enabled,
        methods: methods.length ? methods : ['cash'],
        cash: enabled.cash,
        check: enabled.check,
        card: enabled.card_terminal
    };
}

module.exports = {
    METHODS,
    ALL_METHOD_IDS,
    loadPosPaymentMethodsSettings
};
