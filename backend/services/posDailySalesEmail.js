'use strict';

const logger = require('../utils/logger');
const { sendMail, isSmtpConfigured } = require('../utils/mailTransporter');
const { loadPosOperationsSettings, SETTING_DAILY_EMAIL_LAST_SENT } = require('./posOperationsSettings');
const { getDaySalesSummary, localDateKey } = require('./posSalesReports');
const { loadPosStoreConfig } = require('./posStoreConfig');

function formatMoney(n) {
    return `$${(Number(n) || 0).toFixed(2)}`;
}

function buildEmailHtml(storeName, summary) {
    const t = summary.totals;
    const openNote =
        summary.openShiftCount > 0
            ? `<p style="color:#b45309;"><strong>${summary.openShiftCount} shift(s) still open</strong> — close them before end of day.</p>`
            : '';
    return `
<div style="font-family:system-ui,sans-serif;max-width:560px;color:#111">
  <h2 style="color:#1f82ff;margin:0 0 0.5rem">${storeName} — daily sales</h2>
  <p style="margin:0 0 1rem;color:#555">${summary.date}</p>
  <table style="width:100%;border-collapse:collapse;font-size:15px">
    <tr><td style="padding:0.35rem 0">Paid orders</td><td style="text-align:right">${t.orderCount}</td></tr>
    <tr><td style="padding:0.35rem 0">Merchandise subtotal</td><td style="text-align:right">${formatMoney(t.subtotal)}</td></tr>
    <tr><td style="padding:0.35rem 0">Tax</td><td style="text-align:right">${formatMoney(t.taxTotal)}</td></tr>
    <tr><td style="padding:0.35rem 0">Discounts</td><td style="text-align:right">−${formatMoney(t.discountTotal)}</td></tr>
    <tr><td style="padding:0.75rem 0 0.35rem;font-weight:700">Total sales</td><td style="text-align:right;font-weight:700">${formatMoney(t.totalSales)}</td></tr>
    <tr><td style="padding:0.35rem 0;color:#555">Cash</td><td style="text-align:right;color:#555">${formatMoney(t.cashTotal)}</td></tr>
    <tr><td style="padding:0.35rem 0;color:#555">Card</td><td style="text-align:right;color:#555">${formatMoney(t.cardTotal)}</td></tr>
    <tr><td style="padding:0.35rem 0;color:#555">Check</td><td style="text-align:right;color:#555">${formatMoney(t.checkTotal)}</td></tr>
    ${t.refundCount > 0 ? `<tr><td style="padding:0.35rem 0;color:#555">Refunds (${t.refundCount})</td><td style="text-align:right;color:#555">−${formatMoney(t.refundTotal)}</td></tr>` : ''}
  </table>
  ${openNote}
  <p style="margin:1.25rem 0 0;font-size:13px;color:#888">In-store POS sales from Business One. Sent automatically from your store server.</p>
</div>`;
}

async function sendDailySalesEmail(pool, { date, force = false } = {}) {
    if (!isSmtpConfigured()) {
        return { sent: false, reason: 'smtp_not_configured' };
    }

    const settings = await loadPosOperationsSettings(pool);
    if (!settings.dailySalesEmailEnabled && !force) {
        return { sent: false, reason: 'disabled' };
    }

    const to = String(settings.dailySalesEmailTo || '').trim();
    if (!to) {
        return { sent: false, reason: 'no_recipient' };
    }

    const summaryDate = date || localDateKey();
    if (!force && settings.dailySalesEmailLastSent === summaryDate) {
        return { sent: false, reason: 'already_sent', date: summaryDate };
    }

    const summary = await getDaySalesSummary(pool, summaryDate);
    const store = await loadPosStoreConfig(pool);
    const storeName = store.storeName || 'Store';
    const subject = `${storeName} — daily sales ${summaryDate}`;
    const html = buildEmailHtml(storeName, summary);
    const text =
        `${storeName} daily sales ${summaryDate}\n` +
        `Orders: ${summary.totals.orderCount}\n` +
        `Total: ${formatMoney(summary.totals.totalSales)}\n` +
        (summary.openShiftCount > 0 ? `Open shifts: ${summary.openShiftCount}\n` : '');

    await sendMail({ to, subject, html, text, logTag: 'POS daily sales email' });

    await pool.execute(
        `INSERT INTO settings (key_name, value, description, type) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [SETTING_DAILY_EMAIL_LAST_SENT, summaryDate, 'Last date daily POS sales email was sent', 'string']
    );

    logger.info('[pos-daily-sales] Email sent', { to, date: summaryDate });
    return { sent: true, to, date: summaryDate, summary };
}

module.exports = {
    sendDailySalesEmail,
    buildEmailHtml
};
