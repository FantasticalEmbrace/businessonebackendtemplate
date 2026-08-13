'use strict';

const logger = require('../utils/logger');
const { getStorefrontPublicBaseUrl } = require('../utils/storefrontUrl');
const { sendMail } = require('../utils/mailTransporter');

/** Matches css/brand-tokens.css — keep in sync with storefront brand colors. */
const BRAND = {
    primary: '#047857',
    primaryDark: '#065f46',
    headerFrom: '#047857',
    headerTo: '#065f46',
    lightGreen: '#ecfdf5',
    sageBorder: '#bbf7d0',
    accentGold: '#d4af37',
    text: '#111827',
    textMuted: '#4b5563',
    footerMuted: '#6b7280',
    border: '#e5e7eb',
    pageBg: '#f3f4f6',
    font: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif'
};

const GREETING_HEADLINES = {
    birthday: 'Happy Birthday!',
    thank_you: 'Thank You!',
    celebration: 'Congratulations!',
    thinking_of_you: 'Thinking of You',
    custom: null
};

const STORE_PHONE = '(706) 861-9454';

function storefrontBase() {
    return getStorefrontPublicBaseUrl();
}

function logoUrl() {
    return `${storefrontBase()}/images/HM%20Herb%20Logo.png`;
}

function accountSetupUrl(resetToken) {
    return `${storefrontBase()}/reset-password.html?token=${encodeURIComponent(resetToken)}`;
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function hmButton(href, label) {
    return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${BRAND.primary};color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;">${escapeHtml(label)}</a>`;
}

function hmTextLink(href, label) {
    return `<a href="${escapeHtml(href)}" style="color:${BRAND.primaryDark};font-weight:600;text-decoration:none;">${escapeHtml(label)}</a>`;
}

/**
 * Branded HM Herbs email shell — logo header, content area, store footer.
 */
function wrapHmHerbsEmail({ headline, bodyHtml, preheader = '' }) {
    const base = storefrontBase();
    const heroHeadline = headline
        ? `<tr>
            <td style="padding:0;background:linear-gradient(135deg,${BRAND.headerFrom} 0%,${BRAND.headerTo} 100%);text-align:center;">
              <p style="margin:0;padding:18px 24px 22px;font-family:${BRAND.font};font-size:26px;line-height:1.25;font-weight:700;color:#ffffff;letter-spacing:0.01em;">${escapeHtml(headline)}</p>
            </td>
          </tr>`
        : '';

    const preheaderBlock = preheader
        ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>`
        : '';

    return `${preheaderBlock}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.pageBg};margin:0;padding:24px 12px;font-family:${BRAND.font};">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:580px;background:#ffffff;border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:24px 24px 16px;text-align:center;background:#ffffff;border-bottom:3px solid ${BRAND.primary};">
            <a href="${escapeHtml(base)}/index.html" style="text-decoration:none;">
              <img src="${escapeHtml(logoUrl())}" alt="H&amp;M Herbs &amp; Vitamins" width="200" style="display:block;margin:0 auto;max-width:200px;height:auto;border:0;" />
            </a>
            <p style="margin:10px 0 0;font-family:${BRAND.font};font-size:13px;line-height:1.4;color:${BRAND.textMuted};letter-spacing:0.04em;text-transform:uppercase;">Premium natural health products since 1995</p>
          </td>
        </tr>
        ${heroHeadline}
        <tr>
          <td style="padding:28px 28px 8px;font-family:${BRAND.font};font-size:16px;line-height:1.65;color:${BRAND.text};">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:8px 28px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${BRAND.border};">
              <tr>
                <td style="padding-top:20px;font-family:${BRAND.font};font-size:13px;line-height:1.6;color:${BRAND.footerMuted};text-align:center;">
                  <p style="margin:0 0 6px;"><strong style="color:${BRAND.primaryDark};">H&amp;M Herbs &amp; Vitamins</strong></p>
                  <p style="margin:0 0 6px;">${STORE_PHONE} · Mon–Fri 10am–5pm, Sat 10am–1pm</p>
                  <p style="margin:0;">
                    <a href="${escapeHtml(base)}/index.html" style="color:${BRAND.primaryDark};text-decoration:none;">hmherbs.com</a>
                    &nbsp;·&nbsp;
                    <a href="${escapeHtml(base)}/gift-cards.html" style="color:${BRAND.primaryDark};text-decoration:none;">Gift cards</a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

function buildGiftCardBodyHtml({
    recipientName,
    senderName,
    personalMessage,
    greetingOccasion,
    includePersonalizedEmail,
    cardType,
    amount,
    code,
    pin,
    resetToken,
    isNewAccount
}) {
    const first = escapeHtml(String(recipientName || '').trim() || 'there');
    const from = escapeHtml(String(senderName || '').trim() || 'Someone special');
    const setupUrl = resetToken ? accountSetupUrl(resetToken) : `${storefrontBase()}/account.html`;
    const isDigital = cardType === 'digital';
    const styled = Boolean(includePersonalizedEmail);
    const amountStr = `$${Number(amount).toFixed(2)}`;

    const messageText = String(personalMessage || '').trim();
    const messageBlock = messageText
        ? `<div style="margin:22px 0;padding:20px 22px;background:${BRAND.lightGreen};border:1px solid ${BRAND.sageBorder};border-left:4px solid ${BRAND.primary};border-radius:8px;">
                    <p style="margin:0;font-family:${BRAND.font};font-size:17px;line-height:1.65;color:#065f46;font-style:italic;">&ldquo;${escapeHtml(messageText)}&rdquo;</p>
               </div>`
        : '';

    const codeBlock = isDigital
        ? `<div style="margin:22px 0;padding:18px 20px;background:${BRAND.lightGreen};border:1px solid ${BRAND.sageBorder};border-radius:8px;">
                <p style="margin:0 0 4px;font-family:${BRAND.font};font-size:13px;font-weight:600;color:${BRAND.primaryDark};text-transform:uppercase;letter-spacing:0.06em;">Your gift card</p>
                <p style="margin:0 0 10px;font-family:${BRAND.font};font-size:22px;line-height:1.3;font-weight:700;color:${BRAND.text};">${amountStr}</p>
                <p style="margin:0 0 6px;font-family:${BRAND.font};font-size:15px;color:${BRAND.text};"><strong>Code:</strong> ${escapeHtml(code)}</p>
                <p style="margin:0 0 10px;font-family:${BRAND.font};font-size:15px;color:${BRAND.text};"><strong>PIN:</strong> ${escapeHtml(pin)}</p>
                <p style="margin:0;font-family:${BRAND.font};font-size:14px;line-height:1.5;color:${BRAND.textMuted};">Use this code at checkout on hmherbs.com or sign in to your account to apply it automatically.</p>
           </div>`
        : `<p style="margin:16px 0;font-family:${BRAND.font};font-size:16px;line-height:1.6;color:${BRAND.text};">Your physical gift card will be mailed soon. Once it arrives, you can check your balance anytime in your account.</p>`;

    const accountBlock =
        isNewAccount && resetToken
            ? `<p style="margin:18px 0 12px;font-family:${BRAND.font};font-size:16px;line-height:1.6;color:${BRAND.text};">We created an account for you so you can track your gift card balance online.</p>
               <p style="margin:0 0 12px;">${hmButton(setupUrl, 'Set up your account')}</p>
               <p style="margin:0;font-family:${BRAND.font};font-size:13px;line-height:1.5;color:${BRAND.footerMuted};word-break:break-all;">Or copy this link: ${escapeHtml(setupUrl)}</p>`
            : `<p style="margin:18px 0 0;font-family:${BRAND.font};font-size:16px;line-height:1.6;color:${BRAND.text};">${hmTextLink(setupUrl, 'View your gift cards in your account')}</p>`;

    return `
        <p style="margin:0 0 12px;font-family:${BRAND.font};font-size:16px;line-height:1.6;color:${BRAND.text};">Hello ${first},</p>
        <p style="margin:0 0 8px;font-family:${BRAND.font};font-size:16px;line-height:1.6;color:${BRAND.text};">
          <strong>${from}</strong> sent you a <strong>${amountStr}</strong> H&amp;M Herbs ${isDigital ? 'digital' : 'physical'} gift card.
        </p>
        ${messageBlock}
        ${codeBlock}
        ${accountBlock}
        <p style="margin:24px 0 0;font-family:${BRAND.font};font-size:15px;line-height:1.6;color:${BRAND.textMuted};">Thank you for choosing H&amp;M Herbs &amp; Vitamins.</p>`;
}

function buildStyledGiftEmailHtml(opts) {
    const styled = Boolean(opts.includePersonalizedEmail);
    const occasion = String(opts.greetingOccasion || '').trim().toLowerCase();
    const messageText = String(opts.personalMessage || '').trim();
    const headline =
        styled &&
        (GREETING_HEADLINES[occasion] || (occasion === 'custom' && messageText ? 'A Gift for You' : null));

    const bodyHtml = buildGiftCardBodyHtml(opts);
    const from = String(opts.senderName || '').trim() || 'Someone special';
    const preheader = styled
        ? `${from} sent you a gift from H&M Herbs`
        : `You received a gift card from H&M Herbs`;

    return wrapHmHerbsEmail({
        headline: headline || null,
        preheader,
        bodyHtml
    });
}

async function sendGiftCardRecipientEmail({
    to,
    recipientName,
    senderName,
    personalMessage,
    greetingOccasion,
    includePersonalizedEmail,
    cardType,
    amount,
    code,
    pin,
    resetToken,
    isNewAccount
}) {
    const from = String(senderName || '').trim() || 'Someone special';
    const isDigital = cardType === 'digital';
    const styled = Boolean(includePersonalizedEmail);
    const occasion = String(greetingOccasion || '').trim().toLowerCase();

    let subject = isDigital
        ? `You received a $${amount} H&M Herbs gift card from ${from}`
        : `A $${amount} H&M Herbs gift card is on the way from ${from}`;

    if (styled && occasion === 'birthday') {
        subject = `Happy Birthday! ${from} sent you a $${amount} H&M Herbs gift card`;
    } else if (styled && occasion === 'thank_you') {
        subject = `Thank you — a $${amount} gift from ${from} at H&M Herbs`;
    }

    const html = buildStyledGiftEmailHtml({
        recipientName,
        senderName,
        personalMessage,
        greetingOccasion: occasion,
        includePersonalizedEmail: styled,
        cardType,
        amount,
        code,
        pin,
        resetToken,
        isNewAccount
    });

    try {
        const result = await sendMail({
            to,
            subject,
            html,
            logTag: 'Gift card recipient email'
        });
        if (!result.sent) {
            logger.info('Gift card recipient email (SMTP not configured):', { to, code: isDigital ? code : '(physical)' });
        }
        return result.sent;
    } catch (err) {
        logger.error('Gift card recipient email failed:', err);
        return false;
    }
}

async function sendGiftCardPurchaserConfirmation({ to, purchaserName, lines }) {
    const first = escapeHtml(String(purchaserName || '').trim() || 'there');
    const list = (lines || [])
        .map(
            (l) =>
                `<li style="margin-bottom:6px;font-family:${BRAND.font};font-size:15px;color:${BRAND.text};">${escapeHtml(l.cardType)} ${escapeHtml(`$${Number(l.amount).toFixed(2)}`)}${
                    l.recipientEmail ? ` → ${escapeHtml(l.recipientEmail)}` : ''
                }</li>`
        )
        .join('');

    const bodyHtml = `
        <h2 style="margin:0 0 12px;font-family:${BRAND.font};font-size:22px;font-weight:700;color:${BRAND.primary};">Gift card order confirmed</h2>
        <p style="margin:0 0 12px;font-family:${BRAND.font};font-size:16px;line-height:1.6;color:${BRAND.text};">Hello ${first},</p>
        <p style="margin:0 0 12px;font-family:${BRAND.font};font-size:16px;line-height:1.6;color:${BRAND.text};">Thank you for your gift card purchase:</p>
        <ul style="margin:0 0 16px;padding-left:20px;">${list}</ul>
        <p style="margin:0;font-family:${BRAND.font};font-size:15px;line-height:1.6;color:${BRAND.textMuted};">Digital cards are delivered by email. Physical cards are prepared for mailing.</p>`;

    const html = wrapHmHerbsEmail({
        headline: null,
        preheader: 'Your H&M Herbs gift card order is confirmed',
        bodyHtml
    });

    try {
        await sendMail({
            to,
            subject: 'H&M Herbs — gift card order confirmation',
            html,
            logTag: 'Gift card purchaser email'
        });
    } catch (err) {
        logger.error('Gift card purchaser email failed:', err);
    }
}

module.exports = {
    sendGiftCardRecipientEmail,
    sendGiftCardPurchaserConfirmation,
    GREETING_HEADLINES,
    BRAND,
    wrapHmHerbsEmail,
    buildStyledGiftEmailHtml
};
