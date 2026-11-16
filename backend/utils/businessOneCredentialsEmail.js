'use strict';

/**
 * Branded Business One merchant credentials / welcome email HTML.
 * Keep in sync with business-one-billing/utils/businessOneCredentialsEmail.js
 * and business-one-webpage/api/lib/mail.php (bo_merchant_credentials_email_html).
 *
 * Visual: Ops header brand — navy shell (--ink #0f172a), B1 logo mark, orange name, blue CTA.
 * CTA button: Merchant Portal only (pos…/admin.html), never Ops desk.
 */

const MERCHANT_ADMIN_DEFAULT = 'https://pos.businessonecomprehensive.com/admin.html';

const BRAND = {
    navy: '#0f172a',
    orange: '#ff9b1f',
    blue: '#1f82ff',
    blueBtn: '#1873e6',
    ink: '#0f172a',
    muted: '#475569',
    cardBorder: '#e2e8f0',
    panelBg: '#eff6ff',
    panelBorder: '#bfdbfe',
    // Same B1 mark as marketing admin.html header (logo-big.png)
    logoUrl: 'https://businessonecomprehensive.com/images/business-one/logo-big.png',
    siteUrl: 'https://businessonecomprehensive.com/',
    font: 'Segoe UI, Helvetica Neue, Arial, sans-serif',
    supportPhone: '(850) 290-2084'
};

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Merchant shop-admin login URL. Never returns marketing Ops desk
 * (https://businessonecomprehensive.com/admin.html — staff only).
 */
function resolveMerchantAdminLoginUrl(raw) {
    let url = String(raw || '').trim();
    if (!url) return MERCHANT_ADMIN_DEFAULT;
    try {
        const u = new URL(url);
        const host = String(u.hostname || '').toLowerCase();
        const path = String(u.pathname || '').replace(/\/+$/, '');
        const isOpsDesk =
            (host === 'businessonecomprehensive.com' || host === 'www.businessonecomprehensive.com') &&
            /(^|\/)admin\.html$/i.test(path);
        if (isOpsDesk) return MERCHANT_ADMIN_DEFAULT;
    } catch (_) {
        /* keep raw; normalize below */
    }
    if (!/admin\.html(\?|$)/i.test(url)) {
        url = `${url.replace(/\/+$/, '')}/admin.html`;
    }
    return url;
}

/**
 * @param {{
 *   businessName?: string,
 *   loginEmail?: string,
 *   password?: string,
 *   adminUrl?: string,
 *   introHtml?: string,
 *   extraHtml?: string
 * }} parts
 */
function buildMerchantCredentialsEmailHtml(parts = {}) {
    const businessName = String(parts.businessName || '').trim() || 'Your business';
    const loginEmail = String(parts.loginEmail || '').trim();
    const password = String(parts.password || '');
    const adminUrl = resolveMerchantAdminLoginUrl(parts.adminUrl || MERCHANT_ADMIN_DEFAULT);
    const introHtml = String(parts.introHtml || '');
    const extraHtml = String(parts.extraHtml || '');

    const eBiz = escapeHtml(businessName);
    const eEmail = escapeHtml(loginEmail);
    const ePass = escapeHtml(password);
    const eUrl = escapeHtml(adminUrl);

    let credsBlock = '';
    if (password || loginEmail) {
        credsBlock = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;background:${BRAND.panelBg};border:1px solid ${BRAND.panelBorder};border-radius:10px;">
  <tr><td style="padding:16px 18px;font-family:${BRAND.font};font-size:15px;line-height:1.55;color:${BRAND.ink};">
    ${
        loginEmail
            ? `<p style="margin:0 0 10px;"><strong style="color:${BRAND.ink};">Username (email)</strong><br>${eEmail}</p>`
            : ''
    }
    ${
        password
            ? `<p style="margin:0;"><strong style="color:${BRAND.ink};">Temporary password</strong><br>
         <span style="font-family:Consolas,Monaco,monospace;font-size:16px;letter-spacing:0.02em;">${ePass}</span></p>`
            : ''
    }
  </td></tr>
</table>`;
    }

    const cta = adminUrl
        ? `<p style="margin:0 0 18px;text-align:center;">
      <a href="${eUrl}" style="display:inline-block;background:${BRAND.blueBtn};color:#ffffff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;font-family:${BRAND.font};">Sign in to Merchant Portal</a>
    </p>`
        : '';

    const defaultIntro = `<p style="margin:0 0 14px;">Welcome — your shop account for <strong>${eBiz}</strong> is ready.</p>`;

    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.navy};margin:0;padding:28px 12px;font-family:${BRAND.font};">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:22px 22px 18px;background:${BRAND.navy};text-align:center;">
        <a href="${escapeHtml(BRAND.siteUrl)}" style="text-decoration:none;">
          <img src="${escapeHtml(BRAND.logoUrl)}" alt="Business One" width="72" height="79" style="display:block;margin:0 auto 12px;max-width:72px;height:auto;border:0;" />
          <p style="margin:0;font-family:${BRAND.font};font-size:22px;font-weight:700;letter-spacing:0.01em;color:${BRAND.orange};">Business One</p>
        </a>
        <p style="margin:8px 0 0;font-family:${BRAND.font};font-size:13px;font-weight:600;color:#cbd5e1;">Merchant Portal</p>
      </td></tr>
      <tr><td style="height:4px;background:${BRAND.blue};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:26px 24px 8px;font-family:${BRAND.font};font-size:16px;line-height:1.6;color:${BRAND.ink};">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.muted};">Merchant Portal</p>
        <p style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:${BRAND.ink};">Welcome</p>
        ${defaultIntro}
        ${introHtml}
        ${credsBlock}
        ${cta}
        ${
            password
                ? `<p style="margin:0 0 16px;font-size:14px;color:${BRAND.muted};">Please sign in and change your password after your first login.</p>`
                : ''
        }
        ${extraHtml}
      </td></tr>
      <tr><td style="padding:8px 24px 24px;font-family:${BRAND.font};font-size:13px;line-height:1.55;color:${BRAND.muted};text-align:center;border-top:1px solid ${BRAND.cardBorder};">
        <p style="margin:16px 0 0;">Questions? Call <strong style="color:${BRAND.ink};">${BRAND.supportPhone}</strong></p>
        <p style="margin:8px 0 0;">— Business One</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

module.exports = {
    BRAND,
    MERCHANT_ADMIN_DEFAULT,
    escapeHtml,
    resolveMerchantAdminLoginUrl,
    buildMerchantCredentialsEmailHtml
};
