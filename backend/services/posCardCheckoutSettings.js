'use strict';

const integrationCredentials = require('./integrationCredentials');
const { loadPosPaymentProcessor } = require('./storePaymentProcessor');

const SETTING_POI_DEVICE_ID = 'pos_poi_device_id';
const SETTING_DISPLAY_MODE = 'pos_card_display_mode';
const SETTING_DISPLAY_CARD_CHECKOUT = 'pos_display_card_checkout';

const DEFAULTS = {
    poiDeviceId: '',
    displayMode: 'collect_js',
    displayCardCheckout: true
};

async function loadPosCardCheckoutSettings(pool) {
    if (pool) {
        try {
            await integrationCredentials.hydrateFromDatabase(pool);
        } catch {
            /* defaults */
        }
    }

    const posProcessor = pool ? await loadPosPaymentProcessor(pool) : 'epi';
    const deploymentMode =
        posProcessor === 'mxmerchant'
            ? integrationCredentials.getMxmerchantDeploymentMode()
            : posProcessor === 'nmi'
              ? integrationCredentials.getNmiDeploymentMode()
              : integrationCredentials.getEpiDeploymentMode();
    const displayMode = integrationCredentials.resolvePosCheckoutDisplayMode(posProcessor);
    const virtualTerminal = deploymentMode === 'virtual';
    const mxQuickPay = posProcessor === 'mxmerchant' && deploymentMode === 'quick_pay';

    const keys = [SETTING_POI_DEVICE_ID, SETTING_DISPLAY_CARD_CHECKOUT];
    const placeholders = keys.map(() => '?').join(', ');
    let map = new Map();
    if (pool) {
        try {
            const [rows] = await pool.execute(
                `SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`,
                keys
            );
            map = new Map((rows || []).map((r) => [r.key_name, r.value]));
        } catch {
            /* defaults */
        }
    }

    const poiDeviceId =
        String(integrationCredentials.getPosPoiDeviceId() || map.get(SETTING_POI_DEVICE_ID) || '').trim();
    const displayCardCheckoutRaw = map.get(SETTING_DISPLAY_CARD_CHECKOUT);
    const displayCardCheckout =
        displayCardCheckoutRaw == null || displayCardCheckoutRaw === ''
            ? true
            : String(displayCardCheckoutRaw).toLowerCase() === 'true';

    return {
        poiDeviceId,
        displayMode,
        rawDisplayMode: displayMode,
        deploymentMode,
        virtualTerminal,
        mxQuickPay,
        displayCardCheckout,
        nmiControlsTerminal: !virtualTerminal && !mxQuickPay && Boolean(poiDeviceId),
        posProcessor,
    };
}

module.exports = {
    SETTING_POI_DEVICE_ID,
    SETTING_DISPLAY_MODE,
    SETTING_DISPLAY_CARD_CHECKOUT,
    DEFAULTS,
    loadPosCardCheckoutSettings
};
