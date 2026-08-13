'use strict';

/** Internal placeholder IDs — not real carrier tracking numbers. */
function isPlaceholderTracking(trackingNumber) {
    return /^HMTRK/i.test(String(trackingNumber || '').trim());
}

function normalizeCarrier(carrier) {
    return String(carrier || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/** Guess carrier from tracking number when Shippo omits provider (common in sandbox). */
function inferCarrierFromTracking(trackingNumber) {
    const t = String(trackingNumber || '').trim().toUpperCase();
    if (!t || isPlaceholderTracking(t)) return '';
    if (t.startsWith('1Z')) return 'ups';
    if (/^(94|92|93|95|96)\d/.test(t)) return 'usps';
    if (/^\d{12,22}$/.test(t)) return 'fedex';
    if (t.startsWith('TBA')) return 'amazon';
    return '';
}

function resolveCarrier(orderOrCarrier, trackingNumber) {
    const fromField = typeof orderOrCarrier === 'object'
        ? orderOrCarrier?.shipping_carrier
        : orderOrCarrier;
    const carrier = String(fromField || '').trim();
    if (carrier) return carrier;
    const num = typeof orderOrCarrier === 'object'
        ? orderOrCarrier?.tracking_number
        : trackingNumber;
    return inferCarrierFromTracking(num);
}

/**
 * Build a carrier tracking page URL from carrier + tracking number.
 * @returns {string|null}
 */
function buildCarrierTrackingUrl(carrier, trackingNumber) {
    const num = String(trackingNumber || '').trim();
    if (!num || isPlaceholderTracking(num)) return null;

    const enc = encodeURIComponent(num);
    const c = normalizeCarrier(carrier);

    if (c.includes('usps')) {
        return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${enc}`;
    }
    if (c.includes('ups')) {
        return `https://www.ups.com/track?tracknum=${enc}`;
    }
    if (c.includes('fedex')) {
        return `https://www.fedex.com/fedextrack/?trknbr=${enc}`;
    }
    if (c.includes('dhl')) {
        return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${enc}`;
    }
    if (c.includes('ontrac')) {
        return `https://www.ontrac.com/tracking/?number=${enc}`;
    }
    if (c.includes('lasership')) {
        return `https://www.lasership.com/track/${enc}`;
    }
    if (c.includes('canadapost') || c.includes('canada_post')) {
        return `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${enc}`;
    }

    return null;
}

/**
 * Best tracking URL: stored Shippo/carrier URL, or built from carrier + number.
 * @returns {string|null}
 */
function resolveTrackingUrl(order) {
    const stored = String(order?.tracking_url || '').trim();
    if (stored) return stored;

    const num = String(order?.tracking_number || '').trim();
    if (!num || isPlaceholderTracking(num)) return null;

    return buildCarrierTrackingUrl(resolveCarrier(order, num), num);
}

/**
 * Normalize tracking fields for API responses and emails.
 */
function resolveTrackingInfo(order) {
    const rawNum = String(order?.tracking_number || '').trim();
    const isPlaceholder = isPlaceholderTracking(rawNum);
    const displayNumber = isPlaceholder ? null : rawNum || null;
    const url = displayNumber ? resolveTrackingUrl(order) : null;

    return {
        tracking_number: displayNumber,
        tracking_url: url,
        has_tracking: Boolean(displayNumber && url),
    };
}

/** Strip placeholder tracking and attach resolved carrier URL. */
function enrichOrderTracking(order) {
    if (!order || typeof order !== 'object') return order;
    const info = resolveTrackingInfo(order);
    const carrier = resolveCarrier(order, info.tracking_number);
    return {
        ...order,
        tracking_number: info.tracking_number,
        tracking_url: info.tracking_url,
        shipping_carrier: carrier || order.shipping_carrier || null,
    };
}

module.exports = {
    isPlaceholderTracking,
    inferCarrierFromTracking,
    resolveCarrier,
    buildCarrierTrackingUrl,
    resolveTrackingUrl,
    resolveTrackingInfo,
    enrichOrderTracking,
};
