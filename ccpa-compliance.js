// H&M Herbs & Vitamins - CCPA Compliance
// California Consumer Privacy Act (CCPA) compliance functionality

const CCPA_CLOSE_ICON_SVG = '<svg class="cart-close-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/></svg>';

class CCPACompliance {
    constructor() {
        this.ccpaPreferences = this.loadCCPAPreferences();
        this.eventListeners = []; // Track event listeners for cleanup
        this.init();
    }

    init() {
        this.setupCCPABanner();
        this.setupEventListeners();
        this.checkCCPACompliance();
    }

    // Helper method to create modal structure safely
    createModal(id, titleId, title, bodyContent) {
        const modal = document.createElement('div');
        modal.id = id;
        modal.className = 'modal ccpa-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-labelledby', titleId);

        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';

        const modalHeader = document.createElement('div');
        modalHeader.className = 'modal-header';

        const modalTitle = document.createElement('h2');
        modalTitle.id = titleId;
        modalTitle.textContent = title;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close';
        closeBtn.setAttribute('aria-label', 'Close modal');
        closeBtn.innerHTML = CCPA_CLOSE_ICON_SVG;

        modalHeader.appendChild(modalTitle);
        modalHeader.appendChild(closeBtn);

        const modalBody = document.createElement('div');
        modalBody.className = 'modal-body';
        modalBody.appendChild(bodyContent);

        modalContent.appendChild(modalHeader);
        modalContent.appendChild(modalBody);
        modal.appendChild(modalContent);

        return modal;
    }

    // Helper method to add event listeners with tracking
    addEventListenerWithCleanup(element, event, handler, options = false) {
        if (element) {
            element.addEventListener(event, handler, options);
            this.eventListeners.push({ element, event, handler, options });
        }
    }

    // Cleanup method to remove all tracked event listeners
    cleanup() {
        this.eventListeners.forEach(({ element, event, handler, options }) => {
            try {
                element.removeEventListener(event, handler, options);
            } catch (error) {
                console.warn('Error removing CCPA event listener:', error);
            }
        });
        this.eventListeners = [];
    }

    // Helper method to remove modal-specific listeners
    removeModalListeners(modal) {
        if (modal._ccpaListeners) {
            modal._ccpaListeners.forEach(({ element, event, handler }) => {
                try {
                    if (element) {
                        element.removeEventListener(event, handler);
                        // Also remove from main tracking array
                        const index = this.eventListeners.findIndex(
                            listener => listener.element === element && 
                                       listener.event === event && 
                                       listener.handler === handler
                        );
                        if (index > -1) {
                            this.eventListeners.splice(index, 1);
                        }
                    }
                } catch (error) {
                    console.warn('Error removing modal event listener:', error);
                }
            });
            modal._ccpaListeners = [];
        }
    }

    loadCCPAPreferences() {
        try {
            const stored = localStorage.getItem('hmherbs_ccpa_preferences');
            return stored ? JSON.parse(stored) : {
                doNotSell: false,
                optOut: false,
                acknowledged: false,
                timestamp: null
            };
        } catch (error) {
            if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') {
                console.error('Error loading CCPA preferences:', error);
            }
            return {
                doNotSell: false,
                optOut: false,
                acknowledged: false,
                timestamp: null
            };
        }
    }

    saveCCPAPreferences() {
        try {
            this.ccpaPreferences.timestamp = new Date().toISOString();
            localStorage.setItem('hmherbs_ccpa_preferences', JSON.stringify(this.ccpaPreferences));
        } catch (error) {
            if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') {
                console.error('Error saving CCPA preferences:', error);
            }
        }
    }

    setupCCPABanner() {
        // Check if user is in California (simplified check)
        const isCaliforniaUser = this.detectCaliforniaUser();
        
        if (!isCaliforniaUser || this.ccpaPreferences.acknowledged) {
            return;
        }

        const banner = document.createElement('div');
        banner.id = 'ccpa-banner';
        banner.className = 'ccpa-banner';
        banner.setAttribute('role', 'dialog');
        banner.setAttribute('aria-labelledby', 'ccpa-banner-title');
        // Create banner content safely
        const bannerContent = document.createElement('div');
        bannerContent.className = 'ccpa-banner-content';
        
        const title = document.createElement('h3');
        title.id = 'ccpa-banner-title';
        title.textContent = 'Your California Privacy Rights';
        
        const description = document.createElement('p');
        description.textContent = 'As a California resident, you have the right to know what personal information we collect, use, and share. You also have the right to request deletion of your personal information and to opt-out of the sale of your personal information.';
        
        const actions = document.createElement('div');
        actions.className = 'ccpa-banner-actions';
        
        const doNotSellBtn = document.createElement('button');
        doNotSellBtn.id = 'ccpa-do-not-sell';
        doNotSellBtn.className = 'btn btn-primary';
        doNotSellBtn.textContent = 'Do Not Sell My Personal Information';
        
        const rightsBtn = document.createElement('button');
        rightsBtn.id = 'ccpa-privacy-rights';
        rightsBtn.className = 'btn btn-secondary';
        rightsBtn.textContent = 'Learn About Your Rights';
        
        const acknowledgeBtn = document.createElement('button');
        acknowledgeBtn.id = 'ccpa-acknowledge';
        acknowledgeBtn.className = 'btn btn-outline';
        acknowledgeBtn.textContent = 'I Understand';
        
        actions.appendChild(doNotSellBtn);
        actions.appendChild(rightsBtn);
        actions.appendChild(acknowledgeBtn);
        
        bannerContent.appendChild(title);
        bannerContent.appendChild(description);
        bannerContent.appendChild(actions);
        
        banner.appendChild(bannerContent);

        document.body.appendChild(banner);
        
        // Show banner with animation
        setTimeout(() => {
            banner.classList.add('show');
        }, 100);
    }

    setupEventListeners() {
        // Do Not Sell button
        const doNotSellBtn = document.getElementById('ccpa-do-not-sell');
        if (doNotSellBtn) {
            this.addEventListenerWithCleanup(doNotSellBtn, 'click', () => {
                this.handleDoNotSell();
            });
        }

        // Privacy Rights button
        const privacyRightsBtn = document.getElementById('ccpa-privacy-rights');
        if (privacyRightsBtn) {
            this.addEventListenerWithCleanup(privacyRightsBtn, 'click', () => {
                this.showPrivacyRights();
            });
        }

        // Acknowledge button
        const acknowledgeBtn = document.getElementById('ccpa-acknowledge');
        if (acknowledgeBtn) {
            this.addEventListenerWithCleanup(acknowledgeBtn, 'click', () => {
                this.acknowledgeCCPA();
            });
        }

        // Handle "Do Not Sell" links in footer or privacy policy
        this.addEventListenerWithCleanup(document, 'click', (e) => {
            if (e.target.matches('[data-ccpa-action="do-not-sell"]')) {
                e.preventDefault();
                this.handleDoNotSell();
            }
        });
    }

    detectCaliforniaUser() {
        // Simplified detection - in production, use proper geolocation or IP detection
        // This is a basic implementation for demonstration
        try {
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const californiaTimezones = ['America/Los_Angeles', 'America/San_Francisco'];
            return californiaTimezones.includes(timezone);
        } catch (error) {
            // Fallback: assume California user if detection fails (better safe than sorry)
            return true;
        }
    }

    handleDoNotSell() {
        this.ccpaPreferences.doNotSell = true;
        this.ccpaPreferences.acknowledged = true;
        this.saveCCPAPreferences();
        
        // Remove tracking scripts or disable data collection
        this.disableDataCollection();
        
        // Show confirmation
        this.showNotification('Your "Do Not Sell" preference has been saved. We will not sell your personal information.', 'success');
        
        // Hide banner
        this.hideCCPABanner();
    }

    showPrivacyRights() {
        // Create modal body content
        const bodyContent = document.createDocumentFragment();
        
        // Right to Know section
        const knowTitle = document.createElement('h3');
        knowTitle.textContent = 'Right to Know';
        const knowDesc = document.createElement('p');
        knowDesc.textContent = 'You have the right to request information about the personal information we collect, use, and share.';
        
        // Right to Delete section
        const deleteTitle = document.createElement('h3');
        deleteTitle.textContent = 'Right to Delete';
        const deleteDesc = document.createElement('p');
        deleteDesc.textContent = 'You have the right to request deletion of your personal information, subject to certain exceptions.';
        
        // Right to Opt-Out section
        const optOutTitle = document.createElement('h3');
        optOutTitle.textContent = 'Right to Opt-Out';
        const optOutDesc = document.createElement('p');
        optOutDesc.textContent = 'You have the right to opt-out of the sale of your personal information.';
        
        // Right to Non-Discrimination section
        const nonDiscrimTitle = document.createElement('h3');
        nonDiscrimTitle.textContent = 'Right to Non-Discrimination';
        const nonDiscrimDesc = document.createElement('p');
        nonDiscrimDesc.textContent = 'We will not discriminate against you for exercising your CCPA rights.';
        
        // Action buttons
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'ccpa-actions';
        
        const requestInfoBtn = document.createElement('button');
        requestInfoBtn.id = 'ccpa-request-info';
        requestInfoBtn.className = 'btn btn-primary';
        requestInfoBtn.textContent = 'Request My Information';
        
        const deleteDataBtn = document.createElement('button');
        deleteDataBtn.id = 'ccpa-delete-data';
        deleteDataBtn.className = 'btn btn-secondary';
        deleteDataBtn.textContent = 'Delete My Data';
        
        const optOutBtn = document.createElement('button');
        optOutBtn.id = 'ccpa-opt-out';
        optOutBtn.className = 'btn btn-outline';
        optOutBtn.textContent = 'Opt-Out of Sale';
        
        actionsDiv.appendChild(requestInfoBtn);
        actionsDiv.appendChild(deleteDataBtn);
        actionsDiv.appendChild(optOutBtn);
        
        // Assemble body content
        bodyContent.appendChild(knowTitle);
        bodyContent.appendChild(knowDesc);
        bodyContent.appendChild(deleteTitle);
        bodyContent.appendChild(deleteDesc);
        bodyContent.appendChild(optOutTitle);
        bodyContent.appendChild(optOutDesc);
        bodyContent.appendChild(nonDiscrimTitle);
        bodyContent.appendChild(nonDiscrimDesc);
        bodyContent.appendChild(actionsDiv);
        
        // Create modal using helper method
        const modal = this.createModal('ccpa-rights-modal', 'ccpa-rights-title', 'Your California Privacy Rights (CCPA)', bodyContent);

        document.body.appendChild(modal);
        modal.style.display = 'block';

        // Event listeners for modal with cleanup tracking
        const closeHandler = () => {
            this.removeModalListeners(modal);
            document.body.removeChild(modal);
        };

        const clickHandler = (e) => {
            if (e.target === modal) {
                this.removeModalListeners(modal);
                document.body.removeChild(modal);
            }
        };

        const requestInfoHandler = () => {
            this.handleDataRequest();
        };

        const deleteDataHandler = () => {
            this.handleDataDeletion();
        };

        const optOutHandler = () => {
            this.handleDoNotSell();
            this.removeModalListeners(modal);
            document.body.removeChild(modal);
        };

        // Add tracked event listeners
        this.addEventListenerWithCleanup(modal.querySelector('.modal-close'), 'click', closeHandler);
        this.addEventListenerWithCleanup(modal, 'click', clickHandler);
        this.addEventListenerWithCleanup(modal.querySelector('#ccpa-request-info'), 'click', requestInfoHandler);
        this.addEventListenerWithCleanup(modal.querySelector('#ccpa-delete-data'), 'click', deleteDataHandler);
        this.addEventListenerWithCleanup(modal.querySelector('#ccpa-opt-out'), 'click', optOutHandler);

        // Store modal reference for cleanup
        modal._ccpaListeners = [
            { element: modal.querySelector('.modal-close'), event: 'click', handler: closeHandler },
            { element: modal, event: 'click', handler: clickHandler },
            { element: modal.querySelector('#ccpa-request-info'), event: 'click', handler: requestInfoHandler },
            { element: modal.querySelector('#ccpa-delete-data'), event: 'click', handler: deleteDataHandler },
            { element: modal.querySelector('#ccpa-opt-out'), event: 'click', handler: optOutHandler }
        ];
    }

    acknowledgeCCPA() {
        this.ccpaPreferences.acknowledged = true;
        this.saveCCPAPreferences();
        this.hideCCPABanner();
    }

    hideCCPABanner() {
        const banner = document.getElementById('ccpa-banner');
        if (banner) {
            banner.remove();
        }
    }

    disableDataCollection() {
        // Disable Google Analytics or other tracking
        if (typeof window.gtag !== 'undefined') {
            window.gtag('consent', 'update', {
                'analytics_storage': 'denied',
                'ad_storage': 'denied'
            });
        }

        // Disable other tracking scripts
        this.disableThirdPartyTracking();
    }

    disableThirdPartyTracking() {
        // Remove or disable third-party tracking scripts
        const trackingScripts = document.querySelectorAll('script[src*="google-analytics"], script[src*="googletagmanager"], script[src*="facebook"]');
        trackingScripts.forEach(script => {
            script.remove();
        });
    }

    handleDataRequest() {
        // Use secure modal dialog instead of prompt() to prevent XSS
        this.showEmailInputModal(
            'Data Request',
            'Please enter your email address to receive your data:',
            (email) => {
                if (email && this.validateEmail(email)) {
                    this.showNotification('Your data request has been submitted. You will receive your information within 45 days.', 'info');
                    // Send request to backend
                    this.submitDataRequest(email);
                }
            }
        );
    }

    handleDataDeletion() {
        // Use secure modal dialog instead of confirm() and prompt() to prevent XSS
        this.showConfirmationModal(
            'Delete All Data',
            'Are you sure you want to delete all your personal data? This action cannot be undone.',
            () => {
                this.showEmailInputModal(
                    'Confirm Data Deletion',
                    'Please enter your email address to confirm deletion:',
                    (email) => {
                        if (email && this.validateEmail(email)) {
                            this.showNotification('Your data deletion request has been submitted. Your data will be deleted within 45 days.', 'info');
                            // Send deletion request to backend
                            this.submitDataDeletion(email);
                        }
                    }
                );
            }
        );
    }

    submitDataRequest(email) {
        // In production, send to backend API
        if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') {
            console.log('CCPA Data Request submitted for:', email);
        }
        // fetch('/api/ccpa/data-request', { method: 'POST', body: JSON.stringify({ email }) });
    }

    submitDataDeletion(email) {
        // In production, send to backend API
        if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') {
            console.log('CCPA Data Deletion submitted for:', email);
        }
        // fetch('/api/ccpa/data-deletion', { method: 'POST', body: JSON.stringify({ email }) });
    }

    // Secure modal dialog methods to replace prompt() and confirm()
    showEmailInputModal(title, message, callback) {
        const modal = document.createElement('div');
        modal.className = 'ccpa-modal-overlay';
        
        // Create modal structure safely
        const modalDiv = document.createElement('div');
        modalDiv.className = 'ccpa-modal';
        
        // Header
        const header = document.createElement('div');
        header.className = 'ccpa-modal-header';
        
        const titleEl = document.createElement('h3');
        titleEl.textContent = title;
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'ccpa-modal-close';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.innerHTML = CCPA_CLOSE_ICON_SVG;
        
        header.appendChild(titleEl);
        header.appendChild(closeBtn);
        
        // Body
        const body = document.createElement('div');
        body.className = 'ccpa-modal-body';
        
        const messageEl = document.createElement('p');
        messageEl.textContent = message;
        
        const emailInput = document.createElement('input');
        emailInput.type = 'email';
        emailInput.id = 'ccpa-email-input';
        emailInput.setAttribute('autocomplete', 'email');
        emailInput.placeholder = 'Enter your email address';
        emailInput.required = true;
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'ccpa-modal-error';
        errorDiv.id = 'ccpa-email-error';
        errorDiv.style.display = 'none';
        errorDiv.style.color = 'red';
        errorDiv.style.marginTop = '10px';
        
        body.appendChild(messageEl);
        body.appendChild(emailInput);
        body.appendChild(errorDiv);
        
        // Footer
        const footer = document.createElement('div');
        footer.className = 'ccpa-modal-footer';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'ccpa-btn ccpa-btn-secondary';
        cancelBtn.id = 'ccpa-cancel';
        cancelBtn.textContent = 'Cancel';
        
        const submitBtn = document.createElement('button');
        submitBtn.className = 'ccpa-btn ccpa-btn-primary';
        submitBtn.id = 'ccpa-submit';
        submitBtn.textContent = 'Submit';
        
        footer.appendChild(cancelBtn);
        footer.appendChild(submitBtn);
        
        // Assemble modal
        modalDiv.appendChild(header);
        modalDiv.appendChild(body);
        modalDiv.appendChild(footer);
        modal.appendChild(modalDiv);

        document.body.appendChild(modal);

        const emailInputEl = modal.querySelector('#ccpa-email-input');
        const errorDivEl = modal.querySelector('#ccpa-email-error');
        const submitBtnEl = modal.querySelector('#ccpa-submit');
        const cancelBtnEl = modal.querySelector('#ccpa-cancel');
        const closeBtnEl = modal.querySelector('.ccpa-modal-close');

        const closeModal = () => {
            document.body.removeChild(modal);
        };

        const handleSubmit = () => {
            const email = emailInputEl.value.trim();
            if (!email) {
                errorDivEl.textContent = 'Email address is required';
                errorDivEl.style.display = 'block';
                return;
            }
            if (!this.validateEmail(email)) {
                errorDivEl.textContent = 'Please enter a valid email address';
                errorDivEl.style.display = 'block';
                return;
            }
            closeModal();
            callback(email);
        };

        // Add tracked event listeners for email modal
        this.addEventListenerWithCleanup(submitBtnEl, 'click', handleSubmit);
        this.addEventListenerWithCleanup(cancelBtnEl, 'click', closeModal);
        this.addEventListenerWithCleanup(closeBtnEl, 'click', closeModal);
        
        // Handle Enter key
        this.addEventListenerWithCleanup(emailInputEl, 'keypress', (e) => {
            if (e.key === 'Enter') {
                handleSubmit();
            }
        });

        // Handle Escape key
        this.addEventListenerWithCleanup(modal, 'keydown', (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        });

        // Focus the input (don't scroll the page)
        try { emailInput.focus({ preventScroll: true }); } catch (e) { emailInput.focus(); }
    }

    showConfirmationModal(title, message, callback) {
        const modal = document.createElement('div');
        modal.className = 'ccpa-modal-overlay';
        
        // Create modal structure safely
        const modalDiv = document.createElement('div');
        modalDiv.className = 'ccpa-modal';
        
        // Header
        const header = document.createElement('div');
        header.className = 'ccpa-modal-header';
        
        const titleEl = document.createElement('h3');
        titleEl.textContent = title;
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'ccpa-modal-close';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.innerHTML = CCPA_CLOSE_ICON_SVG;
        
        header.appendChild(titleEl);
        header.appendChild(closeBtn);
        
        // Body
        const body = document.createElement('div');
        body.className = 'ccpa-modal-body';
        
        const messageEl = document.createElement('p');
        messageEl.textContent = message;
        body.appendChild(messageEl);
        
        // Footer
        const footer = document.createElement('div');
        footer.className = 'ccpa-modal-footer';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'ccpa-btn ccpa-btn-secondary';
        cancelBtn.id = 'ccpa-cancel';
        cancelBtn.textContent = 'Cancel';
        
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'ccpa-btn ccpa-btn-danger';
        confirmBtn.id = 'ccpa-confirm';
        confirmBtn.textContent = 'Confirm';
        
        footer.appendChild(cancelBtn);
        footer.appendChild(confirmBtn);
        
        // Assemble modal
        modalDiv.appendChild(header);
        modalDiv.appendChild(body);
        modalDiv.appendChild(footer);
        modal.appendChild(modalDiv);

        document.body.appendChild(modal);

        const confirmBtnEl2 = modal.querySelector('#ccpa-confirm');
        const cancelBtnEl2 = modal.querySelector('#ccpa-cancel');
        const closeBtnEl3 = modal.querySelector('.ccpa-modal-close');

        const closeModal = () => {
            document.body.removeChild(modal);
        };

        // Add tracked event listeners for confirmation modal
        this.addEventListenerWithCleanup(confirmBtnEl2, 'click', () => {
            closeModal();
            callback();
        });

        this.addEventListenerWithCleanup(cancelBtnEl2, 'click', closeModal);
        this.addEventListenerWithCleanup(closeBtnEl3, 'click', closeModal);

        // Handle Escape key
        this.addEventListenerWithCleanup(modal, 'keydown', (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        });

        // Focus the confirm button (don't scroll the page)
        try { confirmBtn.focus({ preventScroll: true }); } catch (e) { confirmBtn.focus(); }
    }

    // HTML escaping function to prevent XSS
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
            color: white;
            padding: 15px 20px;
            border-radius: 4px;
            z-index: 10000;
            max-width: 300px;
            opacity: 0;
            transition: opacity 250ms ease-in-out;
        `;

        document.body.appendChild(notification);

        // Store timeout IDs for cleanup
        const timeouts = [];
        
        // Animate in
        timeouts.push(setTimeout(() => {
            if (notification.parentNode) {
                notification.style.opacity = '1';
            }
        }, 100));

        // Auto-remove after 3 seconds
        timeouts.push(setTimeout(() => {
            if (notification.parentNode) {
                notification.style.opacity = '0';
                timeouts.push(setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 250));
            }
        }, 3000));
        
        // Store cleanup function for potential early removal
        notification._cleanup = () => {
            timeouts.forEach(id => clearTimeout(id));
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        };
    }

    checkCCPACompliance() {
        // Check if user has opted out and ensure compliance
        if (this.ccpaPreferences.doNotSell) {
            this.disableDataCollection();
        }
    }

    // Public method to check if user has opted out
    hasOptedOut() {
        return this.ccpaPreferences.doNotSell;
    }

    // Public method to get CCPA preferences
    getPreferences() {
        return { ...this.ccpaPreferences };
    }
}

// Initialize CCPA compliance when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.ccpaCompliance = new CCPACompliance();
    
    // Setup cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (window.ccpaCompliance) {
            window.ccpaCompliance.cleanup();
        }
    });
    
    // Also cleanup on page hide (for mobile)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && window.ccpaCompliance) {
            window.ccpaCompliance.cleanup();
        }
    });
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CCPACompliance;
}
