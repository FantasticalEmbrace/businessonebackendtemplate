'use strict';

const logger = require('../utils/logger');
const { getStorefrontPublicBaseUrl } = require('../utils/storefrontUrl');
const { resolveTrackingInfo } = require('../utils/trackingUrl');

function formatMoney(amount) {
    const n = Number(amount);
    return Number.isFinite(n) ? `$${n.toFixed(2)}` : '$0.00';
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function getMailTransporter() {
    const smtpHost = String(process.env.SMTP_HOST || process.env.EMAIL_HOST || '').trim();
    const smtpUser = String(process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
    const smtpPass = String(process.env.SMTP_PASSWORD || process.env.EMAIL_PASS || '').trim();
    const smtpPort = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 587) || 587;
    if (!smtpHost || !smtpUser) return null;
    const nodemailer = require('nodemailer');
    return {
        transporter: nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: { user: smtpUser, pass: smtpPass }
        }),
        from: String(process.env.SMTP_FROM || process.env.EMAIL_FROM || smtpUser).trim()
    };
}

/**
 * Send order confirmation email after successful payment.
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} orderId
 */
async function sendOrderConfirmationEmail(pool, orderId) {
    const oid = Number(orderId);
    if (!Number.isFinite(oid) || oid < 1) return;

    const [orders] = await pool.execute(
        `SELECT id, order_number, email, total_amount, tracking_number, tracking_url,
                shipping_carrier, shipping_first_name, shipping_last_name, payment_status, status
           FROM orders WHERE id = ? LIMIT 1`,
        [oid]
    );
    if (!orders.length) return;
    const order = orders[0];
    if (String(order.payment_status || '').toLowerCase() !== 'paid') return;

    const email = String(order.email || '').trim();
    if (!email) return;

    const [items] = await pool.execute(
        `SELECT product_name, quantity, total FROM order_items WHERE order_id = ? ORDER BY id`,
        [oid]
    );

    const first = String(order.shipping_first_name || '').trim() || 'there';
    const orderNumber = String(order.order_number || oid);
    const trackingInfo = resolveTrackingInfo(order);
    const tracking = trackingInfo.tracking_number || '';
    const trackingUrl = trackingInfo.tracking_url || '';
    const base = getStorefrontPublicBaseUrl();
    const confirmUrl = `${base}/order-confirmation.html?order=${encodeURIComponent(String(oid))}&email=${encodeURIComponent(email)}`;

    const itemRows = items
        .map(
            (line) =>
                `<tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${escapeHtml(line.product_name)}</td>` +
                `<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${line.quantity}</td>` +
                `<td style="padding:6px 0;border-bottom:1px solid #e5e7eb;text-align:right;">${formatMoney(line.total)}</td></tr>`
        )
        .join('');

    const trackingBlock = tracking && trackingUrl
        ? `<p style="margin:16px 0;padding:12px 16px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
            <strong>Tracking:</strong>
            <a href="${escapeHtml(trackingUrl)}" style="color:#10b981;font-weight:600;text-decoration:none;">${escapeHtml(tracking)}</a><br>
            <a href="${escapeHtml(trackingUrl)}" style="display:inline-block;margin-top:10px;padding:10px 18px;background:#10b981;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Track your shipment</a>
           </p>`
        : '';

    const html = `
        <div style="font-family:Inter,system-ui,sans-serif;color:#111827;max-width:560px;">
            <h2 style="color:#10b981;margin:0 0 8px;">Thank you for your order!</h2>
            <p>Hello ${escapeHtml(first)},</p>
            <p>We have received your payment and are preparing your order for shipment.</p>
            <p><strong>Order number:</strong> ${escapeHtml(orderNumber)}<br>
               <strong>Order total:</strong> ${formatMoney(order.total_amount)}</p>
            ${trackingBlock}
            <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
                <thead>
                    <tr style="border-bottom:2px solid #d1d5db;">
                        <th style="text-align:left;padding:6px 0;">Item</th>
                        <th style="text-align:center;padding:6px 8px;">Qty</th>
                        <th style="text-align:right;padding:6px 0;">Total</th>
                    </tr>
                </thead>
                <tbody>${itemRows || '<tr><td colspan="3">Your order items</td></tr>'}</tbody>
            </table>
            <p><a href="${escapeHtml(confirmUrl)}" style="background:#10b981;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;">View order confirmation</a></p>
            <p style="font-size:13px;color:#6b7280;">Questions? Call us at (706) 861-9454 or reply to this email.</p>
        </div>`;

    const text = [
        `Thank you for your order, ${first}!`,
        `Order number: ${orderNumber}`,
        `Total: ${formatMoney(order.total_amount)}`,
        tracking ? `Tracking number: ${tracking}` : '',
        trackingUrl ? `Track: ${trackingUrl}` : '',
        `Confirmation: ${confirmUrl}`
    ]
        .filter(Boolean)
        .join('\n');

    try {
        const mail = await getMailTransporter();
        if (!mail) {
            logger.info('Order confirmation (SMTP not configured):', {
                orderId: oid,
                email,
                orderNumber,
                tracking: tracking || null,
                confirmUrl
            });
            console.log('\n📧 Order confirmation (set SMTP_* in backend/.env to send email):\n');
            console.log(`   To: ${email}`);
            console.log(`   Order: ${orderNumber}`);
            if (tracking) console.log(`   Tracking: ${tracking}`);
            console.log(`   ${confirmUrl}\n`);
            return;
        }

        await mail.transporter.sendMail({
            from: mail.from,
            to: email,
            subject: `H&M Herbs — order confirmation ${orderNumber}`,
            text,
            html
        });
        logger.info(`Order confirmation email sent for order ${oid} to ${email}`);
    } catch (err) {
        logger.error(`Failed to send order confirmation email for order ${oid}:`, err);
    }
}

module.exports = { sendOrderConfirmationEmail };
