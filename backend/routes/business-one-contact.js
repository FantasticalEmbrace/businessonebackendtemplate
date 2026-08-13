'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { sendMail, isSmtpConfigured } = require('../utils/mailTransporter');

const router = express.Router();

const INBOX =
    String(process.env.BUSINESS_ONE_CONTACT_EMAIL || 'info@businessonecomprehensive.com').trim();

router.post('/contact', async (req, res) => {
    try {
        const name = String(req.body?.name || '').trim();
        const email = String(req.body?.email || '').trim();
        const phone = String(req.body?.phone || '').trim();
        const businessName = String(req.body?.businessName || req.body?.subject || '').trim();
        const message = String(req.body?.message || '').trim();
        const interests = Array.isArray(req.body?.interests) ? req.body.interests : [];

        if (!name || !email || !message) {
            return res.status(400).json({ error: 'Name, email, and message are required.' });
        }

        const interestLine = interests.length ? interests.join(', ') : 'Not specified';
        const text = [
            `Name: ${name}`,
            `Email: ${email}`,
            phone ? `Phone: ${phone}` : null,
            businessName ? `Business: ${businessName}` : null,
            `Interests: ${interestLine}`,
            '',
            message
        ]
            .filter(Boolean)
            .join('\n');

        const html = `
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ''}
            ${businessName ? `<p><strong>Business:</strong> ${businessName}</p>` : ''}
            <p><strong>Interests:</strong> ${interestLine}</p>
            <hr>
            <p>${message.replace(/\n/g, '<br>')}</p>`;

        if (isSmtpConfigured()) {
            try {
                await sendMail({
                    to: INBOX,
                    replyTo: email,
                    subject: `Business One contact — ${businessName || name}`,
                    text,
                    html,
                    logTag: 'Business One contact'
                });
            } catch (mailErr) {
                logger.error('[business-one-contact] send failed', { err: mailErr.message });
                return res.status(503).json({
                    error: 'Could not send message. Please call (850) 290-2084.'
                });
            }
        } else {
            logger.info('[business-one-contact] intake (SMTP not configured)', {
                name,
                email,
                businessName,
                interests: interestLine
            });
        }

        res.json({ success: true, message: 'Thank you — we received your message.' });
    } catch (e) {
        logger.error('[business-one-contact] failed', { err: e.message });
        res.status(500).json({ error: 'Could not send message. Please call (850) 290-2084.' });
    }
});

module.exports = router;
