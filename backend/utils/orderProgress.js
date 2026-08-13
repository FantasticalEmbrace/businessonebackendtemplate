'use strict';

const { formatOrderStatus, formatPaymentStatus } = require('./orderStatus');
const { resolveCarrier } = require('./trackingUrl');

const GREEN = '#047857';
const GRAY = '#d1d5db';
const TEXT = '#111827';
const MUTED = '#6b7280';

function buildOrderProgressSteps(order) {
    const st = String(order?.status || '').toLowerCase();
    return [
        { key: 'placed', label: 'Order placed', done: true, at: order?.created_at },
        {
            key: 'label',
            label: 'Shipping label created',
            done: !!(order?.label_created_at || order?.label_url),
            at: order?.label_created_at,
        },
        {
            key: 'shipped',
            label: 'Shipped',
            done: ['shipped', 'in_transit', 'delivered'].includes(st),
            at: order?.shipped_at,
        },
        {
            key: 'delivered',
            label: 'Delivered',
            done: st === 'delivered',
            at: order?.delivered_at,
        },
    ];
}

function stepDetailFor(order, step) {
    const st = String(order?.status || '').toLowerCase();
    const detail = String(order?.tracking_status_detail || '').trim();
    if (!detail || !step.done) return '';
    if (step.key === 'label' && st === 'label_created') return detail;
    if (step.key === 'shipped' && (st === 'shipped' || st === 'in_transit')) return detail;
    if (step.key === 'delivered' && st === 'delivered') return detail;
    return '';
}

function formatProgressDate(raw) {
    if (!raw) return '';
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
    });
}

/**
 * Email-safe order progress panel (table layout, inline styles).
 */
function renderOrderProgressEmailHtml(order, opts = {}) {
    const esc = opts.escapeHtml || ((s) => String(s || ''));
    const trackingNumber = opts.trackingNumber || order?.tracking_number || '';
    const trackingUrl = opts.trackingUrl || order?.tracking_url || '';
    const hasLabel = !!(order?.label_url || order?.label_created_at);
    const carrier = resolveCarrier(order, trackingNumber);
    const statusLabel = formatOrderStatus(order?.status);
    const paymentLabel = formatPaymentStatus(order?.payment_status);

    const trackingCell = trackingNumber
        ? (trackingUrl
            ? `<a href="${esc(trackingUrl)}" style="color:${GREEN};font-weight:600;text-decoration:none;">${esc(trackingNumber)}</a>`
            : esc(trackingNumber))
        : '—';

    const summaryCells = [
        `<td style="padding:0 8px 12px 0;vertical-align:top;width:25%;">
            <div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:0.04em;">Status</div>
            <div style="font-weight:600;color:${TEXT};">${esc(statusLabel)}</div>
        </td>`,
    ];

    if (hasLabel && carrier) {
        summaryCells.push(
            `<td style="padding:0 8px 12px 0;vertical-align:top;width:25%;">
                <div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:0.04em;">Carrier</div>
                <div style="color:${TEXT};">${esc(String(carrier).toUpperCase())}</div>
            </td>`
        );
    }

    summaryCells.push(
        `<td style="padding:0 8px 12px 0;vertical-align:top;width:25%;">
            <div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:0.04em;">Payment</div>
            <div style="color:${TEXT};">${esc(paymentLabel || '—')}</div>
        </td>`,
        `<td style="padding:0 0 12px 0;vertical-align:top;width:25%;">
            <div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:0.04em;">Tracking</div>
            <div style="color:${TEXT};">${trackingCell}</div>
        </td>`
    );

    const timelineRows = buildOrderProgressSteps(order).map((step) => {
        const dotColor = step.done ? GREEN : GRAY;
        const titleWeight = step.done ? '600' : '400';
        const titleColor = step.done ? TEXT : MUTED;
        const at = step.at ? formatProgressDate(step.at) : '';
        const detail = stepDetailFor(order, step);
        return `
            <tr>
                <td width="20" valign="top" style="padding:0 12px 10px 0;">
                    <div style="width:10px;height:10px;border-radius:50%;background:${dotColor};margin-top:4px;"></div>
                </td>
                <td valign="top" style="padding:0 0 10px 0;">
                    <div style="font-weight:${titleWeight};color:${titleColor};font-size:14px;">${esc(step.label)}</div>
                    ${at ? `<div style="font-size:12px;color:${MUTED};margin-top:2px;">${esc(at)}</div>` : ''}
                    ${detail ? `<div style="font-size:12px;color:${MUTED};margin-top:2px;">${esc(detail)}</div>` : ''}
                </td>
            </tr>`;
    }).join('');

    return `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
            <tr>
                <td style="padding:16px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                        <tr>${summaryCells.join('')}</tr>
                    </table>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #e5e7eb;padding-top:12px;margin-top:4px;">
                        ${timelineRows}
                    </table>
                    <p style="font-size:12px;color:${MUTED};margin:12px 0 0;line-height:1.5;">
                        Status and tracking update automatically when your package is scanned by the carrier.
                    </p>
                </td>
            </tr>
        </table>`;
}

module.exports = {
    buildOrderProgressSteps,
    stepDetailFor,
    formatProgressDate,
    renderOrderProgressEmailHtml,
};
