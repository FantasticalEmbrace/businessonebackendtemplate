/**
 * HM Herbs branded gift card markup — matches css/hm-gift-card.css and brand-tokens.css
 */
(function (global) {
    'use strict';

    const LOGO_SRC = 'images/HM%20Herb%20Logo.png';

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatAmount(amount) {
        const n = Number(amount);
        if (!Number.isFinite(n) || n <= 0) return null;
        return n % 1 === 0 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;
    }

    /**
     * @param {{ amount?: number, cardType?: 'digital'|'physical', compact?: boolean, code?: string, recipientName?: string }} opts
     */
    function markup(opts = {}) {
        const cardType = opts.cardType === 'physical' ? 'physical' : 'digital';
        const compact = Boolean(opts.compact);
        const amountText = formatAmount(opts.amount) || (compact ? '' : 'Select amount');
        const typeLabel = cardType === 'physical' ? 'Physical' : 'Digital';
        const ariaAmount = formatAmount(opts.amount) || 'amount not selected';
        const recipient = String(opts.recipientName || '').trim();

        const mods = [
            'hm-gift-card',
            cardType === 'physical' ? 'hm-gift-card--physical' : 'hm-gift-card--digital',
            compact ? 'hm-gift-card--compact' : ''
        ]
            .filter(Boolean)
            .join(' ');

        const recipientLine =
            recipient && !compact
                ? `<p class="hm-gift-card__recipient">For ${escapeHtml(recipient)}</p>`
                : '';

        const codeLine =
            opts.code && !compact
                ? `<p class="hm-gift-card__code" aria-label="Gift card code">${escapeHtml(opts.code)}</p>`
                : '';

        const amountBlock = amountText
            ? `<div class="hm-gift-card__amount-wrap">
                    <span class="hm-gift-card__amount-label">${compact ? '' : 'Gift card value'}</span>
                    <span class="hm-gift-card__amount">${escapeHtml(amountText)}</span>
               </div>`
            : '';

        const logoMarkup = `<img class="hm-gift-card__logo" src="${LOGO_SRC}" alt="" width="120" height="36" loading="lazy" data-skip-error-handling />`;

        return `<div class="${mods}" role="img" aria-label="${escapeHtml(typeLabel)} gift card ${escapeHtml(ariaAmount)}">
            <div class="hm-gift-card__pattern" aria-hidden="true"></div>
            <div class="hm-gift-card__shine" aria-hidden="true"></div>
            <div class="hm-gift-card__inner">
                <div class="hm-gift-card__header">
                    ${logoMarkup}
                    <span class="hm-gift-card__badge">${escapeHtml(typeLabel)}</span>
                </div>
                ${amountBlock}
                ${recipientLine}
                ${codeLine}
                <div class="hm-gift-card__footer">
                    <span class="hm-gift-card__brand">H&amp;M Herbs &amp; Vitamins</span>
                    ${compact ? '' : '<span class="hm-gift-card__tagline">Premium natural health since 1995</span>'}
                </div>
            </div>
        </div>`;
    }

    global.HmGiftCard = { markup, formatAmount, escapeHtml };
})(typeof window !== 'undefined' ? window : globalThis);
