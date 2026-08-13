'use strict';

/** Customer- and admin-facing labels for automated order lifecycle. */
const STATUS_LABELS = {
    pending: 'Order placed',
    processing: 'Processing — preparing your order',
    label_created: 'Shipping label created',
    shipped: 'Shipped',
    in_transit: 'In transit',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
};

const PAYMENT_LABELS = {
    pending: 'Payment pending',
    paid: 'Paid',
    failed: 'Payment failed',
    refunded: 'Refunded',
};

const FULFILLMENT_LABELS = {
    unfulfilled: 'Awaiting fulfillment',
    partial: 'Label created — awaiting carrier scan',
    fulfilled: 'Fulfilled',
};

function formatOrderStatus(status) {
    const key = String(status || '').toLowerCase();
    return STATUS_LABELS[key] || key.replace(/_/g, ' ');
}

function formatPaymentStatus(status) {
    const key = String(status || '').toLowerCase();
    return PAYMENT_LABELS[key] || key;
}

function formatFulfillmentStatus(status) {
    const key = String(status || '').toLowerCase();
    return FULFILLMENT_LABELS[key] || key;
}

/** Shippo / carrier tracking_status.status → our order.status */
function mapCarrierStatusToOrderStatus(carrierStatus, currentOrderStatus) {
    const s = String(carrierStatus || '').toUpperCase();
    const cur = String(currentOrderStatus || '').toLowerCase();

    if (s === 'DELIVERED') return 'delivered';
    if (s === 'TRANSIT' || s === 'IN_TRANSIT') {
        return cur === 'label_created' || cur === 'processing' ? 'shipped' : 'in_transit';
    }
    if (s === 'PRE_TRANSIT' || s === 'UNKNOWN') {
        return cur === 'processing' ? 'label_created' : cur;
    }
    if (s === 'RETURNED' || s === 'FAILURE') return cur;
    return null;
}

module.exports = {
    STATUS_LABELS,
    formatOrderStatus,
    formatPaymentStatus,
    formatFulfillmentStatus,
    mapCarrierStatusToOrderStatus,
};
