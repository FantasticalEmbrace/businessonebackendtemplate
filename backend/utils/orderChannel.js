'use strict';

const ONLINE_CHANNELS = new Set(['online', 'web', 'website', 'webstore']);
const IN_STORE_CHANNELS = new Set(['in_store', 'pos', 'store']);

function normalizeSalesChannel(value) {
    const raw = String(value || 'online').trim().toLowerCase();
    if (!raw) return 'online';
    if (IN_STORE_CHANNELS.has(raw)) return 'in_store';
    if (ONLINE_CHANNELS.has(raw)) return 'online';
    return raw;
}

function isOnlineOrderChannel(value) {
    return normalizeSalesChannel(value) === 'online';
}

function formatSalesChannelLabel(value) {
    const channel = normalizeSalesChannel(value);
    const labels = {
        online: 'Online',
        in_store: 'In-store',
        mobile: 'Mobile',
        phone: 'Phone',
        other: 'Other'
    };
    return labels[channel] || channel.replace(/_/g, ' ');
}

module.exports = {
    normalizeSalesChannel,
    isOnlineOrderChannel,
    formatSalesChannelLabel
};
