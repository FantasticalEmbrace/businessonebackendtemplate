/**
 * Storefront toast notifications (cart added, errors, etc.)
 * Load on every customer page before visual-bug-fixes.js when possible.
 */
(function () {
    'use strict';

    const CART_ADDED_RE = /\badded to (?:your )?cart\b/i;
    const CART_ADDED_MESSAGE = 'Added to cart';
    let lastCartToastAt = 0;

    function getRegion() {
        let region = document.getElementById('hm-toast-region');
        if (!region) {
            region = document.createElement('div');
            region.id = 'hm-toast-region';
            region.className = 'hm-toast-region';
            region.setAttribute('aria-live', 'polite');
            region.setAttribute('role', 'region');
            region.setAttribute('aria-label', 'Notifications');
        }
        const root = document.body || document.documentElement;
        if (region.parentNode !== root) {
            root.appendChild(region);
        } else {
            root.appendChild(region);
        }
        return region;
    }

    function pulseCartBadge() {
        const app = window.hmHerbsApp || window.productsPage;
        if (app && typeof app.pulseCartBadge === 'function') {
            app.pulseCartBadge();
            return;
        }
        const cartToggle = document.querySelector('.cart-toggle');
        if (!cartToggle) return;
        cartToggle.classList.remove('cart-added-pulse');
        void cartToggle.offsetWidth;
        cartToggle.classList.add('cart-added-pulse');
        window.setTimeout(() => cartToggle.classList.remove('cart-added-pulse'), 900);
    }

    function closeToast(toast) {
        toast.classList.remove('hm-toast--visible');
        toast.style.opacity = '0';
        window.setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 280);
    }

    function revealToast(toast) {
        window.requestAnimationFrame(() => {
            toast.classList.add('hm-toast--visible');
            toast.style.opacity = '1';
            toast.style.visibility = 'visible';
        });
    }

    /**
     * @param {string} message
     * @param {'success'|'error'|'warning'|'info'} [type]
     * @param {{ durationMs?: number }} [opts]
     */
    function hmShowToast(message, type = 'info', opts = {}) {
        if (!message) return;

        const isCartAdded = type === 'success' && CART_ADDED_RE.test(message);
        if (isCartAdded) {
            const now = Date.now();
            if (now - lastCartToastAt < 600) return;
            lastCartToastAt = now;
            message = CART_ADDED_MESSAGE;
        }

        const region = getRegion();
        region.classList.toggle('hm-toast-region--cart', isCartAdded);

        const toast = document.createElement('div');
        toast.className = `hm-toast hm-toast--${type}`;
        toast.setAttribute('role', 'alert');
        toast.style.opacity = '0';

        const row = document.createElement('div');
        row.className = 'hm-toast__row';

        if (isCartAdded) {
            const icon = document.createElement('span');
            icon.className = 'hm-toast__cart-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = '\u2713';
            row.appendChild(icon);
        }

        const messageSpan = document.createElement('span');
        messageSpan.className = 'hm-toast__message';
        messageSpan.textContent = message;
        row.appendChild(messageSpan);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'hm-toast__close';
        closeBtn.setAttribute('aria-label', 'Close notification');
        closeBtn.textContent = '\u00d7';

        toast.appendChild(row);
        toast.appendChild(closeBtn);
        region.appendChild(toast);

        revealToast(toast);

        const durationMs =
            opts.durationMs != null ? opts.durationMs : type === 'error' ? 7000 : 5000;

        let timeoutId = window.setTimeout(() => closeToast(toast), durationMs);

        closeBtn.addEventListener('click', () => {
            window.clearTimeout(timeoutId);
            closeToast(toast);
        });

        if (isCartAdded) {
            pulseCartBadge();
            try {
                window.dispatchEvent(
                    new CustomEvent('hmherbs:cart-item-added', {
                        detail: {
                            message,
                            cart:
                                window.hmHerbsApp?.cart ||
                                window.productsPage?.cart ||
                                [],
                        },
                    })
                );
            } catch (_) {
                /* ignore */
            }
        }
    }

    window.hmShowToast = hmShowToast;
    window.hmPulseCartBadge = pulseCartBadge;
})();
