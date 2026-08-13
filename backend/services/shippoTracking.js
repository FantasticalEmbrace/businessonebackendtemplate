'use strict';

const shippo = require('./shippoClient');
const logger = require('../utils/logger');
const { mapCarrierStatusToOrderStatus } = require('../utils/orderStatus');
const { buildCarrierTrackingUrl, inferCarrierFromTracking } = require('../utils/trackingUrl');
const { sendShippedNotificationEmail } = require('./shippedNotificationEmail');

function normalizeCarrier(carrier) {
    return String(carrier || '').trim().toLowerCase();
}

async function registerTrack(carrier, trackingNumber) {
    if (!shippo.isConfigured() || !trackingNumber) return null;
    try {
        const res = await shippo.client().post('/tracks/', {
            carrier: normalizeCarrier(carrier),
            tracking_number: String(trackingNumber).trim(),
        });
        return res.data;
    } catch (e) {
        logger.warn(`Shippo track register failed: ${e.message}`);
        return null;
    }
}

async function fetchTrack(carrier, trackingNumber) {
    if (!shippo.isConfigured() || !trackingNumber || !carrier) return null;
    const c = normalizeCarrier(carrier);
    const tn = encodeURIComponent(String(trackingNumber).trim());
    try {
        const res = await shippo.client().get(`/tracks/${c}/${tn}`);
        return res.data;
    } catch (e) {
        logger.warn(`Shippo track fetch failed: ${e.message}`);
        return null;
    }
}

/**
 * Advance order status from Shippo tracking data. Returns true if order row changed.
 */
async function applyTrackingToOrder(pool, orderRow, trackData) {
    if (!orderRow || !trackData) return false;

    const ts = trackData.tracking_status || trackData;
    const carrierStatus = ts.status || trackData.status;
    const statusDetails = ts.status_details || ts.substatus?.text || '';
    const statusDate = ts.status_date || null;

    const newStatus = mapCarrierStatusToOrderStatus(carrierStatus, orderRow.status);
    if (!newStatus) return false;

    const cur = String(orderRow.status || '').toLowerCase();
    const updates = [];
    const params = [];

    if (newStatus !== cur) {
        updates.push('status = ?');
        params.push(newStatus);

        if (newStatus === 'shipped' && !orderRow.shipped_at) {
            updates.push('shipped_at = COALESCE(shipped_at, NOW())');
        }
        if (newStatus === 'delivered' && !orderRow.delivered_at) {
            updates.push('delivered_at = COALESCE(delivered_at, NOW())');
        }
        if (newStatus === 'shipped' || newStatus === 'in_transit' || newStatus === 'delivered') {
            updates.push("fulfillment_status = 'fulfilled'");
        }
    }

    if (statusDetails) {
        updates.push('tracking_status_detail = ?');
        params.push(String(statusDetails).slice(0, 500));
    }
    if (carrierStatus) {
        updates.push('tracking_status = ?');
        params.push(String(carrierStatus).slice(0, 64));
    }
    if (statusDate) {
        updates.push('tracking_status_updated_at = ?');
        params.push(statusDate);
    }

    const trackingUrl =
        trackData.tracking_url_provider ||
        ts.tracking_url_provider ||
        buildCarrierTrackingUrl(orderRow.shipping_carrier || inferCarrierFromTracking(orderRow.tracking_number), orderRow.tracking_number);
    if (trackingUrl && !orderRow.tracking_url) {
        updates.push('tracking_url = ?');
        params.push(String(trackingUrl).slice(0, 500));
    }

    if (!updates.length) return false;

    params.push(orderRow.id);
    await pool.execute(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`, params);

    const shouldSendShippedEmail =
        (newStatus === 'shipped' || newStatus === 'in_transit') &&
        !orderRow.shipped_email_sent &&
        String(orderRow.payment_status || '').toLowerCase() === 'paid';

    if (shouldSendShippedEmail) {
        await pool.execute('UPDATE orders SET shipped_email_sent = 1 WHERE id = ?', [orderRow.id]);
        void sendShippedNotificationEmail(pool, orderRow.id).catch((err) => {
            logger.error(`Shipped email failed for order ${orderRow.id}:`, err);
        });
    }

    return true;
}

async function syncOrderTracking(pool, orderId) {
    const [rows] = await pool.execute(
        `SELECT id, status, payment_status, tracking_number, tracking_url, shipping_carrier,
                shipped_at, delivered_at, shipped_email_sent, label_url
         FROM orders WHERE id = ? LIMIT 1`,
        [orderId]
    );
    if (!rows.length) return { updated: false };
    const order = rows[0];
    if (!order.tracking_number) {
        return { updated: false, reason: 'no_tracking' };
    }
    const carrier = order.shipping_carrier || inferCarrierFromTracking(order.tracking_number);
    if (!carrier) {
        return { updated: false, reason: 'no_carrier' };
    }

    const trackData = await fetchTrack(carrier, order.tracking_number);
    if (!trackData) return { updated: false, reason: 'fetch_failed' };

    const updated = await applyTrackingToOrder(pool, order, trackData);
    return { updated, tracking_status: trackData.tracking_status?.status || null };
}

async function handleTrackWebhook(pool, payload) {
    const data = payload?.data || payload;
    const trackingNumber = data?.tracking_number || data?.tracking_status?.tracking_number;
    const carrier = data?.carrier || data?.tracking_status?.carrier;
    if (!trackingNumber) return { ok: false, reason: 'no_tracking_number' };

    const [orders] = await pool.execute(
        `SELECT id, status, payment_status, tracking_number, tracking_url, shipping_carrier,
                shipped_at, delivered_at, shipped_email_sent, label_url
         FROM orders WHERE tracking_number = ? LIMIT 1`,
        [String(trackingNumber).trim()]
    );
    if (!orders.length) return { ok: false, reason: 'order_not_found' };

    const updated = await applyTrackingToOrder(pool, orders[0], data);
    return { ok: true, updated, orderId: orders[0].id };
}

module.exports = {
    registerTrack,
    fetchTrack,
    applyTrackingToOrder,
    syncOrderTracking,
    handleTrackWebhook,
};
