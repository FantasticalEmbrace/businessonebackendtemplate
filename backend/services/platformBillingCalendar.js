'use strict';

/**
 * Calendar-month billing — recurring charges align to the 1st of each month.
 * Signups mid-month pay a prorated amount for the remainder of the current month.
 */

function todayDateString(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function firstOfMonth(date = new Date()) {
    const d = date instanceof Date ? new Date(date) : new Date(date);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
}

function firstOfNextMonth(date = new Date()) {
    const d = date instanceof Date ? new Date(date) : new Date(date);
    d.setMonth(d.getMonth() + 1, 1);
    d.setHours(0, 0, 0, 0);
    return d;
}

function daysInMonth(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/**
 * Prorate a monthly amount from signupDate through the end of that calendar month (inclusive).
 */
function computeProration(monthlyAmount, signupDate = new Date()) {
    const amount = Math.max(0, Number(monthlyAmount) || 0);
    const d = signupDate instanceof Date ? signupDate : new Date(signupDate);
    const dim = daysInMonth(d);
    const dayOfMonth = d.getDate();
    const remainingDays = Math.max(1, dim - dayOfMonth + 1);
    const prorated = Math.round(((amount * remainingDays) / dim) * 100) / 100;
    const nextBill = firstOfNextMonth(d);

    return {
        monthlyAmount: amount,
        proratedAmount: prorated,
        remainingDays,
        daysInMonth: dim,
        dayOfMonth,
        nextBillDate: todayDateString(nextBill),
        summary:
            remainingDays === dim
                ? `Full month ($${amount.toFixed(2)}) — billing starts on the 1st`
                : `Prorated ${remainingDays}/${dim} days ($${prorated.toFixed(2)}) — then $${amount.toFixed(2)}/mo on the 1st`
    };
}

function describeBillingCycle(signupDate = new Date()) {
    const next = todayDateString(firstOfNextMonth(signupDate));
    return {
        billingAnchor: 'calendar_month',
        billingDay: 1,
        nextBillDate: next,
        note: 'Monthly subscriptions bill on the 1st of each month. Mid-month signups are prorated through the end of the current month.'
    };
}

module.exports = {
    todayDateString,
    firstOfMonth,
    firstOfNextMonth,
    daysInMonth,
    computeProration,
    describeBillingCycle
};
