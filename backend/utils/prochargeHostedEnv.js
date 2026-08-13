'use strict';

const { isProchargeSandbox } = require('./prochargeEnv');

function truthyEnv(name, defaultValue) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return defaultValue;
    }
    const v = String(raw).trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function getProchargeHostedTokenizerHost() {
    const explicit = String(process.env.PROCHARGE_HOSTED_TOKENIZER_HOST || '').trim();
    if (explicit) return explicit.replace(/^https?:\/\//, '').replace(/\/+$/, '');

    const site = String(process.env.PROCHARGE_CARDPOINTE_SITE || '').trim();
    if (site) return site.replace(/^https?:\/\//, '').replace(/\/+$/, '');

    return '';
}

function getProchargeHostedTokenizerPath() {
    const path = String(process.env.PROCHARGE_HOSTED_TOKENIZER_PATH || '/itoke/ajax-tokenizer.html').trim();
    if (!path.startsWith('/')) return `/${path}`;
    return path;
}

function getProchargeHostedTokenizerUrlOverride() {
    return String(process.env.PROCHARGE_HOSTED_TOKENIZER_URL || '').trim();
}

function defaultHostedTokenizerHost() {
    return isProchargeSandbox() ? 'fts-uat.cardconnect.com' : 'fts.cardconnect.com';
}

function isProchargeHostedTokenizerConfigured() {
    return Boolean(getProchargeHostedTokenizerHost() || getProchargeHostedTokenizerUrlOverride());
}

function isProchargeRequireHostedFields() {
    if (process.env.PROCHARGE_REQUIRE_HOSTED_FIELDS !== undefined) {
        return truthyEnv('PROCHARGE_REQUIRE_HOSTED_FIELDS', false);
    }
    return isProchargeHostedTokenizerConfigured();
}

function resolveHostedTokenizerHost() {
    return getProchargeHostedTokenizerHost() || defaultHostedTokenizerHost();
}

function buildHostedTokenizerCss() {
    // Match Business One contact-form inputs (styles.css .contact-form .form-group input).
    // Card Number is a full-width field. Expiration renders as two side-by-side
    // <select> elements (month, year) — CardConnect hardcodes an inline
    // margin-left:30px on the year select that we cannot override (their CSS parser
    // does not support ID/class selectors, only tag names). Percentage widths on the
    // selects leave too little slack to absorb that fixed 30px on realistic container
    // widths, so both dropdowns wrap onto separate lines instead of sitting side by
    // side. Fixed pixel widths avoid the math entirely and stay stable at any width.
    //
    // CVV only needs 4 digits, so it is pulled up onto the same row as the
    // expiration selects (via ID selectors, which CardConnect's sanitizer does
    // allow) and given a small fixed width instead of stretching full-width like
    // the card number field. The tokenizer markup hardcodes a <br> before/after
    // each label, which we hide so the CVV label + input can flow inline right
    // after the year select; it wraps to its own row automatically on narrow
    // containers since there's no room left on the expiration row.
    return [
        'body{margin:0;padding:0;font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif;background-color:transparent;}',
        'br{display:none;}',
        'label{font-size:14px;font-weight:500;color:#1f2937;display:block;margin:0 0 5px 0;}',
        'input{padding:12px 15px;border:1px solid #c8c8c8;border-radius:6px;font-size:14px;width:100%;box-sizing:border-box;background-color:#ffffff;color:#1f2937;margin-bottom:12px;}',
        'select{padding:10px 12px;border:1px solid #c8c8c8;border-radius:6px;font-size:14px;width:110px;display:inline-block;box-sizing:border-box;background-color:#ffffff;color:#1f2937;margin-bottom:12px;vertical-align:middle;}',
        '#cccvvlabel{display:inline-block;width:auto;margin:0 0 12px 14px;vertical-align:middle;}',
        '#cccvvfield{display:inline-block;width:80px !important;padding:12px 10px !important;margin-bottom:12px;vertical-align:middle;}',
        'input:focus,select:focus{outline:none;border-color:#1f82ff;}',
        '.error{color:#b91c1c;border-color:#b91c1c;}'
    ].join('');
}

function buildHostedTokenizerQuery(mode) {
    const params = new URLSearchParams();
    params.set('tokenizewheninactive', 'true');
    params.set('inactivityto', '2000');
    params.set('invalidinputevent', 'true');
    params.set('css', buildHostedTokenizerCss());

    if (mode === 'ach') {
        params.set('fullmobilekeyboard', 'true');
        params.set('useexpiry', 'false');
        params.set('usecvv', 'false');
    } else {
        params.set('useexpiry', 'true');
        params.set('usecvv', 'true');
        params.set('formatinput', 'true');
    }

    return params.toString();
}

function buildHostedTokenizerUrl(mode = 'card') {
    const override = getProchargeHostedTokenizerUrlOverride();
    const query = buildHostedTokenizerQuery(mode);

    if (override) {
        const sep = override.includes('?') ? '&' : '?';
        return `${override}${sep}${query}`;
    }

    const host = resolveHostedTokenizerHost();
    const path = getProchargeHostedTokenizerPath();
    return `https://${host}${path}?${query}`;
}

function getHostedMessageOrigin() {
    const override = getProchargeHostedTokenizerUrlOverride();
    if (override) {
        try {
            return new URL(override).origin;
        } catch {
            /* fall through */
        }
    }
    const host = resolveHostedTokenizerHost();
    return `https://${host}`;
}

function getHostedFieldsClientConfig() {
    const enabled = isProchargeHostedTokenizerConfigured();
    const required = isProchargeRequireHostedFields();
    const messageOrigin = getHostedMessageOrigin();

    return {
        enabled,
        required,
        ready: enabled,
        cardTokenizerUrl: enabled ? buildHostedTokenizerUrl('card') : '',
        achTokenizerUrl: enabled ? buildHostedTokenizerUrl('ach') : '',
        messageOrigin,
        achHint:
            'Enter routing and account numbers in one field, separated by a slash (e.g. 123456789/987654321).'
    };
}

module.exports = {
    getProchargeHostedTokenizerHost,
    getProchargeHostedTokenizerPath,
    getProchargeHostedTokenizerUrlOverride,
    isProchargeHostedTokenizerConfigured,
    isProchargeRequireHostedFields,
    buildHostedTokenizerUrl,
    getHostedMessageOrigin,
    getHostedFieldsClientConfig
};
