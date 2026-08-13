'use strict';

const logger = require('../utils/logger');
const { sendMail, isSmtpConfigured } = require('../utils/mailTransporter');

function billingPortalUrl() {
    const base = String(
        process.env.BILLING_PORTAL_URL || 'https://businessonecomprehensive.com/billing-portal.html'
    )
        .trim()
        .replace(/\/+$/, '');
    return base.includes('billing-portal') ? base : `${base}/billing-portal.html`;
}

function accountName(account) {
    return String(account?.businessName || 'your business').trim() || 'your business';
}

async function sendPaymentFailedEmail(account, { amount, lines = [] }) {
    const to = String(account.billingEmail || '').trim();
    if (!to || !isSmtpConfigured()) return { sent: false };

    const itemLines = lines
        .map((l) => `<li>${l.label}: $${Number(l.amount).toFixed(2)}</li>`)
        .join('');
    const portal = billingPortalUrl();
    const html = `
      <p>Hi ${accountName(account)},</p>
      <p>We could not process your Business One payment of <strong>$${Number(amount).toFixed(2)}</strong>.</p>
      ${itemLines ? `<ul>${itemLines}</ul>` : ''}
      <p><a href="${portal}">Update billing</a></p>`;

    return sendMail({
        to,
        subject: 'Business One — payment failed',
        html,
        text: `Payment of $${Number(amount).toFixed(2)} failed. Update billing: ${portal}`,
        logTag: 'Platform billing failed'
    });
}

async function sendPaymentSucceededEmail(account, { amount, lines = [] }) {
    const to = String(account.billingEmail || '').trim();
    if (!to || !isSmtpConfigured()) return { sent: false };

    const itemLines = lines
        .map((l) => `<li>${l.label}: $${Number(l.amount).toFixed(2)}</li>`)
        .join('');
    const html = `
      <p>Hi ${accountName(account)},</p>
      <p>Thank you — your Business One payment of <strong>$${Number(amount).toFixed(2)}</strong> was received.</p>
      ${itemLines ? `<ul>${itemLines}</ul>` : ''}`;

    return sendMail({
        to,
        subject: 'Business One — payment received',
        html,
        logTag: 'Platform billing paid'
    });
}

async function sendPastDueWaivedEmail(account, { amount, reason }) {
    const to = String(account.billingEmail || '').trim();
    if (!to || !isSmtpConfigured()) return { sent: false };
    const html = `
      <p>Hi ${accountName(account)},</p>
      <p>Your past-due balance of <strong>$${Number(amount).toFixed(2)}</strong> has been waived${reason ? `: ${reason}` : ''}.</p>
      <p>Service is restored. Thank you.</p>`;
    return sendMail({
        to,
        subject: 'Business One — past due waived',
        html,
        logTag: 'Platform billing waived'
    });
}

module.exports = {
    billingPortalUrl,
    sendPaymentFailedEmail,
    sendPaymentSucceededEmail,
    sendPastDueWaivedEmail
};
