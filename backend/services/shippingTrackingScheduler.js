'use strict';

const logger = require('../utils/logger');
const { syncOrderTracking } = require('./shippoTracking');
const { isPlaceholderTracking } = require('../utils/trackingUrl');

/**
 * Poll Shippo for open labeled shipments so status + customer shipped emails
 * still update when the track_updated webhook is missing or delayed.
 */
function startShippingTrackingScheduler(pool) {
    const enabled = String(process.env.SHIPPING_TRACKING_POLL_ENABLED || 'true').trim().toLowerCase() !== 'false';
    if (!enabled) {
        logger.info('[shipping-tracking] Scheduler disabled');
        return () => {};
    }

    const intervalMs = Math.max(
        60_000,
        Number(process.env.SHIPPING_TRACKING_POLL_MS) || 10 * 60 * 1000
    );
    const batchSize = Math.min(50, Math.max(5, Number(process.env.SHIPPING_TRACKING_POLL_BATCH) || 25));
    let running = false;

    const tick = async (source = 'interval') => {
        if (running) return;
        running = true;
        try {
            const [rows] = await pool.execute(
                `SELECT id, tracking_number, status
                   FROM orders
                  WHERE payment_status = 'paid'
                    AND tracking_number IS NOT NULL
                    AND tracking_number != ''
                    AND status IN ('label_created', 'shipped', 'in_transit')
                  ORDER BY (tracking_status_updated_at IS NULL) DESC,
                           tracking_status_updated_at ASC,
                           id ASC
                  LIMIT ${batchSize}`
            );
            let updated = 0;
            for (const row of rows || []) {
                if (isPlaceholderTracking(row.tracking_number)) continue;
                try {
                    const result = await syncOrderTracking(pool, row.id);
                    if (result?.updated) updated += 1;
                } catch (e) {
                    logger.warn('[shipping-tracking] Sync failed', {
                        orderId: row.id,
                        message: e.message,
                    });
                }
            }
            if (updated > 0 || source === 'startup') {
                logger.info('[shipping-tracking] Poll complete', {
                    source,
                    checked: (rows || []).length,
                    updated,
                });
            }
        } catch (e) {
            logger.error('[shipping-tracking] Poll failed', { message: e.message, source });
        } finally {
            running = false;
        }
    };

    logger.info('[shipping-tracking] Scheduler enabled', { intervalMs, batchSize });
    const intervalId = setInterval(() => tick('interval'), intervalMs);
    setTimeout(() => tick('startup'), 45_000);
    return () => clearInterval(intervalId);
}

module.exports = { startShippingTrackingScheduler };
