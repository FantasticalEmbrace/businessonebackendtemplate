'use strict';

const logger = require('./logger');
const { isSmtpConfigured, isMailRelayConfigured, isMailConfigured } = require('./smtpConfig');

/**
 * @returns {Promise<{ transporter: import('nodemailer').Transporter, from: string | { name: string, address: string } } | null>}
 */
async function getMailTransporter() {
    if (!isSmtpConfigured()) return null;

    const smtpHost = String(process.env.SMTP_HOST || process.env.EMAIL_HOST || '').trim();
    const smtpUser = String(process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
    const smtpPass = String(process.env.SMTP_PASSWORD || process.env.EMAIL_PASS || '').trim();
    const smtpPort = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 587) || 587;

    const nodemailer = require('nodemailer');
    const fromRaw = String(process.env.SMTP_FROM || process.env.EMAIL_FROM || smtpUser).trim();

    return {
        transporter: nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: { user: smtpUser, pass: smtpPass },
            connectionTimeout: 8000,
            greetingTimeout: 8000,
            socketTimeout: 10000
        }),
        from: fromRaw
    };
}

/**
 * Linode blocks outbound SMTP (25/465/587). Prefer HTTPS relay to SiteGround
 * when MAIL_RELAY_URL is set — SiteGround can still speak Gmail SMTP.
 *
 * @returns {Promise<{ sent: boolean, reason?: string, via?: string }>}
 */
async function sendMailViaHttpsRelay({ to, subject, html, text, replyTo, logTag, timeoutMs }) {
    const url = String(process.env.MAIL_RELAY_URL || '').trim();
    const secret = String(
        process.env.MAIL_RELAY_SECRET || process.env.BO_TAX_OPS_KEY || ''
    ).trim();
    if (!url || !secret) {
        return { sent: false, reason: 'mail_relay_not_configured' };
    }

    const cap = Math.max(1000, Math.min(60000, Number(timeoutMs) || 15000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cap);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-BO-Mail-Relay-Key': secret
            },
            body: JSON.stringify({
                to,
                subject,
                html,
                text: text || subject,
                replyTo: replyTo || undefined
            }),
            signal: controller.signal
        });
        const raw = await res.text();
        let data = null;
        try {
            data = raw ? JSON.parse(raw) : null;
        } catch {
            data = null;
        }
        if (!res.ok) {
            const reason =
                (data && (data.error || data.code)) || `relay_http_${res.status}`;
            logger.error(`${logTag} HTTPS relay failed`, { to, status: res.status, reason });
            return { sent: false, reason: String(reason), via: 'https_relay' };
        }
        return { sent: true, via: 'https_relay' };
    } catch (err) {
        const reason = err?.name === 'AbortError' ? 'relay_timed_out' : err?.message || 'relay_failed';
        logger.error(`${logTag} HTTPS relay error`, { to, message: reason });
        return { sent: false, reason, via: 'https_relay' };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Soft-fail email send: never throws.
 * Prefers MAIL_RELAY_URL (HTTPS) when configured — required on Linode where SMTP is blocked.
 *
 * @returns {Promise<{ sent: boolean, reason?: string, via?: string }>}
 */
async function sendMail({ to, subject, html, text, logTag = 'Email', attachments = [], replyTo, timeoutMs }) {
    if (!isMailConfigured()) {
        logger.warn(
            `${logTag} skipped — mail not configured (set MAIL_RELAY_URL + MAIL_RELAY_SECRET/BO_TAX_OPS_KEY, or SMTP_HOST/USER/PASSWORD)`
        );
        return { sent: false, reason: 'mail_not_configured' };
    }

    const preferRelay =
        isMailRelayConfigured() && (!attachments || attachments.length === 0);
    if (preferRelay) {
        const relayResult = await sendMailViaHttpsRelay({
            to,
            subject,
            html,
            text,
            replyTo,
            logTag,
            timeoutMs
        });
        if (relayResult.sent) return relayResult;
        const allowSmtpFallback =
            String(process.env.MAIL_RELAY_FALLBACK_SMTP || '').trim() === '1';
        if (!allowSmtpFallback || !isSmtpConfigured()) return relayResult;
        logger.warn(`${logTag} relay failed; trying SMTP`, { reason: relayResult.reason });
    }

    const mail = await getMailTransporter();
    if (!mail) {
        return { sent: false, reason: 'SMTP not configured' };
    }

    const cap = Math.max(1000, Math.min(60000, Number(timeoutMs) || 12000));
    try {
        await Promise.race([
            mail.transporter.sendMail({
                from: mail.from,
                to,
                replyTo: replyTo || undefined,
                subject,
                html,
                text: text || subject,
                attachments: attachments.length ? attachments : undefined
            }),
            new Promise((_, reject) => {
                setTimeout(() => {
                    const err = new Error('Email send timed out');
                    err.code = 'ETIMEDOUT';
                    reject(err);
                }, cap);
            })
        ]);
        return { sent: true, via: 'smtp' };
    } catch (err) {
        logger.error(`${logTag} failed`, { to, message: err.message, code: err.code });
        return { sent: false, reason: err.message || 'send_failed', via: 'smtp' };
    }
}

module.exports = {
    getMailTransporter,
    sendMail,
    sendMailViaHttpsRelay,
    isSmtpConfigured,
    isMailRelayConfigured,
    isMailConfigured
};
