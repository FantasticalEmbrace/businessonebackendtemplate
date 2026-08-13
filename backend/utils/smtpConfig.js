'use strict';

/** True when SMTP env vars are set enough to send mail (EDSA, orders, password reset). */
function isSmtpConfigured() {
    const smtpHost = String(process.env.SMTP_HOST || process.env.EMAIL_HOST || '').trim();
    const smtpUser = String(process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
    const smtpPass = String(process.env.SMTP_PASSWORD || process.env.EMAIL_PASS || '').trim();
    return Boolean(smtpHost && smtpUser && smtpPass);
}

module.exports = { isSmtpConfigured };
