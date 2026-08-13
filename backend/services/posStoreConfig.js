'use strict';

const SETTING_STORE_NAME = 'store_name';
const SETTING_STORE_LOGO = 'pos_store_logo_url';

async function loadPosStoreConfig(pool) {
    let storeName = String(process.env.POS_STORE_NAME || '').trim();
    let storeLogoUrl = null;

    try {
        const [rows] = await pool.execute(
            `SELECT key_name, value FROM settings WHERE key_name IN (?, ?)`,
            [SETTING_STORE_NAME, SETTING_STORE_LOGO]
        );
        const map = new Map((rows || []).map((r) => [r.key_name, r.value]));
        const fromSettings = String(map.get(SETTING_STORE_NAME) || '').trim();
        if (fromSettings) storeName = fromSettings;
        const logo = String(map.get(SETTING_STORE_LOGO) || '').trim();
        if (logo) storeLogoUrl = logo;
    } catch {
        /* env fallback only */
    }

    if (!storeName) storeName = 'Store';

    return { storeName, storeLogoUrl };
}

module.exports = {
    SETTING_STORE_LOGO,
    loadPosStoreConfig
};
