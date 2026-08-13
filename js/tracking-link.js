/**
 * Shared tracking link rendering for admin + customer UIs.
 */
(function (global) {
    'use strict';

    function isPlaceholderTracking(trackingNumber) {
        return /^HMTRK/i.test(String(trackingNumber || '').trim());
    }

    function inferCarrierFromTracking(trackingNumber) {
        const t = String(trackingNumber || '').trim().toUpperCase();
        if (!t || isPlaceholderTracking(t)) return '';
        if (t.startsWith('1Z')) return 'ups';
        if (/^(94|92|93|95|96)\d/.test(t)) return 'usps';
        if (/^\d{12,22}$/.test(t)) return 'fedex';
        if (t.startsWith('TBA')) return 'amazon';
        return '';
    }

    function resolveCarrier(order) {
        const carrier = String(order?.shipping_carrier || '').trim();
        if (carrier) return carrier;
        return inferCarrierFromTracking(order?.tracking_number);
    }

    function buildCarrierTrackingUrl(carrier, trackingNumber) {
        const num = String(trackingNumber || '').trim();
        if (!num || isPlaceholderTracking(num)) return null;
        const enc = encodeURIComponent(num);
        const c = String(carrier || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (c.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${enc}`;
        if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${enc}`;
        if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${enc}`;
        if (c.includes('dhl')) return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${enc}`;
        if (c.includes('ontrac')) return `https://www.ontrac.com/tracking/?number=${enc}`;
        if (c.includes('lasership')) return `https://www.lasership.com/track/${enc}`;
        return null;
    }

    function resolveTrackingUrl(order) {
        const stored = String(order?.tracking_url || '').trim();
        if (stored) return stored;
        const num = String(order?.tracking_number || '').trim();
        if (!num || isPlaceholderTracking(num)) return null;
        return buildCarrierTrackingUrl(resolveCarrier(order), num);
    }

    /**
     * @param {object} order — tracking_number, tracking_url, shipping_carrier
     * @param {function} esc — HTML escape
     * @param {{ linkStyle?: string, empty?: string }} [opts]
     */
    function renderTrackingLink(order, esc, opts = {}) {
        const empty = opts.empty != null ? opts.empty : '—';
        const num = String(order?.tracking_number || '').trim();
        if (!num || isPlaceholderTracking(num)) return empty;

        const url = resolveTrackingUrl(order);
        const style = opts.linkStyle || 'color:var(--primary-green,#047857);font-weight:600;text-decoration:underline;';
        if (url) {
            return `<a href="${esc(url)}" target="_blank" rel="noopener" style="${style}">${esc(num)}</a>`;
        }
        return `<code>${esc(num)}</code>`;
    }

    global.HMTrackingLink = {
        isPlaceholderTracking,
        resolveTrackingUrl,
        renderTrackingLink,
    };
})(typeof window !== 'undefined' ? window : globalThis);
