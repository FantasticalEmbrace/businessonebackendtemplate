'use strict';

const {
    isStoreDateTimeInFuture,
    normalizeDateYmd,
    getStoreTodayYmd,
} = require('./storeTimezone');

/**
 * Mark slot times unavailable when they are in the past (store timezone).
 */
function applyPastTimeFilter(dateYmd, slots) {
    const ymd = normalizeDateYmd(dateYmd);
    if (!ymd || !Array.isArray(slots)) return slots || [];

    return slots.map((slot) => {
        const time = String(slot.time || '').slice(0, 5);
        const stillFuture = isStoreDateTimeInFuture(ymd, time);
        return {
            ...slot,
            available: Boolean(slot.available) && stillFuture,
        };
    });
}

function isDateBeforeStoreToday(dateYmd) {
    const ymd = normalizeDateYmd(dateYmd);
    if (!ymd) return true;
    return ymd < getStoreTodayYmd();
}

function isDateBlocked(dateYmd, blockedSet) {
    const ymd = normalizeDateYmd(dateYmd);
    if (!ymd || !blockedSet) return false;
    return blockedSet.has(ymd);
}

function slotsForBlockedDay(slots) {
    return (slots || []).map((slot) => ({ ...slot, available: false }));
}

module.exports = {
    applyPastTimeFilter,
    isDateBeforeStoreToday,
    isDateBlocked,
    slotsForBlockedDay,
};
