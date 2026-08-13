'use strict';

const logger = require('../utils/logger');
const { sendMail, isSmtpConfigured } = require('../utils/mailTransporter');

function billingPortalUrl() {
    const { billingPortalUrl: platformUrl } = require('./platformBillingEmail');
    return platformUrl();
}

function storeName(license) {
    return String(license?.businessName || 'your store').trim() || 'your store';
}

async function sendPaymentFailedEmail(license, { amount, graceDays, inGrace }) {
    const to = String(license.billingEmail || '').trim();
    if (!to) {
        logger.warn('[pos-billing] Payment failed email skipped — no billing email');
        return { sent: false, reason: 'no_email' };
    }
    if (!isSmtpConfigured()) {
        return { sent: false, reason: 'smtp_not_configured' };
    }

    const portal = billingPortalUrl();
    const graceLine = inGrace
        ? `<p>You still have <strong>${graceDays} day(s)</strong> of grace before registers stop syncing sales. We will retry the charge automatically.</p>`
        : `<p>Please update your payment method to restore full service.</p>`;

    const html = `
      <p>Hi ${storeName(license)},</p>
      <p>We could not process your Business One POS payment of <strong>$${Number(amount).toFixed(2)}</strong>.</p>
      ${graceLine}
      <p><a href="${portal}">Update billing</a></p>
      <p>Questions? Reply to this email or call Business One support.</p>`;

    return sendMail({
        to,
        subject: 'Business One POS — payment failed',
        html,
        text: `Payment of $${Number(amount).toFixed(2)} failed. Update billing: ${portal}`,
        logTag: 'POS billing failed'
    });
}

async function sendGraceEndedEmail(license) {
    const to = String(license.billingEmail || '').trim();
    if (!to || !isSmtpConfigured()) return { sent: false };

    const portal = billingPortalUrl();
    const html = `
      <p>Hi ${storeName(license)},</p>
      <p>Your grace period for Business One POS has ended. Registers can no longer sync new sales until payment is updated.</p>
      <p><a href="${portal}">Update billing</a></p>`;

    return sendMail({
        to,
        subject: 'Business One POS — grace period ended',
        html,
        logTag: 'POS billing grace ended'
    });
}

async function sendPaymentSucceededEmail(license, { amount }) {
    const to = String(license.billingEmail || '').trim();
    if (!to || !isSmtpConfigured()) return { sent: false };

    const html = `
      <p>Hi ${storeName(license)},</p>
      <p>Thank you — your Business One POS payment of <strong>$${Number(amount).toFixed(2)}</strong> was received.</p>
      <p>Your service remains active. Thank you for partnering with Business One.</p>`;

    return sendMail({
        to,
        subject: 'Business One POS — payment received',
        html,
        logTag: 'POS billing paid'
    });
}

async function sendPastDueWaivedEmail(license, { amount, reason }) {
    const to = String(license.billingEmail || '').trim();
    if (!to || !isSmtpConfigured()) return { sent: false };

    const html = `
      <p>Hi ${storeName(license)},</p>
      <p>Your missed Business One POS payment of <strong>$${Number(amount).toFixed(2)}</strong> has been waived and your account is active again.</p>
      ${reason ? `<p><em>${reason}</em></p>` : ''}
      <p>Thank you for partnering with Business One.</p>`;

    return sendMail({
        to,
        subject: 'Business One POS — past due cleared',
        html,
        logTag: 'POS billing waived'
    });
}

module.exports = {
    billingPortalUrl,
    sendPaymentFailedEmail,
    sendGraceEndedEmail,
    sendPaymentSucceededEmail,
    sendPastDueWaivedEmail
};
