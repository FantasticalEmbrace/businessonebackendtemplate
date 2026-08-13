'use strict';

const logger = require('../utils/logger');

const ACTIVE_STATUSES = new Set(['pending', 'awaiting_consent', 'connecting', 'active']);
const STATUS_ORDER = { pending: 0, awaiting_consent: 1, connecting: 2, active: 3 };

function mapQueueRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        merchantId: row.merchant_id,
        merchantName: row.merchant_name,
        storeBaseUrl: row.store_base_url,
        storeSessionId: row.store_session_id,
        storeDeviceId: row.store_device_id,
        deviceLabel: row.device_label,
        platform: row.platform || '',
        sessionCode: row.session_code,
        status: row.status,
        registerOnline: Boolean(row.register_online),
        claimedBy: row.claimed_by || '',
        sessionCreatedAt: row.session_created_at,
        expiresAt: row.expires_at,
        syncedAt: row.synced_at
    };
}

async function upsertQueueEntry(pool, entry) {
    const status = String(entry.status || 'pending').toLowerCase();
    if (!ACTIVE_STATUSES.has(status)) {
        await pool.execute(
            `DELETE FROM pos_platform_support_queue WHERE merchant_id = ? AND store_session_id = ?`,
            [entry.merchantId, entry.storeSessionId]
        );
        return null;
    }

    await pool.execute(
        `INSERT INTO pos_platform_support_queue
         (merchant_id, merchant_name, store_base_url, store_session_id, store_device_id,
          device_label, platform, session_code, status, register_online, claimed_by,
          session_created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            merchant_name = VALUES(merchant_name),
            store_base_url = VALUES(store_base_url),
            store_device_id = VALUES(store_device_id),
            device_label = VALUES(device_label),
            platform = VALUES(platform),
            session_code = VALUES(session_code),
            status = VALUES(status),
            register_online = VALUES(register_online),
            claimed_by = COALESCE(VALUES(claimed_by), claimed_by),
            session_created_at = COALESCE(VALUES(session_created_at), session_created_at),
            expires_at = VALUES(expires_at),
            synced_at = CURRENT_TIMESTAMP`,
        [
            entry.merchantId,
            String(entry.merchantName || '').slice(0, 200),
            String(entry.storeBaseUrl || '').slice(0, 512),
            Number(entry.storeSessionId),
            Number(entry.storeDeviceId),
            String(entry.deviceLabel || '').slice(0, 64),
            entry.platform ? String(entry.platform).slice(0, 16) : null,
            String(entry.sessionCode || '').slice(0, 8),
            status,
            entry.registerOnline ? 1 : 0,
            entry.claimedBy ? String(entry.claimedBy).slice(0, 200) : null,
            entry.sessionCreatedAt || null,
            entry.expiresAt || null
        ]
    );

    const [rows] = await pool.execute(
        `SELECT * FROM pos_platform_support_queue
         WHERE merchant_id = ? AND store_session_id = ? LIMIT 1`,
        [entry.merchantId, entry.storeSessionId]
    );
    return mapQueueRow(rows[0]);
}

async function listSupportQueue(pool) {
    const [rows] = await pool.execute(
        `SELECT * FROM pos_platform_support_queue
         WHERE status IN ('pending', 'awaiting_consent', 'connecting', 'active')
           AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
         ORDER BY
           CASE status
             WHEN 'pending' THEN 0
             WHEN 'awaiting_consent' THEN 1
             WHEN 'connecting' THEN 2
             WHEN 'active' THEN 3
             ELSE 9
           END ASC,
           session_created_at ASC`
    );

    const waiting = [];
    const inProgress = [];
    for (const row of rows || []) {
        const item = mapQueueRow(row);
        if (item.status === 'pending') waiting.push(item);
        else inProgress.push(item);
    }

    return {
        waiting,
        inProgress,
        all: [...waiting, ...inProgress],
        counts: {
            waiting: waiting.length,
            inProgress: inProgress.length,
            total: (rows || []).length
        }
    };
}

async function purgeExpiredQueueEntries(pool) {
    const [result] = await pool.execute(
        `DELETE FROM pos_platform_support_queue
         WHERE status NOT IN ('pending', 'awaiting_consent', 'connecting', 'active')
            OR (expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP)`
    );
    if (result.affectedRows) {
        logger.info('[platform-support] Purged expired queue entries', { count: result.affectedRows });
    }
}

module.exports = {
    upsertQueueEntry,
    listSupportQueue,
    purgeExpiredQueueEntries,
    mapQueueRow,
    ACTIVE_STATUSES
};
