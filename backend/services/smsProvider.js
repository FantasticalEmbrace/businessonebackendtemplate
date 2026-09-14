'use strict';

/**
 * Outbound SMS via Telnyx (preferred) or Twilio (fallback).
 * Telnyx: https://developers.telnyx.com/docs/api/v2/messaging
 * Credentials: Admin → Developer tools (cred_telnyx_*) → mirrored to TELNYX_* in .env.
 */
const axios = require('axios');
const logger = require('../utils/logger');

function normalizeUsE164(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    if (digits.length !== 10) return '';
    return `+1${digits}`;
}

function resolveTelnyxCreds() {
    try {
        const creds = require('./integrationCredentials');
        return {
            apiKey: String(creds.getTelnyxApiKey?.() || '').trim(),
            from: String(creds.getTelnyxFrom?.() || '').trim()
        };
    } catch {
        return {
            apiKey: String(process.env.TELNYX_API_KEY || '').trim(),
            from: String(process.env.TELNYX_FROM || process.env.TELNYX_PHONE || '').trim()
        };
    }
}

function telnyxConfigured() {
    const { apiKey, from } = resolveTelnyxCreds();
    return Boolean(apiKey && from);
}

function twilioConfigured() {
    const sid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
    const token = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
    const from = String(process.env.TWILIO_FROM || process.env.TWILIO_PHONE || '').trim();
    return Boolean(sid && token && from);
}

/** True when any SMS provider is ready. */
function smsConfigured() {
    return telnyxConfigured() || twilioConfigured();
}

function activeSmsProvider() {
    if (telnyxConfigured()) return 'telnyx';
    if (twilioConfigured()) return 'twilio';
    return null;
}

async function sendViaTelnyx({ to, text }) {
    const { apiKey, from } = resolveTelnyxCreds();
    let res;
    try {
        res = await axios.post(
            'https://api.telnyx.com/v2/messages',
            {
                from,
                to,
                text
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                timeout: 20000,
                validateStatus: () => true
            }
        );
    } catch (e) {
        logger.error('Telnyx SMS request failed', { message: e.message });
        const err = new Error('Could not send text message');
        err.code = 'SMS_FAILED';
        throw err;
    }
    const data = res.data && typeof res.data === 'object' ? res.data : {};
    if (res.status < 200 || res.status >= 300) {
        const detail =
            data?.errors?.[0]?.detail ||
            data?.errors?.[0]?.title ||
            data?.message ||
            data?.error ||
            'Could not send text message';
        const err = new Error(detail);
        err.code = 'SMS_FAILED';
        throw err;
    }
    const id = data?.data?.id || data?.id || null;
    return { sent: true, to, method: 'sms', provider: 'telnyx', sid: id };
}

async function sendViaTwilio({ to, text }) {
    const sid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
    const token = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
    const from = String(process.env.TWILIO_FROM || process.env.TWILIO_PHONE || '').trim();
    const params = new URLSearchParams({ To: to, From: from, Body: text });
    let res;
    try {
        res = await axios.post(
            `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
            params.toString(),
            {
                auth: { username: sid, password: token },
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 20000,
                validateStatus: () => true
            }
        );
    } catch (e) {
        logger.error('Twilio SMS request failed', { message: e.message });
        const err = new Error('Could not send text message');
        err.code = 'SMS_FAILED';
        throw err;
    }
    const data = res.data && typeof res.data === 'object' ? res.data : {};
    if (res.status < 200 || res.status >= 300) {
        const err = new Error(data.message || data.error || 'Could not send text message');
        err.code = 'SMS_FAILED';
        throw err;
    }
    return { sent: true, to, method: 'sms', provider: 'twilio', sid: data.sid || null };
}

/**
 * Send a US SMS. Prefers Telnyx when configured.
 * @param {{ to: string, text: string }} opts
 */
async function sendSms({ to, text }) {
    const phone = normalizeUsE164(to);
    if (!phone) {
        const err = new Error('Enter a valid 10-digit US mobile number.');
        err.code = 'INVALID_PHONE';
        throw err;
    }
    const body = String(text || '').replace(/\s+\n/g, '\n').trim().slice(0, 1500);
    if (!body) {
        const err = new Error('Message text is missing.');
        err.code = 'SMS_TEXT_REQUIRED';
        throw err;
    }
    if (!smsConfigured()) {
        const err = new Error('Text messaging is not configured (Telnyx or Twilio).');
        err.code = 'SMS_NOT_CONFIGURED';
        throw err;
    }
    if (telnyxConfigured()) {
        return sendViaTelnyx({ to: phone, text: body });
    }
    return sendViaTwilio({ to: phone, text: body });
}

module.exports = {
    normalizeUsE164,
    telnyxConfigured,
    twilioConfigured,
    smsConfigured,
    activeSmsProvider,
    sendSms
};
