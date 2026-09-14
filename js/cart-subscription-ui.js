/**
 * Subscribe & Save (Amazon-style) helpers for cart lines and store capabilities.
 */
(function (global) {
    'use strict';

    const state = {
        productSubscriptions: false,
        subscriptionIntervals: [30, 60, 90],
    };

    function formatPrice(value) {
        const n = typeof value === 'string' ? parseFloat(value) : Number(value);
        return Number.isFinite(n) ? `$${n.toFixed(2)}` : '$0.00';
    }

    function formatInterval(days) {
        const d = Number(days) || 30;
        if (d === 30) return '30 days';
        if (d === 60) return '60 days';
        if (d === 90) return '90 days';
        return `${d} days`;
    }

    function isTruthyFlag(value) {
        return value === true || value === 1 || value === '1' || value === 'true';
    }

    function parseDiscountPercent(value) {
        const n = typeof value === 'string' ? parseFloat(value) : Number(value);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return Math.min(100, Math.round(n * 100) / 100);
    }

    function subscriptionPrice(basePrice, discountPercent) {
        const base = typeof basePrice === 'string' ? parseFloat(basePrice) : Number(basePrice);
        const pct = parseDiscountPercent(discountPercent);
        if (!Number.isFinite(base)) return 0;
        if (pct <= 0) return Math.round(base * 100) / 100;
        return Math.round(base * (1 - pct / 100) * 100) / 100;
    }

    function isEligibleProduct(productData) {
        if (!state.productSubscriptions || !productData || productData.giftCard) return false;
        return (
            isTruthyFlag(productData.subscriptionEligible) ||
            isTruthyFlag(productData.subscription_eligible)
        );
    }

    function isEligibleCartItem(item) {
        if (!state.productSubscriptions || !item || item.giftCard) return false;
        return isTruthyFlag(item.subscriptionEligible);
    }

    function applySubscriptionPrice(item) {
        if (!item || typeof item !== 'object') return item;
        const base = Number.isFinite(Number(item.basePrice)) ? Number(item.basePrice) : Number(item.price);
        if (!Number.isFinite(base)) return item;
        if (item.basePrice == null) item.basePrice = base;
        item.subscriptionDiscountPercent = parseDiscountPercent(
            item.subscriptionDiscountPercent ?? item.subscription_discount_percent
        );
        item.price =
            item.subscribe && isEligibleCartItem(item)
                ? subscriptionPrice(base, item.subscriptionDiscountPercent)
                : base;
        return item;
    }

    function normalizeCartItemSubscription(item) {
        if (!item || typeof item !== 'object') return item;
        if (!isEligibleCartItem(item)) {
            item.subscribe = false;
            return applySubscriptionPrice(item);
        }
        item.subscribe = Boolean(item.subscribe);
        const days = Number(item.subscriptionIntervalDays) || 30;
        item.subscriptionIntervalDays = state.subscriptionIntervals.includes(days)
            ? days
            : state.subscriptionIntervals[0] || 30;
        return applySubscriptionPrice(item);
    }

    function enrichCartPayload(productData) {
        const eligible = isEligibleProduct(productData);
        const defaultDays =
            Number(productData.subscriptionIntervalDays || productData.subscription_interval_days) || 30;
        const discountPercent = parseDiscountPercent(
            productData.subscriptionDiscountPercent ?? productData.subscription_discount_percent
        );
        return {
            subscriptionEligible: eligible,
            subscriptionIntervalDays: state.subscriptionIntervals.includes(defaultDays)
                ? defaultDays
                : state.subscriptionIntervals[0] || 30,
            subscriptionDiscountPercent: discountPercent,
            subscribe: eligible ? Boolean(productData.subscribe) : false,
        };
    }

    /**
     * Amazon-style Subscribe & Save block on the product detail page (near Add to Cart).
     * Returns current selection { subscribe, subscriptionIntervalDays } or null if hidden.
     */
    function renderPdpControls(productData, containerEl, { onChange, initial } = {}) {
        if (!containerEl) return null;

        containerEl.innerHTML = '';
        containerEl.hidden = true;
        containerEl.classList.remove('is-visible');

        if (!isEligibleProduct(productData)) return null;

        const discountPct = parseDiscountPercent(
            productData.subscriptionDiscountPercent ?? productData.subscription_discount_percent
        );
        const defaultDays =
            Number(
                (initial && initial.subscriptionIntervalDays) ||
                    productData.subscriptionIntervalDays ||
                    productData.subscription_interval_days
            ) || 30;
        const intervalDays = state.subscriptionIntervals.includes(defaultDays)
            ? defaultDays
            : state.subscriptionIntervals[0] || 30;
        const subscribeOn = Boolean(initial && initial.subscribe);

        const wrap = document.createElement('div');
        wrap.className = 'product-subscription-box hm-choice-skip';

        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'product-subscription-toggle';
        toggleLabel.setAttribute('for', 'pdp-subscribe-toggle');

        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.id = 'pdp-subscribe-toggle';
        toggle.checked = subscribeOn;
        toggle.setAttribute('aria-label', 'Subscribe and Save');

        const toggleText = document.createElement('span');
        toggleText.className = 'product-subscription-toggle-text';
        toggleText.textContent =
            discountPct > 0 ? `Subscribe & Save (${discountPct}% off)` : 'Subscribe & Save';

        toggleLabel.appendChild(toggle);
        toggleLabel.appendChild(toggleText);

        const hint = document.createElement('p');
        hint.className = 'product-subscription-hint';
        hint.textContent = 'Get automatic deliveries. Cancel anytime from your account.';

        const freqRow = document.createElement('div');
        freqRow.className = 'product-subscription-frequency';

        const freqLabel = document.createElement('label');
        freqLabel.textContent = 'Deliver every:';
        freqLabel.setAttribute('for', 'pdp-subscribe-interval');

        const freqSelect = document.createElement('select');
        freqSelect.id = 'pdp-subscribe-interval';
        freqSelect.className = 'product-subscription-select';
        state.subscriptionIntervals.forEach((days) => {
            const opt = document.createElement('option');
            opt.value = String(days);
            opt.textContent = formatInterval(days);
            if (days === intervalDays) opt.selected = true;
            freqSelect.appendChild(opt);
        });

        freqRow.appendChild(freqLabel);
        freqRow.appendChild(freqSelect);

        const sync = () => {
            freqRow.hidden = !toggle.checked;
            const selection = {
                subscribe: toggle.checked,
                subscriptionIntervalDays: Number(freqSelect.value) || 30,
            };
            if (typeof onChange === 'function') onChange(selection);
            return selection;
        };

        toggle.addEventListener('change', sync);
        freqSelect.addEventListener('change', sync);

        wrap.appendChild(toggleLabel);
        wrap.appendChild(hint);
        wrap.appendChild(freqRow);
        containerEl.appendChild(wrap);
        containerEl.hidden = false;
        containerEl.classList.add('is-visible');

        return sync();
    }

    function resolveStorefrontApiBase(apiBaseUrl) {
        if (apiBaseUrl) return String(apiBaseUrl).replace(/\/+$/, '');
        // Same helpers used elsewhere in BO storefront (customer-auth / product-search-utils).
        if (typeof global.hmHerbsStorefrontApiBase === 'function') {
            return String(global.hmHerbsStorefrontApiBase() || '')
                .trim()
                .replace(/\/+$/, '');
        }
        if (typeof global.hmGetStorefrontApiBase === 'function') {
            return String(global.hmGetStorefrontApiBase() || '')
                .trim()
                .replace(/\/+$/, '');
        }
        return '';
    }

    async function loadCapabilities(apiBaseUrl) {
        const base = resolveStorefrontApiBase(apiBaseUrl);
        try {
            const res = await fetch(`${base}/api/store/capabilities`);
            if (!res.ok) return state;
            const data = await res.json();
            state.productSubscriptions = Boolean(data.productSubscriptions);
            state.subscriptionIntervals = Array.isArray(data.subscriptionIntervals)
                ? data.subscriptionIntervals
                : [30, 60, 90];
        } catch (_) {
            /* optional */
        }
        return state;
    }

    function renderCartLineControls(item, detailsEl, { onUpdate } = {}) {
        if (!detailsEl || !isEligibleCartItem(item)) return;

        normalizeCartItemSubscription(item);

        const wrap = document.createElement('div');
        wrap.className = 'cart-item-subscription hm-choice-skip';

        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'cart-item-subscription-toggle';

        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = Boolean(item.subscribe);
        toggle.setAttribute('aria-label', `Subscribe and Save for ${item.name || 'this item'}`);

        const toggleText = document.createElement('span');
        const discountPct = parseDiscountPercent(item.subscriptionDiscountPercent);
        toggleText.textContent = discountPct > 0 ? `Subscribe & Save (${discountPct}% off)` : 'Subscribe & Save';

        toggleLabel.appendChild(toggle);
        toggleLabel.appendChild(toggleText);

        const freqRow = document.createElement('div');
        freqRow.className = 'cart-item-subscription-frequency';

        const freqLabel = document.createElement('label');
        freqLabel.textContent = 'Deliver every:';
        freqLabel.setAttribute('for', `cart-sub-interval-${item.id}-${item.variant_id || 'base'}`);

        const freqSelect = document.createElement('select');
        freqSelect.id = freqLabel.htmlFor;
        freqSelect.className = 'cart-item-subscription-select';
        state.subscriptionIntervals.forEach((days) => {
            const opt = document.createElement('option');
            opt.value = String(days);
            opt.textContent = formatInterval(days);
            if (Number(item.subscriptionIntervalDays) === days) opt.selected = true;
            freqSelect.appendChild(opt);
        });

        freqRow.appendChild(freqLabel);
        freqRow.appendChild(freqSelect);

        const syncDisabled = () => {
            freqRow.hidden = !toggle.checked;
        };
        syncDisabled();

        const notify = (patch) => {
            Object.assign(item, patch);
            normalizeCartItemSubscription(item);
            if (typeof onUpdate === 'function') onUpdate(item);
        };

        toggle.addEventListener('change', () => {
            notify({ subscribe: toggle.checked });
            syncDisabled();
        });

        freqSelect.addEventListener('change', () => {
            notify({ subscriptionIntervalDays: Number(freqSelect.value) || 30 });
        });

        wrap.appendChild(toggleLabel);
        wrap.appendChild(freqRow);
        detailsEl.appendChild(wrap);
    }

    const api = {
        loadCapabilities,
        getCapabilities: () => ({ ...state }),
        formatInterval,
        formatPrice,
        parseDiscountPercent,
        subscriptionPrice,
        isEligibleProduct,
        isEligibleCartItem,
        normalizeCartItemSubscription,
        applySubscriptionPrice,
        enrichCartPayload,
        renderCartLineControls,
        renderPdpControls,
    };

    // Primary BO name; HmCartSubscription kept as alias for shared HM-origin call sites.
    global.BoCartSubscription = api;
    global.HmCartSubscription = api;
})(window);
