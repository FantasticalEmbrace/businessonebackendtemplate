/**
 * HM Herbs branded pre-prompt before the browser notification permission dialog.
 * The native browser prompt cannot be styled; this gives users HM Herbs context first.
 */
(function () {
    const AGE_KEY = 'hmherbs_age_verified_21';
    const AGE_EVENT = 'hmherbs:age-verified';
    const NEWSLETTER_DONE_EVENT = 'hmherbs:newsletter-popup-done';
    const LOGO_SRC = 'images/HM%20Herb%20Logo.png';

    function isAgeVerified() {
        try {
            return localStorage.getItem(AGE_KEY) === 'true';
        } catch (_) {
            return false;
        }
    }

    function whenAgeVerified(callback) {
        if (isAgeVerified()) {
            callback();
            return;
        }
        window.addEventListener(AGE_EVENT, callback, { once: true });
    }

    function whenNewsletterDone(callback) {
        if (window.__hmNewsletterPopupDone) {
            callback();
            return;
        }
        window.addEventListener(NEWSLETTER_DONE_EVENT, callback, { once: true });
    }

    function whenReadyForPrompt(callback) {
        whenAgeVerified(() => {
            whenNewsletterDone(() => {
                window.setTimeout(callback, 400);
            });
        });
    }

    /**
     * @returns {Promise<'granted'|'denied'|'default'>}
     */
    function showBrandedPrompt() {
        return new Promise((resolve) => {
            const root = document.createElement('div');
            root.className = 'hm-notify-perm';
            root.setAttribute('role', 'dialog');
            root.setAttribute('aria-modal', 'true');
            root.setAttribute('aria-labelledby', 'hm-notify-perm-title');

            root.innerHTML =
                '<div class="hm-notify-perm__dialog">' +
                '<div class="hm-notify-perm__brand">' +
                '<img class="hm-notify-perm__logo" src="' +
                LOGO_SRC +
                '" alt="H&amp;M Herbs &amp; Vitamins" width="176" height="40" loading="lazy">' +
                '<span class="hm-notify-perm__icon" aria-hidden="true"><i class="fas fa-bell"></i></span>' +
                '</div>' +
                '<h2 id="hm-notify-perm-title" class="hm-notify-perm__title">Stay in the loop</h2>' +
                '<p class="hm-notify-perm__text">Get gentle alerts for order updates, restocks, and exclusive wellness offers from HM Herbs.' +
                '<span class="hm-notify-perm__hint">Your browser will ask you to confirm — choose Allow to enable.</span></p>' +
                '<div class="hm-notify-perm__actions">' +
                '<button type="button" class="hm-notify-perm__allow" id="hm-notify-perm-allow">Enable notifications</button>' +
                '<button type="button" class="hm-notify-perm__dismiss" id="hm-notify-perm-dismiss">Not now</button>' +
                '</div></div>';

            document.body.appendChild(root);

            const close = (result) => {
                document.removeEventListener('keydown', onKey);
                root.classList.remove('is-visible');
                window.setTimeout(() => {
                    try {
                        root.remove();
                    } catch (_) {}
                    resolve(result);
                }, 240);
            };

            const allowBtn = root.querySelector('#hm-notify-perm-allow');
            const dismissBtn = root.querySelector('#hm-notify-perm-dismiss');

            allowBtn.addEventListener('click', () => close('granted-flow'));
            dismissBtn.addEventListener('click', () => close('default'));

            const onKey = (e) => {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', onKey);
                    close('default');
                }
            };
            document.addEventListener('keydown', onKey);

            root.addEventListener('click', (e) => {
                if (e.target === root) {
                    close('default');
                }
            });

            requestAnimationFrame(() => {
                root.classList.add('is-visible');
                try {
                    allowBtn.focus({ preventScroll: true });
                } catch (_) {}
            });
        });
    }

    /**
     * Show HM Herbs prompt, then the browser permission dialog if user accepts.
     * @returns {Promise<NotificationPermission>}
     */
    async function requestWithBrandedPrompt() {
        if (!('Notification' in window)) {
            return 'denied';
        }

        if (Notification.permission !== 'default') {
            return Notification.permission;
        }

        const choice = await showBrandedPrompt();
        if (choice === 'default') {
            return 'default';
        }

        try {
            return await Notification.requestPermission();
        } catch (_) {
            return Notification.permission;
        }
    }

    window.hmRequestNotificationPermission = requestWithBrandedPrompt;
    window.hmWhenReadyForNotificationPrompt = whenReadyForPrompt;
})();
