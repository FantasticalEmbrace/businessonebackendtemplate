/**
 * 21+ age gate: sets hmherbs_age_verified_21 and dispatches hmherbs:age-verified
 * (required by js/newsletter-popup.js). Load with defer before newsletter-popup.js.
 */
(function () {
    const STORAGE_KEY = 'hmherbs_age_verified_21';
    const EVENT_NAME = 'hmherbs:age-verified';

    function shouldSkipPage() {
        try {
            const p = (window.location.pathname || '').toLowerCase();
            if (/admin/i.test(p)) return true;
            if (p.includes('menu-admin')) return true;
        } catch (_) {}
        return false;
    }

    function isVerified() {
        try {
            return window.localStorage.getItem(STORAGE_KEY) === 'true';
        } catch (_) {
            return false;
        }
    }

    function persistVerified() {
        try {
            window.localStorage.setItem(STORAGE_KEY, 'true');
        } catch (_) {}
    }

    function notifyAgeVerified() {
        window.dispatchEvent(new CustomEvent(EVENT_NAME));
    }

    function isAgeGateOpen() {
        return !!document.querySelector('.hm-age-gate');
    }

    window.hmIsAgeGateOpen = isAgeGateOpen;

    function lockPageScroll() {
        document.documentElement.classList.add('hm-age-gate-open');
        document.body.classList.add('hm-age-gate-open');
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
    }

    function unlockPageScroll() {
        document.documentElement.classList.remove('hm-age-gate-open');
        document.body.classList.remove('hm-age-gate-open');
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
    }

    function pinViewportTop() {
        try {
            window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        } catch (_) {
            window.scrollTo(0, 0);
        }
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    }

    /**
     * @param {HTMLElement} root
     * @param {() => void} [afterRemoved]
     */
    function removeGate(root, afterRemoved) {
        if (!root || !root.parentNode) return;
        if (root._hmAgeKeyEsc) {
            document.removeEventListener('keydown', root._hmAgeKeyEsc);
            root._hmAgeKeyEsc = null;
        }
        if (root._hmAgeScrollPin) {
            window.removeEventListener('scroll', root._hmAgeScrollPin);
            root._hmAgeScrollPin = null;
        }
        root.classList.add('is-leaving');
        window.setTimeout(() => {
            try {
                root.parentNode.removeChild(root);
            } catch (_) {}
            unlockPageScroll();
            if (typeof afterRemoved === 'function') {
                afterRemoved();
            }
        }, 280);
    }

    function showGate() {
        const root = document.createElement('div');
        root.className = 'hm-age-gate';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-labelledby', 'hm-age-gate-title');
        root.setAttribute('tabindex', '-1');

        root.innerHTML =
            '<div class="hm-age-gate__dialog">' +
            '<div class="hm-age-gate__badge" aria-hidden="true">21+</div>' +
            '<h1 id="hm-age-gate-title" class="hm-age-gate__title">Age verification</h1>' +
            '<p class="hm-age-gate__text">This site offers age-restricted wellness products. ' +
            'You must be 21 or older to enter.</p>' +
            '<div class="hm-age-gate__actions">' +
            '<button type="button" class="hm-age-gate__confirm" id="hm-age-gate-enter">I am 21 or older</button>' +
            '<button type="button" class="hm-age-gate__exit" id="hm-age-gate-exit">I am under 21 — exit</button>' +
            '</div></div>';

        // Append as direct body child; scroll pin prevents focus from jumping the page.
        document.body.appendChild(root);

        lockPageScroll();
        pinViewportTop();
        root.scrollTop = 0;

        const onGateScrollPin = () => {
            if (window.scrollY > 0) {
                pinViewportTop();
            }
        };
        root._hmAgeScrollPin = onGateScrollPin;
        window.addEventListener('scroll', onGateScrollPin, { passive: true });

        const enter = root.querySelector('#hm-age-gate-enter');
        const exit = root.querySelector('#hm-age-gate-exit');

        enter.addEventListener('click', () => {
            persistVerified();
            pinViewportTop();
            removeGate(root, () => {
                pinViewportTop();
                notifyAgeVerified();
            });
        });

        exit.addEventListener('click', () => {
            window.location.href = 'https://www.google.com/';
        });

        const onKey = (e) => {
            if (e.key === 'Escape') {
                exit.click();
            }
        };
        root._hmAgeKeyEsc = onKey;
        document.addEventListener('keydown', onKey);

        window.requestAnimationFrame(() => {
            try {
                enter.focus({ preventScroll: true });
            } catch (_) {
                /* Skip focus fallback — unfocused scroll was jumping the page */
            }
        });
    }

    function run() {
        if (shouldSkipPage()) return;
        if (isVerified()) {
            unlockPageScroll();
            persistVerified();
            notifyAgeVerified();
            return;
        }
        pinViewportTop();
        showGate();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
})();
