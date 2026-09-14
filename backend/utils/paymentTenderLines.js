'use strict';

/**
 * Shared payment / tender line formatting for receipts, emails, and admin UI.
 * Accepts either camelCase (POS/normalizeTenderRow) or snake_case (DB rows).
 */

const TENDER_LABELS = {
    loyalty_cash: 'Store credit',
    loyalty_points: 'Loyalty points',
    gift_card: 'Gift card',
    cash: 'Cash',
    card_terminal: 'Card',
    credit_card: 'Card',
    debit_card: 'Card',
    check: 'Check',
    split: 'Split payment',
    nmi: 'Card',
    card: 'Card'
};

function money(amount) {
    const n = Number(amount);
    return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

function tenderType(t) {
    return String(t?.type || t?.tender_type || t?.tenderType || '').trim().toLowerCase();
}

function tenderAmount(t) {
    return Number(t?.amount) || 0;
}

function tenderPoints(t) {
    return Number(t?.loyaltyPoints ?? t?.loyalty_points ?? t?.points) || 0;
}

/**
 * Human-readable single tender line (no trailing period).
 * Examples:
 *   Store credit: $12.50
 *   Loyalty points: 500 pts ($5.00)
 *   Card: $40.00 (Visa •••• 4242)
 *   Check: $20.00 #1024
 *   Cash: $25.00 (tendered $30.00, change $5.00)
 */
function formatTenderLine(t) {
    if (!t) return '';
    const type = tenderType(t);
    const label = TENDER_LABELS[type] || type.replace(/_/g, ' ') || 'Payment';
    const amt = money(tenderAmount(t));

    if (type === 'loyalty_points') {
        const pts = tenderPoints(t);
        return pts > 0 ? `${label}: ${pts} pts ($${amt})` : `${label}: $${amt}`;
    }

    if (type === 'cash') {
        const tendered = t.cashTendered ?? t.cash_tendered;
        const change = t.cashChange ?? t.cash_change;
        let line = `${label}: $${amt}`;
        if (tendered != null && Number(tendered) > 0) {
            line += ` (tendered $${money(tendered)}`;
            if (Number(change) > 0) line += `, change $${money(change)}`;
            line += ')';
        }
        return line;
    }

    if (type === 'card_terminal' || type === 'credit_card' || type === 'debit_card' || type === 'card' || type === 'nmi') {
        const brand = String(t.terminalCardBrand || t.terminal_card_brand || '').trim();
        const last4 = String(t.terminalLastFour || t.terminal_last_four || '').replace(/\D/g, '').slice(-4);
        const auth = String(t.terminalAuthCode || t.terminal_auth_code || '').trim();
        let detail = '';
        if (brand && last4.length === 4) detail = `${brand} •••• ${last4}`;
        else if (last4.length === 4) detail = `•••• ${last4}`;
        else if (brand) detail = brand;
        if (auth) detail = detail ? `${detail}, auth ${auth}` : `auth ${auth}`;
        return detail ? `${label}: $${amt} (${detail})` : `${label}: $${amt}`;
    }

    if (type === 'check') {
        const num = String(t.checkNumber || t.check_number || '').trim();
        return num ? `${label}: $${amt} #${num}` : `${label}: $${amt}`;
    }

    if (type === 'gift_card') {
        const code = String(t.gift_card_code || t.giftCardCode || t.code || '').trim();
        const ref = String(t.payment_reference || t.paymentReference || '').trim();
        const display = code || (ref.length > 4 ? `••••${ref.slice(-4)}` : ref);
        return display ? `${label}: $${amt} (${display})` : `${label}: $${amt}`;
    }

    return `${label}: $${amt}`;
}

function formatTenderLines(tenders) {
    return (Array.isArray(tenders) ? tenders : [])
        .map((t) => formatTenderLine(t))
        .filter(Boolean);
}

function formatTenderLinesHtml(tenders, { escapeHtml } = {}) {
    const esc =
        typeof escapeHtml === 'function'
            ? escapeHtml
            : (s) =>
                  String(s || '')
                      .replace(/&/g, '&amp;')
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;')
                      .replace(/"/g, '&quot;');
    const lines = formatTenderLines(tenders);
    if (!lines.length) return '';
    return lines.map((line) => `<div>${esc(line)}</div>`).join('');
}

function paymentMethodLabel(method, tenders) {
    if (Array.isArray(tenders) && tenders.length > 1) return 'Split payment';
    if (Array.isArray(tenders) && tenders.length === 1) {
        return TENDER_LABELS[tenderType(tenders[0])] || formatTenderLine(tenders[0]).split(':')[0];
    }
    const key = String(method || '').trim().toLowerCase();
    return TENDER_LABELS[key] || (key ? key.replace(/_/g, ' ') : 'Paid');
}

module.exports = {
    TENDER_LABELS,
    formatTenderLine,
    formatTenderLines,
    formatTenderLinesHtml,
    paymentMethodLabel
};
