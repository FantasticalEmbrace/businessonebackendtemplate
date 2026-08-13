// Comprehensive Error Handling and User Experience Enhancement
// Provides graceful error handling, user feedback, and recovery mechanisms
// Version: 2.0 - Enhanced error suppression for analytics and optional endpoints

class ErrorHandler {
    constructor() {
        this.errorQueue = [];
        this.retryAttempts = new Map();
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second base delay
        this.eventListeners = []; // Track event listeners for cleanup
        this.globalHandlersAdded = false; // Prevent duplicate global handlers

        this.init();
    }

    init() {
        this.setupGlobalErrorHandlers();
        this.setupNetworkErrorHandling();
        this.setupUIErrorHandling();
        this.createErrorDisplay();
        this.setupOfflineHandling();
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
                console.warn('Error removing error handler event listener:', error);
            }
        });
        this.eventListeners = [];
        this.globalHandlersAdded = false; // Reset flag for potential re-initialization
    }

    setupGlobalErrorHandlers() {
        // Prevent duplicate global handlers
        if (this.globalHandlersAdded) {
            return;
        }

        // Catch JavaScript errors
        this.addEventListenerWithCleanup(window, 'error', (event) => {
            this.handleJavaScriptError({
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error
            });
        });

        // Catch unhandled promise rejections
        this.addEventListenerWithCleanup(window, 'unhandledrejection', (event) => {
            // Check if this is a PWA push notification error or analytics error - ignore it
            const reason = event.reason;
            const reasonString = reason?.toString() || '';
            const reasonMessage = reason?.message || '';

            if (reason && (
                reason.name === 'InvalidAccessError' ||
                reasonMessage.includes('applicationServerKey') ||
                reasonMessage.includes('PushManager') ||
                reasonString.includes('analytics') ||
                reasonString.includes('Analytics')
            )) {
                // Silently ignore PWA push notification and analytics errors
                event.preventDefault();
                return;
            }

            this.handlePromiseRejection({
                reason: event.reason,
                promise: event.promise
            });
            event.preventDefault(); // Prevent console error
        });

        // Catch resource loading errors (using capture phase)
        this.addEventListenerWithCleanup(window, 'error', (event) => {
            if (event.target !== window) {
                // Check if this is a CORS error - silently ignore these
                const errorMessage = event.message || '';
                const isCORSError = errorMessage.includes('CORS') ||
                    errorMessage.includes('Access-Control-Allow-Origin') ||
                    errorMessage.includes('blocked by CORS policy');

                // Silently ignore CORS errors for external resources
                if (isCORSError) {
                    return; // Don't process CORS errors
                }

                this.handleResourceError({
                    element: event.target,
                    source: event.target.src || event.target.href,
                    type: event.target.tagName,
                    message: errorMessage
                });
            }
        }, true);

        this.globalHandlersAdded = true;
    }

    setupNetworkErrorHandling() {
        // Override fetch to add error handling
        // Use the native fetch stored before any wrappers ran
        // This ensures we always have the true native fetch, not a wrapped version
        this.originalFetch = window.__nativeFetch || window.fetch.bind(window);
        const self = this;

        window.fetch = async (...args) => {
            // Skip fetch if in file:// protocol to avoid CORS errors
            if (window.location.protocol === 'file:') {
                // Return a rejected promise that won't cause errors
                return Promise.reject(new Error('Fetch not available in file:// protocol'));
            }

            // Get URL first to check if this is an external resource
            let url = '';
            if (typeof args[0] === 'string') {
                url = args[0];
            } else if (args[0] instanceof Request) {
                url = args[0].url;
            } else if (args[0] && typeof args[0] === 'object') {
                url = args[0].url || args[0].href || '';
            }

            // Skip error handling for external resources - let browser handle them directly
            // This prevents CSP violations and 503 errors for external fonts, CDN, etc.
            if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                try {
                    const urlObj = new URL(url, window.location.href);
                    const isExternal = urlObj.origin !== window.location.origin;

                    if (isExternal) {
                        // For external resources, use originalFetch directly without any error handling
                        // This prevents CSP violations and allows browser to handle them naturally
                        return await self.originalFetch(...args);
                    }
                } catch (e) {
                    // If URL parsing fails, continue with normal error handling
                }
            }

            // Check if this is an analytics request (check both relative and absolute URLs)
            // Check for various URL formats: /api/analytics, api/analytics, :3001/api/analytics, localhost:3001/api/analytics
            const urlLower = (url || '').toLowerCase();
            const isAnalyticsRequest = urlLower.includes('/api/analytics') ||
                urlLower.includes('api/analytics') ||
                urlLower.includes(':3001/api/analytics') ||
                urlLower.includes('localhost:3001/api/analytics') ||
                urlLower.includes('3001/api/analytics');

            if (isAnalyticsRequest) {
                // For analytics, completely bypass error handling
                // Use originalFetch and catch ALL errors to prevent any propagation
                try {
                    const result = await self.originalFetch(...args);
                    // Don't check response.ok - return whatever we get
                    return result;
                } catch (error) {
                    // Silently fail analytics requests - return a mock response
                    // This prevents the error from propagating and triggering handleNetworkError
                    // DO NOT throw or reject - just return a mock response
                    return new Response(JSON.stringify({ error: 'Analytics unavailable' }), {
                        status: 503,
                        statusText: 'Service Unavailable'
                    });
                }
            }

            try {
                const response = await self.originalFetch(...args);

                // Don't throw for 4xx/5xx errors on certain endpoints that are optional
                const optionalEndpoints = [
                    '/sitemap.xml',
                    '/robots.txt',
                    '/api/edsa/hours',
                    '/hours',
                    'api/edsa/hours',
                    '/categories/',
                    '/services/',
                    '/about.html',
                    '/contact.html',
                    '/api/admin/auth/login',
                    'api/admin/auth/login',
                    '/api/admin/',
                    'api/admin/',
                    '/admin.html'
                ];
                if (!response.ok && optionalEndpoints.some(endpoint => url.includes(endpoint))) {
                    // Return a mock 503 response for optional endpoints to prevent console errors
                    // This prevents them from triggering handleNetworkError and showing 404s in console
                    return new Response(JSON.stringify({ error: 'Resource unavailable' }), {
                        status: 503,
                        statusText: 'Service Unavailable'
                    });
                }

                // Check if this is a products API 503 error (expected when database is not configured)
                // Suppress console errors for these expected failures
                if (!response.ok && response.status === 503 && url.includes('/api/products')) {
                    // Return a mock response with empty products array to prevent console errors
                    // This allows the app to handle it gracefully without logging
                    return new Response(JSON.stringify({
                        error: 'Database service unavailable',
                        products: [],
                        pagination: { currentPage: 1, totalPages: 0, totalProducts: 0 }
                    }), {
                        status: 503,
                        statusText: 'Service Unavailable'
                    });
                }

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                return response;
            } catch (error) {
                // Check if this is analytics or optional endpoint before calling handleNetworkError
                // This prevents unnecessary processing
                const checkUrl = typeof args[0] === 'string' ? args[0] : (args[0]?.url || args[0]?.href || '');
                const checkUrlLower = (checkUrl || '').toLowerCase();
                const isAnalytics = checkUrlLower.includes('/api/analytics') ||
                    checkUrlLower.includes('api/analytics') ||
                    checkUrlLower.includes(':3001/api/analytics') ||
                    checkUrlLower.includes('localhost:3001/api/analytics') ||
                    checkUrlLower.includes('3001/api/analytics');
                const isOptional = [
                    '/sitemap.xml',
                    '/robots.txt',
                    '/api/edsa/hours',
                    '/hours',
                    'api/edsa/hours',
                    '/categories/',
                    '/services/',
                    '/about.html',
                    '/contact.html',
                    '/api/admin/auth/login',
                    'api/admin/auth/login',
                    '/api/admin/',
                    'api/admin/',
                    '/admin.html'
                ].some(endpoint => checkUrlLower.includes(endpoint.toLowerCase()));

                if (isAnalytics || isOptional) {
                    // Return mock response immediately without calling handleNetworkError
                    return new Response(JSON.stringify({ error: 'Resource unavailable' }), {
                        status: 503,
                        statusText: 'Service Unavailable'
                    });
                }

                return this.handleNetworkError(error, args);
            }
        };

        // Override XMLHttpRequest
        const originalXHROpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (...args) {
            this.addEventListener('error', (_event) => {
                window.errorHandler.handleNetworkError(new Error('XHR request failed'), args);
            });

            this.addEventListener('timeout', (_event) => {
                window.errorHandler.handleNetworkError(new Error('XHR request timeout'), args);
            });

            return originalXHROpen.apply(this, args);
        };
    }

    setupUIErrorHandling() {
        // Handle form submission errors
        this.addEventListenerWithCleanup(document, 'submit', (event) => {
            const form = event.target;
            if (form.tagName === 'FORM') {
                this.handleFormSubmission(form, event);
            }
        });

        // Handle click errors on interactive elements
        this.addEventListenerWithCleanup(document, 'click', (event) => {
            const element = event.target;
            // Header account/cart controls must never get pointer-events:none debounce
            if (element.closest('.header-actions')) {
                return;
            }
            if (element.matches('button, a, [role="button"]')) {
                this.wrapInteractiveElement(element, event);
            }
        });
    }

    createErrorDisplay() {
        // Create error notification container
        const errorContainer = document.createElement('div');
        errorContainer.id = 'error-notifications';
        errorContainer.className = 'error-notifications';
        errorContainer.setAttribute('aria-live', 'polite');
        errorContainer.setAttribute('aria-label', 'Error notifications');

        // Add styles
        errorContainer.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: var(--z-notification, 1000000);
            max-width: 400px;
            pointer-events: none;
        `;

        document.body.appendChild(errorContainer);
        this.errorContainer = errorContainer;
    }

    setupOfflineHandling() {
        this.addEventListenerWithCleanup(window, 'online', () => {
            this.showNotification('Connection restored', 'success');
            this.retryFailedRequests();
        });

        this.addEventListenerWithCleanup(window, 'offline', () => {
            this.showNotification('You are currently offline. Some features may not work.', 'warning', 0);
        });
    }

    handleJavaScriptError(errorInfo) {
        console.error('JavaScript Error:', errorInfo);

        // Don't show user notification for minor errors
        if (this.isMinorError(errorInfo)) {
            return;
        }

        // Log to analytics/monitoring service
        this.logError('javascript', errorInfo);

        // Show user-friendly message
        this.showNotification(
            'Something went wrong. Please refresh the page if the problem persists.',
            'error'
        );
    }

    handlePromiseRejection(rejectionInfo) {
        // Check if this is a PWA or analytics error - ignore silently
        const reason = rejectionInfo.reason;
        const reasonString = (reason?.toString() || '').toLowerCase();
        const reasonMessage = (reason?.message || '').toLowerCase();
        const reasonName = reason?.name || '';

        if (reasonName === 'InvalidAccessError' ||
            reasonName === 'NotAllowedError' ||
            reasonMessage.includes('applicationserverkey') ||
            reasonMessage.includes('pushmanager') ||
            reasonMessage.includes('permission denied') ||
            reasonString.includes('analytics') ||
            reasonString.includes('pwa-manager') ||
            reasonString.includes('subscribe')) {
            // Silently ignore PWA and analytics errors - don't log, don't notify
            return;
        }

        // Don't log PWA errors - they're already filtered above, but double-check
        const finalCheck = reasonString.includes('invalidaccesserror') ||
            reasonString.includes('applicationserverkey') ||
            reasonString.includes('pushmanager') ||
            reasonString.includes('subscribe') ||
            reasonName === 'InvalidAccessError';

        if (!finalCheck) {
            console.error('Unhandled Promise Rejection:', rejectionInfo);
        }

        // Log to monitoring service
        this.logError('promise_rejection', rejectionInfo);

        // Show user notification for network-related rejections
        if (this.isNetworkError(rejectionInfo.reason)) {
            this.showNotification(
                'Network error occurred. Please check your connection.',
                'error'
            );
        }
    }

    handleResourceError(resourceInfo) {
        const source = resourceInfo.source || '';
        if (source === window.location.href) {
            return;
        }
        // Silently ignore ALL errors for external resources (images, stylesheets, etc.)
        // Local product images: visual-bug-fixes applies placeholders — avoid duplicate "Resource Loading Error" noise
        if (typeof source === 'string' && source.includes('/images/products/')) {
            return;
        }
        const isExternal = source.startsWith('http://') || source.startsWith('https://');

        if (isExternal) {
            try {
                const sourceUrl = new URL(source, window.location.href);
                const isExternalResource = sourceUrl.origin !== window.location.origin;

                if (isExternalResource) {
                    // Silently ignore ALL errors for external resources - don't log, don't warn
                    // This includes CORS errors, network errors, 404s, etc.
                    return;
                }
            } catch (e) {
                // If URL parsing fails, continue with normal error handling
            }
        }

        // Check if this is an optional endpoint that may not exist (404s are expected)
        const optionalEndpoints = [
            '/sitemap.xml',
            '/robots.txt',
            '/api/edsa/hours',
            '/categories/',
            '/services/',
            '/about.html',
            '/contact.html',
            '/api/admin/auth/login',
            'api/admin/auth/login',
            '/api/admin/',
            'api/admin/',
            '/admin.html'
        ];
        const sourceLower = source.toLowerCase();
        const isOptionalEndpoint = optionalEndpoints.some(endpoint => sourceLower.includes(endpoint.toLowerCase()));

        if (isOptionalEndpoint) {
            // Silently ignore errors for optional endpoints - they may not exist (404s are expected)
            return;
        }

        // Only handle errors for same-origin resources that are not optional
        const errorMessage = resourceInfo.message || '';
        const isCORSError = errorMessage.includes('CORS') ||
            errorMessage.includes('Access-Control-Allow-Origin') ||
            errorMessage.includes('blocked by CORS policy');

        // Only log non-CORS resource errors for same-origin resources
        if (!isCORSError) {
            console.warn('Resource Loading Error:', resourceInfo);
        }

        // Try to recover from resource errors (but skip for CORS errors)
        if (!isCORSError) {
            this.attemptResourceRecovery(resourceInfo);
            // Log for monitoring (but skip CORS errors)
            this.logError('resource', resourceInfo);
        }
    }

    async handleNetworkError(error, requestArgs) {
        // Skip error handling if in file:// protocol
        if (window.location.protocol === 'file:') {
            // Silently fail for file:// protocol
            return Promise.reject(error);
        }

        // Get URL FIRST to check if this is analytics or optional endpoint
        // Do this before any other processing to prevent unnecessary work
        let url = '';
        if (typeof requestArgs[0] === 'string') {
            url = requestArgs[0];
        } else if (requestArgs[0] instanceof Request) {
            url = requestArgs[0].url;
        } else if (requestArgs[0] && typeof requestArgs[0] === 'object') {
            url = requestArgs[0].url || requestArgs[0].href || '';
        }

        // Also check error message and stack trace as fallback
        const errorString = (error?.message || error?.toString() || '').toLowerCase();
        const stackString = (error?.stack || '').toLowerCase();

        // Check for analytics FIRST - analytics should never reach here, but if they do, handle silently
        // Check multiple patterns to catch all variations (relative, absolute, with/without protocol)
        const urlLower = (url || '').toLowerCase();
        const isAnalytics = urlLower.includes('/api/analytics') ||
            urlLower.includes('api/analytics') ||
            urlLower.includes(':3001/api/analytics') ||
            urlLower.includes('localhost:3001/api/analytics') ||
            urlLower.includes('3001/api/analytics') ||
            (urlLower.includes('http') && urlLower.includes('/api/analytics')) ||
            errorString.includes('analytics') ||
            errorString.includes('/api/analytics') ||
            stackString.includes('analytics') ||
            stackString.includes('advanced-analytics') ||
            stackString.includes('/api/analytics');

        if (isAnalytics) {
            // Analytics errors should be completely silent - return mock response immediately
            // Don't log, don't retry, don't do anything else
            return new Response(JSON.stringify({ error: 'Analytics unavailable' }), {
                status: 503,
                statusText: 'Service Unavailable'
            });
        }

        const requestKey = this.getRequestKey(requestArgs);
        const attempts = this.retryAttempts.get(requestKey) || 0;

        const optionalEndpoints = [
            '/sitemap.xml',
            '/robots.txt',
            '/api/edsa/hours',
            '/categories/',
            '/services/',
            '/about.html',
            '/contact.html',
            '/api/admin/auth/login',
            'api/admin/auth/login',
            '/api/admin/',
            'api/admin/',
            '/admin.html'
        ];
        const isOptionalEndpoint = optionalEndpoints.some(endpoint => url.includes(endpoint));

        // Check if this is a products API 503 error (expected when database is not configured)
        const isProductsAPI503 = urlLower.includes('/api/products') &&
            (errorString.includes('503') ||
                errorString.includes('service unavailable') ||
                errorString.includes('database connection unavailable') ||
                errorString.includes('er_access_denied') ||
                errorString.includes('econnrefused'));

        // Don't retry optional endpoints - return immediately
        if (isOptionalEndpoint) {
            // Return a mock response for optional endpoints to prevent further errors
            // Don't log these errors to avoid console spam - silently return
            return new Response(JSON.stringify({ error: 'Resource unavailable' }), {
                status: 503,
                statusText: 'Service Unavailable'
            });
        }

        // Only log non-optional, non-analytics endpoint errors (and only on first attempt to avoid spam)
        // Also skip logging if this is a retry from handleNetworkError itself
        // Never log analytics or optional endpoint errors - completely silent
        // Also suppress products API 503 errors (expected when database is not configured)
        // Double-check URL and error message to ensure we don't log these
        const shouldLog = attempts === 0 &&
            !error.message?.includes('handleNetworkError') &&
            !isAnalytics &&
            !isOptionalEndpoint &&
            !isProductsAPI503 &&
            !urlLower.includes('analytics') &&
            !errorString.includes('analytics');

        // NEVER log analytics or optional endpoint errors - completely silent
        // Also suppress products API 503 errors (expected when database is not configured)
        // Double-check one more time before logging
        const finalCheckUrl = urlLower || errorString || '';
        const isDefinitelyAnalytics = finalCheckUrl.includes('analytics') || finalCheckUrl.includes('/api/analytics');
        const isDefinitelyOptional = ['sitemap', 'robots', 'edsa/hours', 'admin/auth/login', 'admin.html', 'api/admin'].some(term => finalCheckUrl.includes(term));
        const isDefinitelyProducts503 = finalCheckUrl.includes('/api/products') &&
            (finalCheckUrl.includes('503') ||
                finalCheckUrl.includes('service unavailable') ||
                finalCheckUrl.includes('database'));

        if (shouldLog && !isDefinitelyAnalytics && !isDefinitelyOptional && !isDefinitelyProducts503) {
            console.error('Network Error:', error, requestArgs);
        }

        if (attempts < this.maxRetries) {
            // Retry with exponential backoff
            const delay = this.retryDelay * Math.pow(2, attempts);
            this.retryAttempts.set(requestKey, attempts + 1);

            await this.delay(delay);

            try {
                // Use originalFetch to avoid infinite loop with wrapped fetch
                const response = await this.originalFetch(...requestArgs);

                // Check if response is ok for non-optional endpoints
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                this.retryAttempts.delete(requestKey);
                return response;
            } catch (retryError) {
                // Only retry if we haven't exceeded max attempts
                if (attempts + 1 < this.maxRetries) {
                    return this.handleNetworkError(retryError, requestArgs);
                } else {
                    // Max retries reached, return error response
                    this.retryAttempts.delete(requestKey);
                    this.showNotification(
                        'Unable to connect to the server. Please try again later.',
                        'error'
                    );
                    return new Response(JSON.stringify({ error: 'Network unavailable' }), {
                        status: 503,
                        statusText: 'Service Unavailable'
                    });
                }
            }
        } else {
            // Max retries reached
            this.retryAttempts.delete(requestKey);
            this.showNotification(
                'Unable to connect to the server. Please try again later.',
                'error'
            );

            // Return a mock response to prevent further errors
            return new Response(JSON.stringify({ error: 'Network unavailable' }), {
                status: 503,
                statusText: 'Service Unavailable'
            });
        }
    }

    handleFormSubmission(form, event) {
        // customer-auth.js owns these (capture-phase handlers + preventDefault).
        // Skip loading/validation here so we never fight that flow or the header UI.
        if (
            form.id === 'customer-login-form' ||
            form.id === 'customer-register-form' ||
            form.id === 'customer-forgot-password-form' ||
            form.id === 'edsa-booking-form'
        ) {
            return;
        }
        try {
            // Add loading state
            const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.classList.add('loading');

                // Re-enable after timeout as fallback
                setTimeout(() => {
                    submitButton.disabled = false;
                    submitButton.classList.remove('loading');
                }, 10000);
            }

            // Validate form before submission
            if (!this.validateForm(form)) {
                event.preventDefault();
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.classList.remove('loading');
                }
                return;
            }

        } catch (error) {
            console.error('Form submission error:', error);
            event.preventDefault();
            this.showNotification('Form submission failed. Please try again.', 'error');
        }
    }

    wrapInteractiveElement(element, _event) {
        try {
            // Add visual feedback
            element.style.pointerEvents = 'none';
            setTimeout(() => {
                element.style.pointerEvents = '';
            }, 300);

        } catch (error) {
            console.error('Interactive element error:', error);
            this.showNotification('Action failed. Please try again.', 'error');
        }
    }

    validateForm(form) {
        const requiredFields = form.querySelectorAll('[required]');
        let isValid = true;

        requiredFields.forEach(field => {
            if (!field.value.trim()) {
                this.showFieldError(field, 'This field is required');
                isValid = false;
            } else {
                this.clearFieldError(field);
            }
        });

        // Email validation
        const emailFields = form.querySelectorAll('input[type="email"]');
        emailFields.forEach(field => {
            if (field.value && !this.isValidEmail(field.value)) {
                this.showFieldError(field, 'Please enter a valid email address');
                isValid = false;
            }
        });

        return isValid;
    }

    showFieldError(field, message) {
        field.setAttribute('aria-invalid', 'true');
        field.classList.add('error');

        // Remove existing error message
        const existingError = field.parentNode.querySelector('.error-message');
        if (existingError) {
            existingError.remove();
        }

        // Add new error message
        const errorElement = document.createElement('div');
        errorElement.className = 'error-message';
        errorElement.textContent = message;
        errorElement.setAttribute('role', 'alert');
        field.parentNode.appendChild(errorElement);
    }

    clearFieldError(field) {
        field.setAttribute('aria-invalid', 'false');
        field.classList.remove('error');

        const errorMessage = field.parentNode.querySelector('.error-message');
        if (errorMessage) {
            errorMessage.remove();
        }
    }

    showNotification(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.setAttribute('role', 'alert');
        notification.style.cssText = `
            background: ${this.getNotificationColor(type)};
            color: white;
            padding: 16px 20px;
            border-radius: 8px;
            margin-bottom: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            pointer-events: auto;
            cursor: pointer;
            animation: slideIn 0.3s ease-out;
            max-width: 100%;
            word-wrap: break-word;
        `;

        // Create notification content safely
        const container = document.createElement('div');
        container.style.cssText = 'display: flex; align-items: center; gap: 10px;';

        const messageSpan = document.createElement('span');
        messageSpan.style.flex = '1';
        messageSpan.textContent = message;

        const closeButton = document.createElement('button');
        closeButton.style.cssText = 'background: none; border: none; color: white; cursor: pointer; font-size: 18px;';
        closeButton.setAttribute('aria-label', 'Close notification');
        closeButton.textContent = '×';

        container.appendChild(messageSpan);
        container.appendChild(closeButton);
        notification.appendChild(container);

        // Close button functionality (reuse the closeButton variable)
        this.addEventListenerWithCleanup(closeButton, 'click', () => {
            this.removeNotification(notification);
        });

        // Click to dismiss
        this.addEventListenerWithCleanup(notification, 'click', (e) => {
            if (e.target !== closeButton) {
                this.removeNotification(notification);
            }
        });

        this.errorContainer.appendChild(notification);

        // Auto-remove after duration (unless duration is 0)
        if (duration > 0) {
            setTimeout(() => {
                this.removeNotification(notification);
            }, duration);
        }
    }

    removeNotification(notification) {
        notification.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }

    getNotificationColor(type) {
        const colors = {
            success: '#059669',
            error: '#dc2626',
            warning: '#d97706',
            info: '#2563eb'
        };
        return colors[type] || colors.info;
    }

    attemptResourceRecovery(resourceInfo) {
        const { element, source, type } = resourceInfo;

        if (type === 'IMG') {
            // Use a data URI fallback image instead of a file path to avoid file:// protocol issues
            const placeholderSvg = 'data:image/svg+xml;base64,' + btoa(
                '<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">' +
                '<rect width="100%" height="100%" fill="#f0f0f0"/>' +
                '<text x="50%" y="50%" font-family="Arial, sans-serif" font-size="18" fill="#999" text-anchor="middle" dominant-baseline="middle">Image Unavailable</text>' +
                '</svg>'
            );
            element.src = placeholderSvg;
            element.alt = 'Image unavailable';
        } else if (type === 'SCRIPT') {
            // Try to load from CDN fallback
            this.loadScriptFallback(element, source);
        } else if (type === 'LINK' && element.rel === 'stylesheet') {
            // Try to load CSS fallback
            this.loadStylesheetFallback(element, source);
        }
    }

    loadScriptFallback(originalScript, originalSource) {
        // Implementation would depend on specific fallback strategies
        console.warn('Script fallback needed for:', originalSource);
    }

    loadStylesheetFallback(originalLink, originalSource) {
        // Implementation would depend on specific fallback strategies
        console.warn('Stylesheet fallback needed for:', originalSource);
    }

    async retryFailedRequests() {
        // Retry any queued failed requests when connection is restored
        const failedRequests = [...this.errorQueue];
        this.errorQueue = [];

        for (const request of failedRequests) {
            try {
                await fetch(...request.args);
            } catch (error) {
                console.warn('Retry failed for:', request.args);
            }
        }
    }

    isMinorError(errorInfo) {
        const minorErrors = [
            'Script error',
            'ResizeObserver loop limit exceeded',
            'Non-Error promise rejection captured'
        ];

        return minorErrors.some(minor =>
            errorInfo.message && errorInfo.message.includes(minor)
        );
    }

    isNetworkError(error) {
        if (!error) return false;

        const networkErrors = [
            'fetch',
            'network',
            'timeout',
            'connection',
            'offline'
        ];

        const errorString = error.toString().toLowerCase();
        return networkErrors.some(keyword => errorString.includes(keyword));
    }

    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    getRequestKey(requestArgs) {
        return JSON.stringify(requestArgs[0]); // URL or Request object
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    logError(type, errorInfo) {
        // Don't log analytics or PWA errors to prevent noise
        const errorString = JSON.stringify(errorInfo || {}).toLowerCase();
        const errorMessage = (errorInfo?.message || errorInfo?.reason?.message || '').toLowerCase();

        if (errorString.includes('analytics') ||
            errorString.includes('applicationserverkey') ||
            errorString.includes('pushmanager') ||
            errorMessage.includes('analytics') ||
            errorMessage.includes('applicationserverkey')) {
            // Silently skip logging analytics and PWA errors
            return;
        }

        // In production, this would send to analytics/monitoring service
        const logData = {
            type,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href,
            error: errorInfo
        };

        // Final check before logging - never log analytics or PWA errors
        const finalErrorString = JSON.stringify(logData).toLowerCase();
        if (finalErrorString.includes('analytics') ||
            finalErrorString.includes('applicationserverkey') ||
            finalErrorString.includes('pushmanager') ||
            finalErrorString.includes('invalidaccesserror')) {
            // Completely silent - don't log
            return;
        }

        console.log('Error logged:', logData);

        // Example: Send to monitoring service
        // fetch('/api/errors', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify(logData)
        // }).catch(() => {}); // Fail silently
    }
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    .notification {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.4;
    }
`;
document.head.appendChild(style);

// Initialize error handler when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.errorHandler = new ErrorHandler();

    // Silently initialize - no console log needed
    // Error Handler v2.0 loaded - Enhanced error suppression active

    // Setup cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (window.errorHandler) {
            window.errorHandler.cleanup();
        }
    });

    // Also cleanup on page hide (for mobile)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && window.errorHandler) {
            window.errorHandler.cleanup();
        }
    });
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ErrorHandler;
}
