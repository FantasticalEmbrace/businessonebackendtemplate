'use strict';

const logger = require('../utils/logger');
const {
    isPlatformHubSyncConfigured,
    getPlatformMerchantId,
    getPlatformHubUrl,
    getStoreBaseUrl,
    getPlatformHubSecret
} = require('../utils/platformSupportEnv');
const { loadPosStoreConfig } = require('./posStoreConfig');
const { loadMerchantLicense } = require('./posMerchantLicense');

const ONLINE_WINDOW_SEC = Math.max(30, Number(process.env.POS_SUPPORT_ONLINE_SECONDS) || 120);

async function resolveMerchantName(pool) {
    try {
        const license = await loadMerchantLicense(pool);
        if (license?.businessName) return license.businessName;
    } catch {
        /* ignore */
    }
    try {
        const { storeName } = await loadPosStoreConfig(pool);
        if (storeName) return storeName;
    } catch {
        /* ignore */
    }
    return getPlatformMerchantId();
}

async function loadDeviceContext(pool, deviceRecordId) {
    if (!deviceRecordId) return null;
    const [rows] = await pool.execute(
        `SELECT id, device_label, platform, last_seen_at FROM pos_devices WHERE id = ? LIMIT 1`,
        [deviceRecordId]
    );
    return rows[0] || null;
}

function isDeviceOnline(lastSeenAt) {
    if (!lastSeenAt) return false;
    const lastSeen = new Date(lastSeenAt);
    return Date.now() - lastSeen.getTime() <= ONLINE_WINDOW_SEC * 1000;
}

async function buildSyncPayload(pool, sessionRow, { claimedBy } = {}) {
    if (!sessionRow) return null;
    const device = await loadDeviceContext(pool, sessionRow.pos_device_id);
    const merchantName = await resolveMerchantName(pool);
    const storeBaseUrl = getStoreBaseUrl();
    if (!storeBaseUrl) {
        logger.warn('[platform-support] Sync skipped — set FRONTEND_URL or POS_PLATFORM_STORE_URL');
        return null;
    }

    return {
        merchantId: getPlatformMerchantId(),
        merchantName,
        storeBaseUrl,
        storeSessionId: sessionRow.id,
        storeDeviceId: sessionRow.pos_device_id,
        deviceLabel: device?.device_label || 'Register',
        platform: device?.platform || '',
        sessionCode: sessionRow.session_code,
        status: sessionRow.status,
        registerOnline: isDeviceOnline(device?.last_seen_at),
        claimedBy: claimedBy || null,
        sessionCreatedAt: sessionRow.created_at,
        expiresAt: sessionRow.expires_at
    };
}

async function syncSupportSession(pool, sessionId, options = {}) {
    if (!isPlatformHubSyncConfigured()) return;

    const registerSupport = require('./posRegisterSupport');
    let sessionRow = null;
    if (sessionId) {
        const [rows] = await pool.execute(
            `SELECT * FROM pos_register_support_sessions WHERE id = ? LIMIT 1`,
            [Number(sessionId)]
        );
        sessionRow = rows[0] || null;
    }

    const payload = sessionRow
        ? await buildSyncPayload(pool, sessionRow, options)
        : options.removePayload || null;

    if (!payload) return;

    const hubUrl = getPlatformHubUrl();
    try {
        const res = await fetch(`${hubUrl}/api/platform/support/hub/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Platform-Hub-Secret': getPlatformHubSecret()
            },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            logger.warn('[platform-support] Hub sync failed', {
                sessionId,
                status: res.status,
                body: text.slice(0, 200)
            });
        }
    } catch (e) {
        logger.warn('[platform-support] Hub sync error', { sessionId, message: e.message });
    }
}

function scheduleSupportSessionSync(pool, sessionId, options = {}) {
    if (!isPlatformHubSyncConfigured()) return;
    setImmediate(() => {
        syncSupportSession(pool, sessionId, options).catch(() => {});
    });
}

module.exports = {
    syncSupportSession,
    scheduleSupportSessionSync,
    buildSyncPayload,
    resolveMerchantName
};
