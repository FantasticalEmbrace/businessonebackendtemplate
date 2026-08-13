// Newsletter Signup Popup — links to Mailchimp landing page (no on-site email capture)
// Only shows once per user (tracked via localStorage)
// Does not run until 21+ age verification has passed (see js/age-gate.js).

const HMHERBS_MAILCHIMP_SIGNUP_URL =
    'https://mailchi.mp/7cd1b02d1358/subscribe-to-newsletter';

const HMHERBS_AGE_VERIFIED_KEY = 'hmherbs_age_verified_21';
const HMHERBS_NEWSLETTER_DONE_EVENT = 'hmherbs:newsletter-popup-done';

function notifyNewsletterPopupDone() {
    if (window.__hmNewsletterPopupDone) return;
    window.__hmNewsletterPopupDone = true;
    window.dispatchEvent(new CustomEvent(HMHERBS_NEWSLETTER_DONE_EVENT));
}

class NewsletterPopup {
    constructor() {
        this.storageKey = 'hmherbs_newsletter_popup_shown';
        /** Already verified before this page load — short wait so the page can paint */
        this.popupDelay = 1200;
        /** After age gate is fully removed (see age-gate.js removeGate timeout) */
        this.popupDelayAfterAgeVerify = 320;
        this.init();
    }

    isAgeVerified() {
        try {
            return localStorage.getItem(HMHERBS_AGE_VERIFIED_KEY) === 'true';
        } catch (e) {
            return false;
        }
    }

    /**
     * Newsletter must not appear until age gate is accepted (or prior session verified).
     * @param {(delayMs: number) => void} callback — receives delay before showPopup
     */
    whenAgeVerified(callback) {
        if (this.isAgeVerified()) {
            callback(this.popupDelay);
            return;
        }
        window.addEventListener(
            'hmherbs:age-verified',
            () => callback(this.popupDelayAfterAgeVerify),
            { once: true }
        );
    }

    init() {
        // Check if popup has already been shown
        if (this.hasBeenShown()) {
            notifyNewsletterPopupDone();
            return;
        }

        const schedulePopup = (delayMs) => {
            if (this.hasBeenShown()) {
                return;
            }
            setTimeout(() => this.showPopup(), delayMs);
        };

        const afterDomReady = () => {
            this.whenAgeVerified((delayMs) => schedulePopup(delayMs));
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', afterDomReady);
        } else {
            afterDomReady();
        }
    }

    hasBeenShown() {
        return localStorage.getItem(this.storageKey) === 'true';
    }

    markAsShown() {
        localStorage.setItem(this.storageKey, 'true');
    }

    showPopup() {
        // Don't show if already shown or if user is on admin page
        if (this.hasBeenShown() || window.location.pathname.includes('admin')) {
            notifyNewsletterPopupDone();
            return;
        }

        try {
            window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        } catch (e) {
            window.scrollTo(0, 0);
        }

        // Create popup HTML
        const popup = document.createElement('div');
        popup.className = 'newsletter-popup';
        popup.id = 'newsletter-popup';
        popup.setAttribute('role', 'dialog');
        popup.setAttribute('aria-labelledby', 'newsletter-popup-title');
        popup.setAttribute('aria-modal', 'true');
        
        const signupUrl = HMHERBS_MAILCHIMP_SIGNUP_URL;
        popup.innerHTML = `
            <div class="newsletter-popup-overlay"></div>
            <div class="newsletter-popup-content">
                <div class="newsletter-popup-body">
                    <div class="newsletter-popup-icon">
                        <i class="fas fa-envelope-open-text" aria-hidden="true"></i>
                    </div>
                    <h2 id="newsletter-popup-title" class="newsletter-popup-title">
                        Sign up for Exclusive Discounts
                    </h2>
                    <div class="newsletter-popup-form">
                        <div class="newsletter-popup-input-group" style="flex-direction: column; align-items: stretch;">
                            <a
                                href="${signupUrl}"
                                class="btn btn-primary newsletter-popup-mailchimp"
                                id="newsletter-popup-mailchimp-link"
                                target="_blank"
                                rel="noopener noreferrer">
                                Sign up for Exclusive Discounts
                            </a>
                        </div>
                    </div>
                    <button class="newsletter-popup-skip" id="newsletter-popup-skip">
                        No thanks, maybe later
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(popup);

        // Show popup with animation
        requestAnimationFrame(() => {
            popup.classList.add('show');
        });

        // Setup event listeners
        this.setupEventListeners(popup);
    }

    setupEventListeners(popup) {
        const skipBtn = popup.querySelector('#newsletter-popup-skip');
        const overlay = popup.querySelector('.newsletter-popup-overlay');
        const mailchimpLink = popup.querySelector('#newsletter-popup-mailchimp-link');

        // Skip button
        skipBtn.addEventListener('click', () => this.closePopup(popup));

        // Overlay click
        overlay.addEventListener('click', () => this.closePopup(popup));

        // Opens Mailchimp in a new tab; dismiss popup shortly after click
        if (mailchimpLink) {
            mailchimpLink.addEventListener('click', () => {
                setTimeout(() => this.closePopup(popup), 400);
            });
        }

        // Escape key — keep a reference so we can detach on close. Without
        // this every newsletter open stacked another listener that fired
        // forever afterwards.
        const escHandler = (e) => {
            if (e.key === 'Escape' && popup.classList.contains('show')) {
                this.closePopup(popup);
            }
        };
        document.addEventListener('keydown', escHandler);
        popup._escHandler = escHandler;
    }

    closePopup(popup) {
        popup.classList.remove('show');
        popup.style.pointerEvents = 'none';
        this.markAsShown();

        // Detach the escape-key listener so it doesn't keep firing for
        // future popups (or trigger errors after the popup is removed).
        if (popup._escHandler) {
            document.removeEventListener('keydown', popup._escHandler);
            popup._escHandler = null;
        }

        // Remove from DOM after animation
        setTimeout(() => {
            if (popup.parentNode) {
                popup.parentNode.removeChild(popup);
            }
            notifyNewsletterPopupDone();
        }, 300);
    }
}

// Initialize newsletter popup
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new NewsletterPopup();
    });
} else {
    new NewsletterPopup();
}

