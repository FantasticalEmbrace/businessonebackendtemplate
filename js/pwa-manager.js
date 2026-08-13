// Advanced PWA Manager for HM Herbs
// Enhanced Progressive Web App features with offline sync and push notifications

class PWAManager {
    constructor() {
        this.config = {
            enableOfflineSync: true,
            enablePushNotifications: true,
            enableBackgroundSync: true,
            enableAppInstall: false, // Disabled - user can enable manually if needed
            syncRetryDelay: 5000, // 5 seconds
            maxSyncRetries: 3,
            debugMode: false
        };

        this._serviceWorkerRegisterPromise = null;
        this._swUpdateListenerAttached = false;

        this.offlineQueue = [];
        this.syncInProgress = false;
        this.installPromptEvent = null;
        this.isOnline = navigator.onLine;
        this.eventListeners = []; // Track event listeners for cleanup

        this.init();
    }

    async init() {
        // Register service worker with advanced features
        await this.registerServiceWorker();

        // Initialize offline sync
        if (this.config.enableOfflineSync) {
            this.initializeOfflineSync();
        }

        // Initialize push notifications (after age gate + newsletter popups)
        if (this.config.enablePushNotifications) {
            this.schedulePushNotifications();
        }

        // Initialize app install prompt
        if (this.config.enableAppInstall) {
            this.initializeAppInstall();
        }

        // Set up network status monitoring
        this.setupNetworkMonitoring();

        // Initialize background sync
        if (this.config.enableBackgroundSync) {
            this.initializeBackgroundSync();
        }

        // Set up periodic sync for data updates
        this.setupPeriodicSync();
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
                console.warn('Error removing PWA event listener:', error);
            }
        });
        this.eventListeners = [];
    }

    async registerServiceWorker() {
        // Skip service worker registration in file:// protocol
        if (window.location.protocol === 'file:') {
            if (this.config.debugMode) {
                console.info('Service Worker registration skipped for file:// protocol');
            }
            return null;
        }

        if (!('serviceWorker' in navigator)) {
            return null;
        }

        // One in-flight register per page — overlapping register() calls often yield AbortError
        if (!this._serviceWorkerRegisterPromise) {
            this._serviceWorkerRegisterPromise = navigator.serviceWorker
                .register('/service-worker.js', {
                    scope: '/',
                    updateViaCache: 'none'
                })
                .then((registration) => {
                    this._attachServiceWorkerUpdateListeners(registration);
                    return registration;
                })
                .catch((err) => {
                    this._serviceWorkerRegisterPromise = null;
                    throw err;
                });
        }

        try {
            return await this._serviceWorkerRegisterPromise;
        } catch (error) {
            const name = error && error.name;
            const msg = (error && error.message) || '';
            // Benign when user navigates away mid-register or a newer register supersedes
            if (name === 'AbortError' || msg.includes('aborted')) {
                if (this.config.debugMode) {
                    console.info('Service Worker registration aborted (navigation or superseded):', msg);
                }
                return null;
            }
            if (!msg.includes('URL protocol') && !msg.includes('not supported')) {
                console.error('Service Worker registration failed:', error);
            }
            return null;
        }
    }

    _attachServiceWorkerUpdateListeners(registration) {
        if (!registration || this._swUpdateListenerAttached) {
            return;
        }
        this._swUpdateListenerAttached = true;
        this.addEventListenerWithCleanup(registration, 'updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            this.addEventListenerWithCleanup(newWorker, 'statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    this.showUpdateAvailable();
                }
            });
        });
    }

    // Offline Sync Implementation
    initializeOfflineSync() {
        // Restore any pending requests from the previous session before we
        // start watching online/offline events. Without this the queue is
        // always empty after a reload, so processOfflineQueue() has nothing
        // to flush when the network comes back.
        try { this.loadOfflineQueue(); } catch (e) { /* ignore */ }

        // Listen for online/offline events
        this.addEventListenerWithCleanup(window, 'online', () => {
            this.isOnline = true;
            this.processOfflineQueue();
            this.showConnectionRestored();
        });

        this.addEventListenerWithCleanup(window, 'offline', () => {
            this.isOnline = false;
            this.showOfflineMode();
        });

        // Intercept form submissions for offline queuing
        this.interceptFormSubmissions();

        // Intercept API calls for offline queuing
        this.interceptAPIRequests();
    }

    interceptFormSubmissions() {
        this.addEventListenerWithCleanup(document, 'submit', (event) => {
            if (!this.isOnline) {
                event.preventDefault();
                this.queueFormSubmission(event.target);
            }
        });
    }

    interceptAPIRequests() {
        // Override fetch for API requests
        // Use the native fetch stored before any wrappers ran
        // This ensures we always have the true native fetch, not a wrapped version
        const originalFetch = window.__nativeFetch || window.fetch;
        window.fetch = async (url, options = {}) => {
            // Skip interception for external resources - let them use original fetch directly
            // This prevents CSP violations and 503 errors
            if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
                try {
                    const urlObj = new URL(url, window.location.href);
                    const isExternal = urlObj.origin !== window.location.origin;

                    if (isExternal) {
                        // For external resources, use originalFetch directly without any interception
                        return await originalFetch(url, options);
                    }
                } catch (e) {
                    // If URL parsing fails, continue with interception
                }
            }

            try {
                const response = await originalFetch(url, options);
                return response;
            } catch (error) {
                // Only queue API requests (not external resources)
                if (!this.isOnline && this.isAPIRequest(url)) {
                    this.queueAPIRequest(url, options);
                    throw new Error('Request queued for offline sync');
                }
                throw error;
            }
        };
    }

    queueFormSubmission(form) {
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        const queueItem = {
            type: 'form_submission',
            url: form.action || window.location.href,
            method: form.method || 'POST',
            data: data,
            timestamp: Date.now(),
            retries: 0
        };

        this.offlineQueue.push(queueItem);
        this.saveOfflineQueue();
        this.showOfflineQueuedMessage('Form submission queued for when you\'re back online');
    }

    queueAPIRequest(url, options) {
        const queueItem = {
            type: 'api_request',
            url: url,
            method: options.method || 'GET',
            headers: options.headers || {},
            body: options.body,
            timestamp: Date.now(),
            retries: 0
        };

        this.offlineQueue.push(queueItem);
        this.saveOfflineQueue();
    }

    async processOfflineQueue() {
        if (this.syncInProgress || this.offlineQueue.length === 0) {
            return;
        }

        this.syncInProgress = true;
        const successfulItems = [];

        for (const item of this.offlineQueue) {
            try {
                await this.processQueueItem(item);
                successfulItems.push(item);
            } catch (error) {
                item.retries++;
                if (item.retries >= this.config.maxSyncRetries) {
                    console.error('Max retries reached for queue item:', item);
                    successfulItems.push(item); // Remove from queue
                }
            }
        }

        // Remove successfully processed items
        this.offlineQueue = this.offlineQueue.filter(item => !successfulItems.includes(item));
        this.saveOfflineQueue();

        if (successfulItems.length > 0) {
            this.showSyncComplete(successfulItems.length);
        }

        this.syncInProgress = false;
    }

    async processQueueItem(item) {
        switch (item.type) {
            case 'form_submission':
                return await this.processFormSubmission(item);
            case 'api_request':
                return await this.processAPIRequest(item);
            default:
                throw new Error('Unknown queue item type');
        }
    }

    async processFormSubmission(item) {
        const formData = new FormData();
        Object.entries(item.data).forEach(([key, value]) => {
            formData.append(key, value);
        });

        const response = await fetch(item.url, {
            method: item.method,
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Form submission failed: ${response.status}`);
        }

        return response;
    }

    async processAPIRequest(item) {
        const response = await fetch(item.url, {
            method: item.method,
            headers: item.headers,
            body: item.body
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }

        return response;
    }

    schedulePushNotifications() {
        const start = () => {
            void this.initializePushNotifications();
        };

        if (typeof window.hmWhenReadyForNotificationPrompt === 'function') {
            window.hmWhenReadyForNotificationPrompt(start);
        } else {
            start();
        }
    }

    // Push Notifications Implementation
    async initializePushNotifications() {
        // Skip on file:// protocol (notifications don't work locally)
        if (window.location.protocol === 'file:') {
            return;
        }

        if (!('Notification' in window) || !('serviceWorker' in navigator)) {
            console.warn('Push notifications not supported');
            return;
        }

        // Only request permission if we haven't asked before and permission is still default
        const permission = await this.requestNotificationPermission();

        if (permission === 'granted') {
            // Use void to explicitly ignore the promise and prevent unhandled rejections
            void (async () => {
                try {
                    await this.subscribeToPushNotifications();
                } catch (error) {
                    // Silently handle push notification errors - don't let them propagate
                    // This catch prevents unhandled promise rejections
                    if (error.name !== 'InvalidAccessError' && !error.message?.includes('applicationServerKey')) {
                        // Only log non-key-related errors
                        console.warn('Push notification setup failed:', error.message);
                    }
                    // Don't rethrow - just return
                    return null;
                }
            })();
        }
    }

    async requestNotificationPermission() {
        // Check if we've already asked for permission (stored in localStorage)
        const hasAskedBefore = localStorage.getItem('notification-permission-asked');

        // If permission is already granted or denied, don't ask again
        if (Notification.permission !== 'default') {
            return Notification.permission;
        }

        // If we've asked before and permission is still default (user dismissed), don't ask again
        if (hasAskedBefore === 'true') {
            return Notification.permission;
        }

        // Branded HM Herbs pre-prompt, then the browser permission dialog
        const permission =
            typeof window.hmRequestNotificationPermission === 'function'
                ? await window.hmRequestNotificationPermission()
                : await Notification.requestPermission();

        // Remember that we've asked (including "Not now" on the branded prompt)
        localStorage.setItem('notification-permission-asked', 'true');

        return permission;
    }

    async subscribeToPushNotifications() {
        // Get VAPID key first and validate before attempting subscription
        const vapidKey = this.getVAPIDPublicKey();

        // Check if VAPID key is valid (not a placeholder) - do this BEFORE any async operations
        if (!vapidKey || vapidKey.length < 80 || vapidKey.includes('HI80NqIUHI80NqIU')) {
            // Invalid or placeholder key - skip subscription silently
            // Don't even log to avoid console noise
            return null;
        }

        try {
            const registration = await navigator.serviceWorker.ready;

            // Check if already subscribed
            const existingSubscription = await registration.pushManager.getSubscription();
            if (existingSubscription) {
                return existingSubscription;
            }

            // Subscribe to push notifications
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: vapidKey
            });

            // Send subscription to server
            await this.sendSubscriptionToServer(subscription);

            return subscription;
        } catch (error) {
            // Don't throw - just return null and continue without push notifications
            // Completely silent for InvalidAccessError (expected with invalid keys)
            // NEVER log InvalidAccessError or applicationServerKey errors - they're expected with placeholder keys
            // Only log truly unexpected errors that aren't related to VAPID keys
            const isKeyError = error.name === 'InvalidAccessError' ||
                error.message?.includes('applicationServerKey') ||
                error.message?.includes('PushManager') ||
                error.message?.includes('subscribe') ||
                error.toString().toLowerCase().includes('applicationserverkey');

            if (!isKeyError) {
                // Only log unexpected errors that aren't key-related
                console.warn('Push notification subscription failed:', error.message);
            }
            // Always return null silently - don't propagate the error
            return null;
        }
    }

    getVAPIDPublicKey() {
        // Replace with your actual VAPID public key
        // To generate a valid key, use: npm install -g web-push && web-push generate-vapid-keys
        // For now, return null to disable push notifications
        return null;
    }

    async sendSubscriptionToServer(subscription) {
        try {
            const response = await fetch('/api/push-subscription', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(subscription)
            });

            if (!response.ok) {
                throw new Error('Failed to send subscription to server');
            }
        } catch (error) {
            console.error('Error sending subscription to server:', error);
        }
    }

    // Background Sync Implementation
    initializeBackgroundSync() {
        if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
            navigator.serviceWorker.ready.then(registration => {
                // Register background sync for offline queue
                registration.sync.register('offline-sync');

                // Register periodic background sync for data updates
                registration.sync.register('data-update');
            });
        }
    }

    setupPeriodicSync() {
        if ('serviceWorker' in navigator && 'periodicSync' in window.ServiceWorkerRegistration.prototype) {
            navigator.serviceWorker.ready.then(async registration => {
                // Register periodic sync for product updates
                await registration.periodicSync.register('product-updates', {
                    minInterval: 24 * 60 * 60 * 1000 // 24 hours
                });

                // Register periodic sync for inventory updates
                await registration.periodicSync.register('inventory-updates', {
                    minInterval: 60 * 60 * 1000 // 1 hour
                });
            });
        }
    }

    // App Install Implementation
    initializeAppInstall() {
        this.addEventListenerWithCleanup(window, 'beforeinstallprompt', (event) => {
            event.preventDefault();
            this.installPromptEvent = event;
            this.showInstallPrompt();
        });

        this.addEventListenerWithCleanup(window, 'appinstalled', () => {
            this.hideInstallPrompt();
            this.trackAppInstall();
        });
    }

    showInstallPrompt() {
        const installBanner = document.createElement('div');
        installBanner.id = 'app-install-banner';
        installBanner.className = 'app-install-banner';

        // Create banner content safely
        const installContent = document.createElement('div');
        installContent.className = 'install-content';

        const installIcon = document.createElement('div');
        installIcon.className = 'install-icon';
        installIcon.textContent = '📱';

        const installText = document.createElement('div');
        installText.className = 'install-text';

        const title = document.createElement('h3');
        title.textContent = 'Install HM Herbs App';

        const description = document.createElement('p');
        description.textContent = 'Get quick access to our products and exclusive mobile features';

        installText.appendChild(title);
        installText.appendChild(description);

        const installActions = document.createElement('div');
        installActions.className = 'install-actions';

        const installBtn = document.createElement('button');
        installBtn.id = 'install-app-btn';
        installBtn.className = 'btn btn-primary';
        installBtn.textContent = 'Install';

        const dismissBtn = document.createElement('button');
        dismissBtn.id = 'dismiss-install-btn';
        dismissBtn.className = 'btn btn-secondary';
        dismissBtn.textContent = 'Not Now';

        installActions.appendChild(installBtn);
        installActions.appendChild(dismissBtn);

        installContent.appendChild(installIcon);
        installContent.appendChild(installText);
        installContent.appendChild(installActions);

        installBanner.appendChild(installContent);

        document.body.appendChild(installBanner);

        // Add event listeners
        this.addEventListenerWithCleanup(installBtn, 'click', () => {
            this.promptAppInstall();
        });

        this.addEventListenerWithCleanup(dismissBtn, 'click', () => {
            this.hideInstallPrompt();
        });

        // Auto-hide after 10 seconds
        setTimeout(() => {
            if (document.getElementById('app-install-banner')) {
                this.hideInstallPrompt();
            }
        }, 10000);
    }

    async promptAppInstall() {
        if (this.installPromptEvent) {
            this.installPromptEvent.prompt();
            const result = await this.installPromptEvent.userChoice;

            if (result.outcome === 'accepted') {
                console.log('User accepted app install');
            } else {
                console.log('User dismissed app install');
            }

            this.installPromptEvent = null;
            this.hideInstallPrompt();
        }
    }

    hideInstallPrompt() {
        const banner = document.getElementById('app-install-banner');
        if (banner) {
            banner.remove();
        }
    }

    // Network Monitoring
    setupNetworkMonitoring() {
        // Monitor connection quality
        if ('connection' in navigator) {
            this.monitorConnectionQuality();
        }

        // Monitor network changes
        window.addEventListener('online', () => {
            this.handleNetworkChange(true);
        });

        window.addEventListener('offline', () => {
            this.handleNetworkChange(false);
        });
    }

    monitorConnectionQuality() {
        const connection = navigator.connection;

        const updateConnectionInfo = () => {
            const connectionInfo = {
                effectiveType: connection.effectiveType,
                downlink: connection.downlink,
                rtt: connection.rtt,
                saveData: connection.saveData
            };

            this.adaptToConnectionQuality(connectionInfo);
        };

        this.addEventListenerWithCleanup(connection, 'change', updateConnectionInfo);
        updateConnectionInfo(); // Initial check
    }

    adaptToConnectionQuality(connectionInfo) {
        // Adapt image quality based on connection
        if (connectionInfo.effectiveType === 'slow-2g' || connectionInfo.effectiveType === '2g') {
            this.enableDataSaverMode();
        } else if (connectionInfo.saveData) {
            this.enableDataSaverMode();
        } else {
            this.disableDataSaverMode();
        }
    }

    enableDataSaverMode() {
        document.body.classList.add('data-saver-mode');

        // Lazy load images more aggressively
        const images = document.querySelectorAll('img[data-src]');
        images.forEach(img => {
            img.style.display = 'none';
        });

        // Reduce animation and transitions
        const style = document.createElement('style');
        style.textContent = `
            .data-saver-mode * {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
            }
        `;
        document.head.appendChild(style);
    }

    disableDataSaverMode() {
        document.body.classList.remove('data-saver-mode');

        // Re-enable images
        const images = document.querySelectorAll('img[data-src]');
        images.forEach(img => {
            img.style.display = '';
        });
    }

    handleNetworkChange(isOnline) {
        this.isOnline = isOnline;

        if (isOnline) {
            this.processOfflineQueue();
        }

        // Update UI to reflect network status
        this.updateNetworkStatusUI(isOnline);
    }

    // UI Feedback Methods
    showOfflineMode() {
        this.showNotification('You\'re offline. Some features may be limited.', 'warning', 3000);
    }

    showConnectionRestored() {
        this.showNotification('Connection restored! Syncing your data...', 'success', 3000);
    }

    showOfflineQueuedMessage(message) {
        this.showNotification(message, 'info', 4000);
    }

    showSyncComplete(itemCount) {
        this.showNotification(`Synced ${itemCount} items successfully!`, 'success', 3000);
    }

    showUpdateAvailable() {
        const updateBanner = document.createElement('div');
        updateBanner.className = 'update-banner';

        // Create update content safely
        const updateContent = document.createElement('div');
        updateContent.className = 'update-content';

        const message = document.createElement('span');
        message.textContent = 'A new version is available!';

        const updateBtn = document.createElement('button');
        updateBtn.id = 'update-app-btn';
        updateBtn.className = 'btn btn-primary btn-sm';
        updateBtn.textContent = 'Update';

        const dismissBtn = document.createElement('button');
        dismissBtn.id = 'dismiss-update-btn';
        dismissBtn.className = 'btn btn-secondary btn-sm';
        dismissBtn.textContent = 'Later';

        updateContent.appendChild(message);
        updateContent.appendChild(updateBtn);
        updateContent.appendChild(dismissBtn);

        updateBanner.appendChild(updateContent);

        document.body.appendChild(updateBanner);

        this.addEventListenerWithCleanup(updateBtn, 'click', () => {
            window.location.reload();
        });

        this.addEventListenerWithCleanup(dismissBtn, 'click', () => {
            updateBanner.remove();
        });
    }

    showNotification(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `pwa-notification pwa-notification-${type}`;
        notification.textContent = message;

        document.body.appendChild(notification);

        // Auto-remove after duration
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, duration);
    }

    updateNetworkStatusUI(isOnline) {
        const statusIndicator = document.getElementById('network-status') || this.createNetworkStatusIndicator();
        statusIndicator.className = `network-status ${isOnline ? 'online' : 'offline'}`;
        statusIndicator.textContent = isOnline ? 'Online' : 'Offline';
    }

    createNetworkStatusIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'network-status';
        indicator.className = 'network-status';
        document.body.appendChild(indicator);
        return indicator;
    }

    // Utility Methods
    isAPIRequest(url) {
        return url.includes('/api/') || url.startsWith('/api/');
    }

    saveOfflineQueue() {
        try {
            localStorage.setItem('pwa-offline-queue', JSON.stringify(this.offlineQueue));
        } catch (error) {
            console.error('Failed to save offline queue:', error);
        }
    }

    loadOfflineQueue() {
        try {
            const saved = localStorage.getItem('pwa-offline-queue');
            if (saved) {
                this.offlineQueue = JSON.parse(saved);
            }
        } catch (error) {
            console.error('Failed to load offline queue:', error);
            this.offlineQueue = [];
        }
    }

    trackAppInstall() {
        // Track app installation for analytics
        if (window.hmherbsAnalytics) {
            window.hmherbsAnalytics.trackCustomEvent('app_installed', {
                timestamp: Date.now(),
                userAgent: navigator.userAgent
            });
        }
    }

    // Public API
    async syncNow() {
        if (this.isOnline) {
            await this.processOfflineQueue();
        }
    }

    getOfflineQueueStatus() {
        return {
            itemCount: this.offlineQueue.length,
            syncInProgress: this.syncInProgress,
            isOnline: this.isOnline
        };
    }

    clearOfflineQueue() {
        this.offlineQueue = [];
        this.saveOfflineQueue();
    }
}

    // Initialize PWA Manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.pwaManager = new PWAManager();

    // Setup cleanup on page unload (not on visibility hide — that runs on every tab switch and
    // can interfere with in-flight service worker registration)
    window.addEventListener('beforeunload', () => {
        if (window.pwaManager) {
            window.pwaManager.cleanup();
        }
    });
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PWAManager;
}
