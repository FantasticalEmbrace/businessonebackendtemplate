/**
 * Shared order progress timeline for customer account (and optional admin reuse).
 */
(function (global) {
    'use strict';

    const STATUS_LABELS = {
        pending: 'Order placed',
        processing: 'Processing',
        label_created: 'Shipping label created',
        shipped: 'Shipped',
        in_transit: 'In transit',
        delivered: 'Delivered',
        cancelled: 'Cancelled',
        refunded: 'Refunded',
    };

    const PAYMENT_LABELS = {
        pending: 'Pending',
        paid: 'Paid',
        failed: 'Failed',
        refunded: 'Refunded',
    };

    function formatOrderStatus(status) {
        const key = String(status || '').toLowerCase();
        return STATUS_LABELS[key] || key.replace(/_/g, ' ');
    }

    function formatPaymentStatus(status) {
        const key = String(status || '').toLowerCase();
        return PAYMENT_LABELS[key] || key || '—';
    }

    function defaultFormatDate(raw) {
        if (!raw) return '';
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
    }

    function buildSteps(order) {
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

    function stepDetail(order, step) {
        const st = String(order?.status || '').toLowerCase();
        const detail = String(order?.tracking_status_detail || '').trim();
        if (!detail || !step.done) return '';
        if (step.key === 'label' && st === 'label_created') return detail;
        if (step.key === 'shipped' && (st === 'shipped' || st === 'in_transit')) return detail;
        if (step.key === 'delivered' && st === 'delivered') return detail;
        return '';
    }

    /**
     * @param {object} order
     * @param {function} esc
     * @param {{ formatDate?: function, showPrintLabel?: boolean }} [opts]
     */
    function render(order, esc, opts = {}) {
        if (!order) return '';
        const formatDate = opts.formatDate || defaultFormatDate;
        const hasLabel = !!(order.label_url || order.label_created_at);
        const st = String(order.status || '').toLowerCase();

        let trackingHtml = '<span style="color:var(--gray-500,#6b7280);">—</span>';
        if (global.HMTrackingLink) {
            trackingHtml = global.HMTrackingLink.renderTrackingLink(order, esc, {
                empty: '<span style="color:var(--gray-500,#6b7280);">—</span>',
            });
        } else if (order.tracking_number) {
            trackingHtml = esc(order.tracking_number);
        }

        const gridCells = [
            `<div><div style="font-size:0.75rem;color:var(--gray-500,#6b7280);text-transform:uppercase;">Status</div><div style="font-weight:600;">${esc(formatOrderStatus(order.status))}</div></div>`,
        ];

        if (hasLabel && order.shipping_carrier) {
            gridCells.push(
                `<div><div style="font-size:0.75rem;color:var(--gray-500,#6b7280);text-transform:uppercase;">Carrier</div><div>${esc(order.shipping_carrier)}</div></div>`
            );
        }

        gridCells.push(
            `<div><div style="font-size:0.75rem;color:var(--gray-500,#6b7280);text-transform:uppercase;">Payment</div><div>${esc(formatPaymentStatus(order.payment_status))}</div></div>`,
            `<div><div style="font-size:0.75rem;color:var(--gray-500,#6b7280);text-transform:uppercase;">Tracking</div><div>${trackingHtml}</div></div>`
        );

        const timeline = buildSteps(order).map((step) => {
            const stepDetailText = stepDetail(order, step);
            return `
            <div style="display:flex;gap:0.75rem;align-items:flex-start;margin-bottom:0.5rem;">
                <span style="width:10px;height:10px;border-radius:50%;margin-top:0.35rem;flex-shrink:0;background:${step.done ? 'var(--primary-green,#047857)' : 'var(--gray-300,#d1d5db)'};"></span>
                <div>
                    <div style="font-weight:${step.done ? '600' : '400'};color:${step.done ? 'var(--gray-800,#1f2937)' : 'var(--gray-500,#6b7280)'};">${esc(step.label)}</div>
                    ${step.at ? `<div style="font-size:0.8rem;color:var(--gray-500,#6b7280);">${esc(formatDate(step.at))}</div>` : ''}
                    ${stepDetailText ? `<div style="font-size:0.8rem;color:var(--gray-600,#4b5563);margin-top:0.15rem;">${esc(stepDetailText)}</div>` : ''}
                </div>
            </div>`;
        }).join('');

        const waitingNote = !hasTrackingReady(order) && (st === 'processing' || st === 'pending')
            ? `<p style="font-size:0.85rem;color:var(--gray-600,#4b5563);margin:0 0 0.75rem;">Tracking will appear here once your order ships.</p>`
            : (!hasTrackingReady(order) && ['label_created', 'shipped', 'in_transit'].includes(st)
                ? `<p style="font-size:0.85rem;color:var(--gray-600,#4b5563);margin:0 0 0.75rem;">Your tracking number will appear here shortly.</p>`
                : '');

        return `
            <div style="margin-bottom:1rem;padding:1rem;background:var(--gray-50,#f9fafb);border:1px solid var(--gray-200,#e5e7eb);border-radius:8px;">
                ${waitingNote}
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:1rem;margin-bottom:1rem;">
                    ${gridCells.join('')}
                </div>
                <div style="border-top:1px solid var(--gray-200,#e5e7eb);padding-top:0.75rem;">${timeline}</div>
                <p style="font-size:0.8rem;color:var(--gray-500,#6b7280);margin:0.75rem 0 0;">Status and tracking update automatically when your package is scanned by the carrier.</p>
            </div>`;
    }

    function hasTrackingReady(order) {
        const num = String(order?.tracking_number || '').trim();
        return num && !/^HMTRK/i.test(num);
    }

    global.HMOrderProgress = {
        render,
        buildSteps,
        formatOrderStatus,
        formatPaymentStatus,
    };
})(typeof window !== 'undefined' ? window : globalThis);
