'use strict';

const { getStorefrontPublicBaseUrl } = require('../utils/storefrontUrl');
const { sendMail } = require('../utils/mailTransporter');
const { resolveStoreBranding } = require('./storeBranding');

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatMoney(amount) {
    return `$${Number(amount || 0).toFixed(2)}`;
}

function renderCartItemsHtml(items, colors) {
    const rows = (items || [])
        .map((item) => {
            const qty = Number(item.quantity) || 1;
            const price = Number(item.price) || 0;
            const line = price * qty;
            return `<tr>
                <td style="padding:8px 0;border-bottom:1px solid ${colors.border};">${escapeHtml(item.name || 'Item')}</td>
                <td style="padding:8px 0;border-bottom:1px solid ${colors.border};text-align:center;">${qty}</td>
                <td style="padding:8px 0;border-bottom:1px solid ${colors.border};text-align:right;">${formatMoney(line)}</td>
            </tr>`;
        })
        .join('');
    return `<table style="width:100%;border-collapse:collapse;font-size:14px;color:${colors.text};">
        <thead>
            <tr>
                <th style="text-align:left;padding:8px 0;border-bottom:2px solid ${colors.border};">Item</th>
                <th style="text-align:center;padding:8px 0;border-bottom:2px solid ${colors.border};">Qty</th>
                <th style="text-align:right;padding:8px 0;border-bottom:2px solid ${colors.border};">Total</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}

function applyTemplateTokens(text, tokens) {
    let out = String(text || '');
    for (const [key, value] of Object.entries(tokens)) {
        out = out.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), String(value ?? ''));
    }
    return out;
}

function buildDiscountBlock(program, colors) {
    if (program.discount_type === 'percent' && program.discount_value) {
        const code = program.promo_code ? ` Use code <strong>${escapeHtml(program.promo_code)}</strong> at checkout.` : '';
        return `<p style="margin:16px 0;padding:12px 16px;background:${colors.lightGreen};border-radius:8px;color:${colors.text};">
            Save <strong>${Number(program.discount_value)}%</strong> on your order.${code}
        </p>`;
    }
    if (program.discount_type === 'fixed' && program.discount_value) {
        const code = program.promo_code ? ` Use code <strong>${escapeHtml(program.promo_code)}</strong> at checkout.` : '';
        return `<p style="margin:16px 0;padding:12px 16px;background:${colors.lightGreen};border-radius:8px;color:${colors.text};">
            Save <strong>${formatMoney(program.discount_value)}</strong> on your order.${code}
        </p>`;
    }
    if (program.promo_code) {
        return `<p style="margin:16px 0;color:${colors.text};">Use code <strong>${escapeHtml(program.promo_code)}</strong> at checkout.</p>`;
    }
    return '';
}

function buildSaleAlertBlock(saleItems, colors) {
    if (!saleItems.length) return '';
    const list = saleItems
        .map(
            (item) =>
                `<li style="margin:4px 0;"><strong>${escapeHtml(item.name)}</strong> — now ${formatMoney(item.currentPrice)}` +
                (item.wasPrice ? ` (was ${formatMoney(item.wasPrice)})` : '') +
                '</li>'
        )
        .join('');
    return `<p style="margin:16px 0;padding:12px 16px;background:${colors.lightGreen};border-radius:8px;color:${colors.text};">
        <strong>Good news!</strong> Items in your cart are on sale:
        <ul style="margin:8px 0 0 18px;padding:0;">${list}</ul>
    </p>`;
}

function buildAbandonedCartEmail({ program, snapshot, saleItems = [], branding }) {
    const b = branding || {};
    const colors = b.colors || {};
    const storeName = b.storeName || 'Your Store';
    const items = Array.isArray(snapshot.cartItems) ? snapshot.cartItems : [];
    const firstName = snapshot.firstName || 'there';
    const checkoutUrl = `${getStorefrontPublicBaseUrl()}/checkout.html`;
    const tokens = {
        first_name: firstName,
        subtotal: formatMoney(snapshot.subtotal),
        promo_code: program.promo_code || '',
        discount_percent: program.discount_type === 'percent' ? String(program.discount_value || '') : '',
        checkout_url: checkoutUrl,
        store_name: storeName,
    };

    const intro = applyTemplateTokens(
        program.email_intro ||
            `Hi {{first_name}}, you left items in your cart at ${storeName}. Your subtotal is {{subtotal}}.`,
        tokens
    );

    const discountBlock =
        program.trigger_type === 'item_on_sale'
            ? buildSaleAlertBlock(saleItems, colors)
            : buildDiscountBlock(program, colors);

    const logoBlock = b.logoUrl
        ? `<img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(storeName)}" style="max-height:48px;max-width:200px;display:block;margin-bottom:8px;">`
        : '';

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:${colors.pageBg || '#f3f4f6'};font-family:${b.font || 'Inter, Arial, sans-serif'};">
        <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid ${colors.border};">
            <div style="background:linear-gradient(135deg,${colors.primary},${colors.primaryDark});padding:24px;color:#fff;">
                ${logoBlock}
                <h1 style="margin:0;font-size:22px;">${escapeHtml(storeName)}</h1>
            </div>
            <div style="padding:24px;color:${colors.text};">
                <p style="margin:0 0 16px;line-height:1.5;">${escapeHtml(intro).replace(/\n/g, '<br>')}</p>
                ${discountBlock}
                ${renderCartItemsHtml(items, colors)}
                <p style="margin:20px 0 0;text-align:center;">
                    <a href="${escapeHtml(checkoutUrl)}" style="display:inline-block;background:${colors.primary};color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Return to checkout</a>
                </p>
                <p style="margin:24px 0 0;font-size:12px;color:${colors.textMuted};">Questions?${b.storePhone ? ` Call ${escapeHtml(b.storePhone)}` : ''}${b.storeEmail ? ` or email ${escapeHtml(b.storeEmail)}` : ''}.</p>
            </div>
        </div>
    </body></html>`;

    const subject = applyTemplateTokens(
        program.email_subject || `You left something in your cart at ${storeName}`,
        tokens
    );
    const text = `${intro}\n\nSubtotal: ${tokens.subtotal}\nCheckout: ${checkoutUrl}`;

    return { subject, html, text };
}

async function sendAbandonedCartEmail({ program, snapshot, saleItems, branding, pool }) {
    const resolvedBranding = branding || (pool ? await resolveStoreBranding(pool) : null);
    const dbProgram = {
        discount_type: program.discountType || program.discount_type,
        discount_value: program.discountValue ?? program.discount_value,
        promo_code: program.promoCode || program.promo_code,
        trigger_type: program.triggerType || program.trigger_type,
        email_intro: program.emailIntro || program.email_intro,
        email_subject: program.emailSubject || program.email_subject,
    };
    const { subject, html, text } = buildAbandonedCartEmail({
        program: dbProgram,
        snapshot,
        saleItems,
        branding: resolvedBranding,
    });
    return sendMail({
        to: snapshot.email,
        subject,
        html,
        text,
        logTag: '[abandoned-cart]',
    });
}

module.exports = {
    buildAbandonedCartEmail,
    sendAbandonedCartEmail,
    applyTemplateTokens,
    renderCartItemsHtml,
};
