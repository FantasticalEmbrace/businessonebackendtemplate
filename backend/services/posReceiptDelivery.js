'use strict';

const { sendMail, isSmtpConfigured } = require('../utils/mailTransporter');
const {
    normalizeUsE164,
    smsConfigured,
    twilioConfigured,
    telnyxConfigured,
    activeSmsProvider,
    sendSms
} = require('./smsProvider');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw) {
    const email = String(raw || '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email) || email.length > 120) return '';
    return email;
}

/** @deprecated Use normalizeUsE164 — kept for existing callers. */
function normalizeUsSms(raw) {
    return normalizeUsE164(raw);
}

async function sendReceiptEmail({ to, storeName, orderNumber, html, text }) {
    const email = normalizeEmail(to);
    if (!email) {
        const err = new Error('Enter a valid email address.');
        err.code = 'INVALID_EMAIL';
        throw err;
    }
    if (!isSmtpConfigured()) {
        const err = new Error('Email is not configured on this store (SMTP).');
        err.code = 'SMTP_NOT_CONFIGURED';
        throw err;
    }
    const store = String(storeName || 'the store').trim() || 'the store';
    const order = String(orderNumber || '').trim();
    const subject = order ? `Your receipt from ${store} (${order})` : `Your receipt from ${store}`;
    const result = await sendMail({
        to: email,
        subject,
        html: String(html || '').slice(0, 200000) || `<pre>${String(text || '').slice(0, 20000)}</pre>`,
        text: String(text || subject).slice(0, 20000),
        logTag: 'POS receipt email'
    });
    if (!result.sent) {
        const err = new Error('Email is not configured on this store (SMTP).');
        err.code = 'SMTP_NOT_CONFIGURED';
        throw err;
    }
    return { sent: true, to: email, method: 'email' };
}

async function sendReceiptSms({ to, text }) {
    try {
        return await sendSms({ to, text });
    } catch (e) {
        if (e.code === 'SMS_TEXT_REQUIRED') {
            const err = new Error('Receipt text is missing.');
            err.code = 'RECEIPT_TEXT_REQUIRED';
            throw err;
        }
        if (e.code === 'SMS_NOT_CONFIGURED') {
            const err = new Error('Text receipts are not configured on this store (Telnyx or Twilio).');
            err.code = 'SMS_NOT_CONFIGURED';
            throw err;
        }
        throw e;
    }
}

module.exports = {
    normalizeEmail,
    normalizeUsSms,
    twilioConfigured,
    telnyxConfigured,
    smsConfigured,
    activeSmsProvider,
    sendReceiptEmail,
    sendReceiptSms
};
