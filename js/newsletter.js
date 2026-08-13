// Newsletter Subscription Handler
class NewsletterSubscription {
    constructor() {
        this.form = document.getElementById('newsletter-form');
        this.emailInput = document.getElementById('newsletter-email');
        this.errorMessage = document.getElementById('newsletter-error');
        this.successMessage = document.getElementById('newsletter-success');
        this.submitButton = this.form?.querySelector('.newsletter-submit');
        this.submitText = this.submitButton?.querySelector('.submit-text');
        this.submitLoading = this.submitButton?.querySelector('.submit-loading');

        if (this.form) {
            this.init();
        }
    }

    init() {
        this.form.addEventListener('submit', (e) => this.handleSubmit(e));

        // Clear messages when user starts typing
        this.emailInput?.addEventListener('input', () => {
            this.hideMessages();
        });
    }

    async handleSubmit(e) {
        e.preventDefault();

        const email = this.emailInput.value.trim();

        // Validate email
        if (!this.isValidEmail(email)) {
            this.showError('Please enter a valid email address.');
            this.emailInput.focus();
            return;
        }

        // Show loading state
        this.setLoading(true);
        this.hideMessages();

        try {
            const apiBaseUrl =
                typeof window.hmHerbsStorefrontApiBase === 'function'
                    ? window.hmHerbsStorefrontApiBase()
                    : window.location.protocol === 'file:'
                      ? 'http://localhost:3001'
                      : (() => {
                            const h = window.location.hostname;
                            const isLoopback = h === 'localhost' || h === '127.0.0.1';
                            if (isLoopback && window.location.port && window.location.port !== '3001') {
                                return 'http://localhost:3001';
                            }
                            const explicit = String(window.HMHERBS_API_ORIGIN || '')
                                .trim()
                                .replace(/\/+$/, '');
                            return explicit || '';
                        })();

            // Use the default newsletter campaign (ID: 1) for 15% off offer
            const response = await fetch(`${apiBaseUrl}/api/email-campaign/subscribe`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: email,
                    campaign_id: 1 // Default newsletter campaign with 15% off
                })
            });

            const data = await response.json();

            if (response.ok) {
                // Success
                this.form.reset();

                // Show success message with offer code if available
                if (data.offer && data.offer.code) {
                    const expiryDate = data.offer.expires_at
                        ? new Date(data.offer.expires_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                        })
                        : '30 days';

                    this.showSuccess(
                        `🎉 ${data.message || 'Thank you for subscribing!'}<br><br>` +
                        `<strong style="font-size: 1.1em; color: var(--primary-green-light);">Your 15% Off Code:</strong><br>` +
                        `<span style="font-size: 1.3em; font-weight: bold; letter-spacing: 2px; color: var(--white);">${data.offer.code}</span><br><br>` +
                        `<small>Valid until ${expiryDate}. Use this code at checkout!</small>`,
                        true
                    );
                } else if (data.subscriber?.offer_code_sent) {
                    this.showSuccess(
                        `🎉 ${data.message || 'Thank you for subscribing!'}<br><br>` +
                        `<strong>Your offer code: ${data.subscriber.offer_code_sent}</strong>`,
                        true
                    );
                } else {
                    this.showSuccess(data.message || 'Thank you for subscribing! Check your email for confirmation.');
                }
            } else {
                // Error from server
                this.showError(data.error || 'Something went wrong. Please try again.');
            }
        } catch (error) {
            console.error('Newsletter subscription error:', error);
            this.showError('Unable to connect. Please check your connection and try again.');
        } finally {
            this.setLoading(false);
        }
    }

    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    showError(message) {
        this.hideMessages();
        if (this.errorMessage) {
            this.errorMessage.textContent = message;
            this.errorMessage.style.display = 'block';
            this.errorMessage.setAttribute('aria-live', 'assertive');
        }
    }

    showSuccess(message, isHtml = false) {
        this.hideMessages();
        if (this.successMessage) {
            if (isHtml) {
                this.successMessage.innerHTML = message;
            } else {
                this.successMessage.textContent = message;
            }
            this.successMessage.style.display = 'block';
        }
    }

    hideMessages() {
        if (this.errorMessage) {
            this.errorMessage.style.display = 'none';
            this.errorMessage.textContent = '';
        }
        if (this.successMessage) {
            this.successMessage.style.display = 'none';
            this.successMessage.textContent = '';
        }
    }

    setLoading(loading) {
        if (this.submitButton) {
            this.submitButton.disabled = loading;
        }
        if (this.submitText) {
            this.submitText.style.display = loading ? 'none' : 'inline';
        }
        if (this.submitLoading) {
            this.submitLoading.style.display = loading ? 'inline-block' : 'none';
        }
    }
}

// Initialize newsletter subscription when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new NewsletterSubscription();
    });
} else {
    new NewsletterSubscription();
}

