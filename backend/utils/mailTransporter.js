'use strict';

const logger = require('./logger');
const { isSmtpConfigured } = require('./smtpConfig');

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
            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 20000
        }),
        from: fromRaw
    };
}

/**
 * @param {{ to: string, subject: string, html: string, text?: string, logTag?: string, attachments?: Array<{ filename: string, content: Buffer | string, contentType?: string }> }} opts
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
async function sendMail({ to, subject, html, text, logTag = 'Email', attachments = [], replyTo }) {
    const mail = await getMailTransporter();
    if (!mail) {
        logger.warn(`${logTag} skipped — SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASSWORD in backend/.env)`);
        return { sent: false, reason: 'SMTP not configured' };
    }

    try {
        await mail.transporter.sendMail({
            from: mail.from,
            to,
            replyTo: replyTo || undefined,
            subject,
            html,
            text: text || subject,
            attachments: attachments.length ? attachments : undefined
        });
        return { sent: true };
    } catch (err) {
        logger.error(`${logTag} failed`, { to, message: err.message });
        throw err;
    }
}

module.exports = { getMailTransporter, sendMail, isSmtpConfigured };
