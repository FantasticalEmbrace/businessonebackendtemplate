'use strict';

const logger = require('../utils/logger');
const { sendMail, isSmtpConfigured } = require('../utils/mailTransporter');
const { loadPosStoreConfig } = require('./posStoreConfig');

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatMoney(value) {
    return `$${(Number(value) || 0).toFixed(2)}`;
}

function buildShiftReportHtml(report, storeName) {
    const s = report.shift || {};
    const title = report.title || (report.reportType === 'z' ? 'End-of-shift summary' : 'Shift report');
    const statusLine =
        report.isFinal || report.reportType === 'z'
            ? 'Shift closed — final totals'
            : 'Shift still open — totals may change';
    const salesHtml = (report.sales || [])
        .map(
            (o) =>
                `<tr><td style="padding:0.25rem 0">${escapeHtml(o.order_number)}</td>` +
                `<td style="padding:0.25rem 0;text-align:right">${formatMoney(o.total_amount)}</td>` +
                `<td style="padding:0.25rem 0;color:#555">${escapeHtml(o.payment_method || '')}</td></tr>`
        )
        .join('');
    const employeeName =
        s.employeeName || `${s.first_name || ''} ${s.last_name || ''}`.trim() || '—';
    const openedAt = s.openedAt || s.opened_at;
    const closedAt = s.closedAt || s.closed_at;
    const openingCash = Number(s.openingCash ?? s.opening_cash ?? 0);
    const expectedCash = Number(s.expectedCash ?? s.expected_cash ?? 0);
    const closingCash = s.closingCash ?? s.closing_cash;
    const overShort = s.overShortAmount ?? s.over_short_amount;

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:system-ui,sans-serif;color:#111;padding:24px;max-width:640px;margin:0 auto">
<h1 style="color:#1f82ff;font-size:1.35rem;margin:0 0 0.35rem">${escapeHtml(storeName)}</h1>
<h2 style="font-size:1.1rem;margin:0 0 0.75rem">${escapeHtml(title)}</h2>
<p style="font-weight:600;margin:0 0 1rem">${escapeHtml(statusLine)}</p>
<p style="margin:0 0 0.5rem"><strong>${escapeHtml(employeeName)}</strong>${s.employeeCode || s.employee_code ? ` (${escapeHtml(s.employeeCode || s.employee_code)})` : ''}</p>
<p style="margin:0 0 1rem;color:#444">Opened: ${openedAt ? new Date(openedAt).toLocaleString() : '—'}<br>
Closed: ${closedAt ? new Date(closedAt).toLocaleString() : '—'}</p>
<table style="width:100%;border-collapse:collapse;font-size:15px;margin:0 0 1rem">
<tr><td style="padding:0.35rem 0">Opening cash</td><td style="text-align:right">${formatMoney(openingCash)}</td></tr>
<tr><td style="padding:0.35rem 0">Expected cash</td><td style="text-align:right">${formatMoney(expectedCash)}</td></tr>
${closingCash != null ? `<tr><td style="padding:0.35rem 0">Closing cash</td><td style="text-align:right">${formatMoney(closingCash)}</td></tr>` : ''}
${overShort != null ? `<tr><td style="padding:0.35rem 0">Over / short</td><td style="text-align:right">${formatMoney(overShort)}</td></tr>` : ''}
<tr><td style="padding:0.35rem 0">Cash sales</td><td style="text-align:right">${formatMoney(s.cashSalesTotal ?? s.cash_sales_total)}</td></tr>
<tr><td style="padding:0.35rem 0">Card sales</td><td style="text-align:right">${formatMoney(s.cardSalesTotal ?? s.card_sales_total)}</td></tr>
<tr><td style="padding:0.35rem 0">Check sales</td><td style="text-align:right">${formatMoney(s.checkSalesTotal ?? s.check_sales_total)}</td></tr>
<tr><td style="padding:0.35rem 0;font-weight:600">Sales count</td><td style="text-align:right;font-weight:600">${s.saleCount ?? (report.sales || []).length}</td></tr>
<tr><td style="padding:0.35rem 0;font-weight:600">Merchandise total</td><td style="text-align:right;font-weight:600">${formatMoney(s.merchandiseTotal || 0)}</td></tr>
</table>
${salesHtml ? `<h3 style="font-size:1rem;margin:1rem 0 0.5rem">Sales</h3>
<table style="width:100%;border-collapse:collapse;font-size:14px">
<thead><tr style="border-bottom:1px solid #ddd"><th style="text-align:left;padding:0.25rem 0">Order</th><th style="text-align:right;padding:0.25rem 0">Total</th><th style="text-align:left;padding:0.25rem 0">Payment</th></tr></thead>
<tbody>${salesHtml}</tbody></table>` : ''}
<p style="margin:1.5rem 0 0;font-size:12px;color:#888">Generated ${new Date().toLocaleString()} · Business One POS</p>
</body></html>`;
}

async function htmlToPdfBuffer(html) {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        return page.pdf({
            format: 'Letter',
            printBackground: true,
            margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' }
        });
    } finally {
        await browser.close();
    }
}

async function generateShiftReportPdfBuffer(pool, report) {
    const store = await loadPosStoreConfig(pool);
    const storeName = store.storeName || 'Store';
    const shiftId = report.shift?.id || 'shift';
    const html = buildShiftReportHtml(report, storeName);
    const pdfBuffer = await htmlToPdfBuffer(html);
    return {
        pdfBuffer,
        storeName,
        filename: `end-of-shift-summary-shift-${shiftId}.pdf`
    };
}

async function sendShiftReportEmail(pool, report, email) {
    const to = String(email || '').trim();
    if (!to) {
        return { sent: false, reason: 'no_recipient' };
    }
    if (!isSmtpConfigured()) {
        return { sent: false, reason: 'smtp_not_configured' };
    }

    const store = await loadPosStoreConfig(pool);
    const storeName = store.storeName || 'Store';
    const shiftId = report.shift?.id || 'shift';
    const title = report.title || 'End-of-shift summary';
    const subject = `${storeName} — ${title} (shift #${shiftId})`;
    const text =
        `${storeName} — ${title}\n` +
        `Shift #${shiftId}\n` +
        `Merchandise: ${formatMoney(report.shift?.merchandiseTotal || 0)}\n` +
        `See attached PDF for full details.`;

    let pdfBuffer;
    let filename;
    try {
        const generated = await generateShiftReportPdfBuffer(pool, report);
        pdfBuffer = generated.pdfBuffer;
        filename = generated.filename;
    } catch (err) {
        logger.error('[pos-shift-report] PDF generation failed', { message: err.message });
        throw new Error('Could not generate PDF for this report');
    }

    await sendMail({
        to,
        subject,
        html: `<p>${escapeHtml(subject)}</p><p>Your end-of-shift summary is attached as a PDF.</p>`,
        text,
        logTag: 'POS shift report email',
        attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }]
    });

    logger.info('[pos-shift-report] Email sent', { to, shiftId });
    return { sent: true, to, filename };
}

module.exports = {
    buildShiftReportHtml,
    htmlToPdfBuffer,
    generateShiftReportPdfBuffer,
    sendShiftReportEmail
};
