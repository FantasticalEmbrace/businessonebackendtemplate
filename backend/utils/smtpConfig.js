'use strict';

/** True when SMTP env vars are set enough to send mail directly. */
function isSmtpConfigured() {
    const smtpHost = String(process.env.SMTP_HOST || process.env.EMAIL_HOST || '').trim();
    const smtpUser = String(process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
    const smtpPass = String(process.env.SMTP_PASSWORD || process.env.EMAIL_PASS || '').trim();
    return Boolean(smtpHost && smtpUser && smtpPass);
}

/**
 * HTTPS mail relay (SiteGround) — used when Linode blocks outbound SMTP.
 * Secret: MAIL_RELAY_SECRET or BO_TAX_OPS_KEY (must match SiteGround ops-config).
 */
function isMailRelayConfigured() {
    const url = String(process.env.MAIL_RELAY_URL || '').trim();
    const secret = String(
        process.env.MAIL_RELAY_SECRET || process.env.BO_TAX_OPS_KEY || ''
    ).trim();
    return Boolean(url && secret);
}

/** True when either direct SMTP or HTTPS relay can send. */
function isMailConfigured() {
    return isMailRelayConfigured() || isSmtpConfigured();
}

module.exports = { isSmtpConfigured, isMailRelayConfigured, isMailConfigured };
