'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const nodemailer = require('nodemailer');

const user = String(process.env.SMTP_USER || '').trim();
const pass = String(process.env.SMTP_PASSWORD || '').trim();
const to = String(process.argv[2] || user).trim();

console.log('SMTP_USER:', user);
console.log('SMTP_PASSWORD length:', pass.length, pass.length === 16 ? '(ok)' : '(expected 16)');
console.log('SMTP_HOST:', process.env.SMTP_HOST);
console.log('SMTP_PORT:', process.env.SMTP_PORT);

async function trySend(label, options) {
    const transporter = nodemailer.createTransport(options);
    try {
        await transporter.verify();
        console.log(`[${label}] verify OK`);
        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM || user,
            to,
            subject: `HM Herbs SMTP test (${label})`,
            text: 'If you received this, SMTP is working.'
        });
        console.log(`[${label}] sent`, info.messageId);
        return true;
    } catch (err) {
        console.log(`[${label}] FAILED:`, err.message);
        return false;
    }
}

(async () => {
    if (!user || !pass) {
        console.error('Missing SMTP_USER or SMTP_PASSWORD in backend/.env');
        process.exit(1);
    }

    const configs = [
        ['587 STARTTLS', { host: 'smtp.gmail.com', port: 587, secure: false, auth: { user, pass } }],
        ['465 SSL', { host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } }],
        [
            '587 explicit TLS',
            {
                host: 'smtp.gmail.com',
                port: 587,
                secure: false,
                requireTLS: true,
                auth: { user, pass }
            }
        ]
    ];

    for (const [label, opts] of configs) {
        if (await trySend(label, opts)) {
            process.exit(0);
        }
    }
    process.exit(1);
})();
