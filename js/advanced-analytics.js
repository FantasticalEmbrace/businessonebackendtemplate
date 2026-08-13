// Advanced Analytics and Performance Monitoring for HM Herbs
// Real User Monitoring (RUM), Core Web Vitals, and comprehensive analytics

class AdvancedAnalytics {
    constructor() {
        this.config = {
            enableRUM: true,
            enableCoreWebVitals: true,
            enableUserBehavior: true,
            enableErrorTracking: true,
            enablePerformanceMonitoring: true,
            sampleRate: 1.0, // 100% sampling for now
            apiEndpoint: '/api/analytics',
            debugMode: false, // Reduce console noise
            enableInDevelopment: false // Disable analytics in development to prevent connection errors
        };

        this.metrics = {
            performance: [],
            userBehavior: [],
            errors: [],
            coreWebVitals: {}
        };

        this.sessionId = this.generateSessionId();
        this.userId = this.getUserId();
        this.pageLoadTime = performance.now();

        // Track intervals for cleanup
        this.intervals = [];

        this.init();
    }

    init() {
        if (this.config.enableRUM) {
            this.initializeRUM();
        }

        if (this.config.enableCoreWebVitals) {
            this.initializeCoreWebVitals();
        }

        if (this.config.enableUserBehavior) {
            this.initializeUserBehaviorTracking();
        }

        if (this.config.enableErrorTracking) {
            this.initializeErrorTracking();
        }

        if (this.config.enablePerformanceMonitoring) {
            this.initializePerformanceMonitoring();
        }

        // Send data periodically
        this.startDataTransmission();

        // Send data before page unload
        this.setupBeforeUnload();
    }

    // Real User Monitoring (RUM) Implementation
    initializeRUM() {
        // Navigation Timing API
        if ('performance' in window && 'getEntriesByType' in performance) {
            window.addEventListener('load', () => {
                setTimeout(() => {
                    this.collectNavigationTiming();
                }, 0);
            });
        }

        // Resource Timing API
        if ('PerformanceObserver' in window) {
            try {
                const resourceObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        this.collectResourceTiming(entry);
                    }
                });
                resourceObserver.observe({ entryTypes: ['resource'] });
            } catch (e) {
                console.warn('Resource timing observer not supported:', e);
            }
        }

        // Long Task API
        if ('PerformanceObserver' in window) {
            try {
                const longTaskObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        this.collectLongTask(entry);
                    }
                });
                longTaskObserver.observe({ entryTypes: ['longtask'] });
            } catch (e) {
                console.warn('Long task observer not supported:', e);
            }
        }
    }

    // Core Web Vitals Implementation
    initializeCoreWebVitals() {
        // Largest Contentful Paint (LCP)
        if ('PerformanceObserver' in window) {
            try {
                const lcpObserver = new PerformanceObserver((list) => {
                    const entries = list.getEntries();
                    const lastEntry = entries[entries.length - 1];
                    this.metrics.coreWebVitals.lcp = {
                        value: lastEntry.startTime,
                        element: lastEntry.element?.tagName || 'unknown',
                        url: lastEntry.url || window.location.href,
                        timestamp: Date.now()
                    };
                });
                lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
            } catch (e) {
                console.warn('LCP observer not supported:', e);
            }
        }

        // First Input Delay (FID)
        if ('PerformanceObserver' in window) {
            try {
                const fidObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        this.metrics.coreWebVitals.fid = {
                            value: entry.processingStart - entry.startTime,
                            eventType: entry.name,
                            timestamp: Date.now()
                        };
                    }
                });
                fidObserver.observe({ entryTypes: ['first-input'] });
            } catch (e) {
                console.warn('FID observer not supported:', e);
            }
        }

        // Cumulative Layout Shift (CLS)
        if ('PerformanceObserver' in window) {
            try {
                let clsValue = 0;
                const clsObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (!entry.hadRecentInput) {
                            clsValue += entry.value;
                        }
                    }
                    this.metrics.coreWebVitals.cls = {
                        value: clsValue,
                        timestamp: Date.now()
                    };
                });
                clsObserver.observe({ entryTypes: ['layout-shift'] });
            } catch (e) {
                console.warn('CLS observer not supported:', e);
            }
        }

        // First Contentful Paint (FCP)
        if ('PerformanceObserver' in window) {
            try {
                const fcpObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.name === 'first-contentful-paint') {
                            this.metrics.coreWebVitals.fcp = {
                                value: entry.startTime,
                                timestamp: Date.now()
                            };
                        }
                    }
                });
                fcpObserver.observe({ entryTypes: ['paint'] });
            } catch (e) {
                console.warn('FCP observer not supported:', e);
            }
        }

        // Time to Interactive (TTI) approximation
        this.calculateTTI();
    }

    // User Behavior Tracking
    initializeUserBehaviorTracking() {
        // Click tracking
        document.addEventListener('click', (event) => {
            this.trackUserInteraction('click', {
                element: event.target.tagName,
                className: event.target.className,
                id: event.target.id,
                text: event.target.textContent?.substring(0, 100),
                x: event.clientX,
                y: event.clientY,
                timestamp: Date.now()
            });
        });

        // Scroll tracking
        let scrollTimeout;
        let maxScroll = 0;
        document.addEventListener('scroll', () => {
            const scrollPercent = Math.round(
                (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100
            );
            maxScroll = Math.max(maxScroll, scrollPercent);

            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                this.trackUserInteraction('scroll', {
                    scrollPercent: maxScroll,
                    timestamp: Date.now()
                });
            }, 1000);
        });

        // Form interactions
        document.addEventListener('focus', (event) => {
            if (event.target.matches('input, textarea, select')) {
                this.trackUserInteraction('form_focus', {
                    element: event.target.tagName,
                    type: event.target.type,
                    name: event.target.name,
                    timestamp: Date.now()
                });
            }
        }, true);

        // Page visibility changes
        document.addEventListener('visibilitychange', () => {
            this.trackUserInteraction('visibility_change', {
                hidden: document.hidden,
                timestamp: Date.now()
            });
        });

        // Mouse movement heatmap (sampled)
        if (Math.random() < 0.1) { // 10% sampling for mouse tracking
            let mouseData = [];
            document.addEventListener('mousemove', (event) => {
                mouseData.push({
                    x: event.clientX,
                    y: event.clientY,
                    timestamp: Date.now()
                });

                // Limit data collection
                if (mouseData.length > 100) {
                    mouseData = mouseData.slice(-50);
                }
            });

            // Send mouse data periodically
            const mouseInterval = setInterval(() => {
                if (mouseData.length > 0) {
                    this.trackUserInteraction('mouse_movement', {
                        data: mouseData.slice(),
                        timestamp: Date.now()
                    });
                    mouseData = [];
                }
            }, 30000); // Every 30 seconds
            this.intervals.push(mouseInterval);
        }
    }

    // Error Tracking
    initializeErrorTracking() {
        // JavaScript errors
        window.addEventListener('error', (event) => {
            this.trackError({
                type: 'javascript',
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error?.stack,
                timestamp: Date.now()
            });
        });

        // Promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            // Don't track analytics-related promise rejections to prevent loops
            const reason = event.reason?.toString() || '';
            if (reason.includes('analytics') || reason.includes('Analytics') ||
                reason.includes('applicationServerKey') || reason.includes('PushManager')) {
                return; // Silently ignore
            }

            this.trackError({
                type: 'promise_rejection',
                reason: reason,
                stack: event.reason?.stack,
                timestamp: Date.now()
            });
        });

        // Resource loading errors
        window.addEventListener('error', (event) => {
            if (event.target !== window) {
                this.trackError({
                    type: 'resource',
                    element: event.target.tagName,
                    source: event.target.src || event.target.href,
                    timestamp: Date.now()
                });
            }
        }, true);
    }

    // Performance Monitoring
    initializePerformanceMonitoring() {
        // Memory usage (if available)
        if ('memory' in performance) {
            const memoryInterval = setInterval(() => {
                this.trackPerformance('memory', {
                    usedJSHeapSize: performance.memory.usedJSHeapSize,
                    totalJSHeapSize: performance.memory.totalJSHeapSize,
                    jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
                    timestamp: Date.now()
                });
            }, 30000); // Every 30 seconds
            this.intervals.push(memoryInterval);
        }

        // Connection information
        if ('connection' in navigator) {
            this.trackPerformance('connection', {
                effectiveType: navigator.connection.effectiveType,
                downlink: navigator.connection.downlink,
                rtt: navigator.connection.rtt,
                saveData: navigator.connection.saveData,
                timestamp: Date.now()
            });
        }

        // Device information
        // Avoid accessing cookieEnabled in file:// protocol to prevent browser warnings
        let cookieEnabled = false;
        try {
            if (window.location.protocol !== 'file:') {
                cookieEnabled = navigator.cookieEnabled;
            } else {
                // In file:// protocol, cookies don't work anyway
                cookieEnabled = false;
            }
        } catch (e) {
            // Silently handle any errors accessing cookieEnabled
            cookieEnabled = false;
        }

        this.trackPerformance('device', {
            userAgent: navigator.userAgent,
            language: navigator.language,
            platform: navigator.platform,
            cookieEnabled: cookieEnabled,
            onLine: navigator.onLine,
            screenWidth: screen.width,
            screenHeight: screen.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
            timestamp: Date.now()
        });

        // Page performance metrics
        window.addEventListener('load', () => {
            setTimeout(() => {
                this.collectPagePerformanceMetrics();
            }, 1000);
        });
    }

    // Data Collection Methods
    collectNavigationTiming() {
        const navigation = performance.getEntriesByType('navigation')[0];
        if (navigation) {
            this.trackPerformance('navigation', {
                dns: navigation.domainLookupEnd - navigation.domainLookupStart,
                tcp: navigation.connectEnd - navigation.connectStart,
                ssl: navigation.secureConnectionStart > 0 ?
                    navigation.connectEnd - navigation.secureConnectionStart : 0,
                ttfb: navigation.responseStart - navigation.requestStart,
                download: navigation.responseEnd - navigation.responseStart,
                domInteractive: navigation.domInteractive - navigation.navigationStart,
                domComplete: navigation.domComplete - navigation.navigationStart,
                loadComplete: navigation.loadEventEnd - navigation.navigationStart,
                timestamp: Date.now()
            });
        }
    }

    collectResourceTiming(entry) {
        // Only track significant resources
        if (entry.duration > 100 || entry.transferSize > 10000) {
            this.trackPerformance('resource', {
                name: entry.name,
                type: this.getResourceType(entry.name),
                duration: entry.duration,
                size: entry.transferSize,
                cached: entry.transferSize === 0 && entry.decodedBodySize > 0,
                timestamp: Date.now()
            });
        }
    }

    collectLongTask(entry) {
        this.trackPerformance('longtask', {
            duration: entry.duration,
            startTime: entry.startTime,
            attribution: entry.attribution?.map(attr => ({
                name: attr.name,
                entryType: attr.entryType,
                startTime: attr.startTime,
                duration: attr.duration
            })),
            timestamp: Date.now()
        });
    }

    calculateTTI() {
        // Simplified TTI calculation
        window.addEventListener('load', () => {
            setTimeout(() => {
                const navigation = performance.getEntriesByType('navigation')[0];
                if (navigation) {
                    // Approximate TTI as domInteractive + 50ms buffer
                    const tti = navigation.domInteractive + 50;
                    this.metrics.coreWebVitals.tti = {
                        value: tti,
                        timestamp: Date.now()
                    };
                }
            }, 1000);
        });
    }

    collectPagePerformanceMetrics() {
        const paintEntries = performance.getEntriesByType('paint');
        const navigationEntry = performance.getEntriesByType('navigation')[0];

        this.trackPerformance('page_metrics', {
            fcp: paintEntries.find(entry => entry.name === 'first-contentful-paint')?.startTime,
            fp: paintEntries.find(entry => entry.name === 'first-paint')?.startTime,
            domContentLoaded: navigationEntry?.domContentLoadedEventEnd - navigationEntry?.navigationStart,
            loadEvent: navigationEntry?.loadEventEnd - navigationEntry?.navigationStart,
            resourceCount: performance.getEntriesByType('resource').length,
            timestamp: Date.now()
        });
    }

    // Tracking Methods
    trackUserInteraction(type, data) {
        if (Math.random() > this.config.sampleRate) return;

        this.metrics.userBehavior.push({
            type,
            data,
            sessionId: this.sessionId,
            userId: this.userId,
            url: window.location.href,
            timestamp: Date.now()
        });
    }

    trackError(errorData) {
        // Don't track analytics errors themselves - this prevents cascading
        if (errorData && (errorData.message?.includes('analytics') || errorData.message?.includes('Analytics'))) {
            return; // Silently ignore analytics-related errors
        }

        this.metrics.errors.push({
            ...errorData,
            sessionId: this.sessionId,
            userId: this.userId,
            url: window.location.href,
            userAgent: navigator.userAgent
        });

        // Send errors immediately (but this will fail silently if server is down)
        this.sendData('error', [errorData]);
    }

    trackPerformance(type, data) {
        this.metrics.performance.push({
            type,
            data,
            sessionId: this.sessionId,
            userId: this.userId,
            url: window.location.href,
            timestamp: Date.now()
        });
    }

    // Custom event tracking
    trackCustomEvent(eventName, properties = {}) {
        this.trackUserInteraction('custom_event', {
            eventName,
            properties,
            timestamp: Date.now()
        });
    }

    // A/B Testing support
    trackExperiment(experimentId, variant, properties = {}) {
        this.trackCustomEvent('experiment_exposure', {
            experimentId,
            variant,
            properties
        });
    }

    // Conversion tracking
    trackConversion(conversionType, value = null, properties = {}) {
        this.trackCustomEvent('conversion', {
            conversionType,
            value,
            properties
        });
    }

    // Data Transmission
    startDataTransmission() {
        // Send data every 30 seconds
        const transmissionInterval = setInterval(() => {
            this.sendAllData();
        }, 30000);
        this.intervals.push(transmissionInterval);
    }

    setupBeforeUnload() {
        window.addEventListener('beforeunload', () => {
            this.sendAllData(true); // Use sendBeacon for reliability
            this.cleanup(); // Clean up intervals
        });

        // Also send on page hide (for mobile)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.sendAllData(true);
                this.cleanup(); // Clean up intervals
            }
        });
    }

    sendAllData(useBeacon = false) {
        if (this.metrics.performance.length > 0) {
            this.sendData('performance', this.metrics.performance, useBeacon);
            this.metrics.performance = [];
        }

        if (this.metrics.userBehavior.length > 0) {
            this.sendData('user_behavior', this.metrics.userBehavior, useBeacon);
            this.metrics.userBehavior = [];
        }

        if (Object.keys(this.metrics.coreWebVitals).length > 0) {
            this.sendData('core_web_vitals', this.metrics.coreWebVitals, useBeacon);
            this.metrics.coreWebVitals = {};
        }
    }

    sendData(type, data, useBeacon = false) {
        // Skip sending data if in file:// protocol to avoid CORS errors
        if (window.location.protocol === 'file:') {
            return;
        }

        // Skip analytics entirely if disabled in development (prevent connection refused errors)
        // Check BEFORE creating payload or making any network calls
        if (!this.config.enableInDevelopment && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
            // For localhost, skip analytics to prevent connection refused errors
            // Analytics can be enabled in production by setting enableInDevelopment: true
            return;
        }

        const payload = {
            type,
            data,
            sessionId: this.sessionId,
            userId: this.userId,
            timestamp: Date.now(),
            url: window.location.href
        };

        // Skip analytics if endpoint is not available (fail silently)
        // This prevents cascading errors when the backend is down
        try {
            if (useBeacon && 'sendBeacon' in navigator) {
                // Don't use sendBeacon on localhost - it still logs network errors
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    return;
                }
                const sent = navigator.sendBeacon(
                    this.config.apiEndpoint,
                    JSON.stringify(payload)
                );
                if (!sent) {
                    // Beacon failed, but don't log to avoid noise
                    return;
                }
            } else {
                // For analytics, use native fetch directly and completely ignore errors
                try {
                    const nativeFetch = window.__nativeFetch || window.fetch;
                    if (nativeFetch && typeof nativeFetch === 'function') {
                        // Use native fetch directly to bypass all wrappers
                        const fetchPromise = nativeFetch(this.config.apiEndpoint, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(payload),
                            keepalive: true
                        });

                        // Completely ignore the promise - don't even catch it
                        // This prevents any error propagation
                        fetchPromise.catch(() => {
                            // Completely silent - do nothing
                        });
                    }
                } catch (error) {
                    // Completely silent - do nothing, don't log, don't throw
                }
            }
        } catch (error) {
            // Silently fail - don't log analytics errors
        }
    }

    // Utility Methods
    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    getUserId() {
        // Try to get user ID from various sources
        const userId = localStorage.getItem('userId') ||
            sessionStorage.getItem('userId') ||
            this.getCookie('userId');

        if (!userId) {
            const newUserId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('userId', newUserId);
            return newUserId;
        }

        return userId;
    }

    getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
    }

    getResourceType(url) {
        if (url.match(/\.(css)$/)) return 'css';
        if (url.match(/\.(js)$/)) return 'js';
        if (url.match(/\.(png|jpg|jpeg|gif|webp|svg)$/)) return 'image';
        if (url.match(/\.(woff|woff2|ttf|eot)$/)) return 'font';
        return 'other';
    }

    // Public API
    getMetrics() {
        return {
            coreWebVitals: this.metrics.coreWebVitals,
            performance: this.metrics.performance,
            userBehavior: this.metrics.userBehavior,
            errors: this.metrics.errors
        };
    }

    // Configuration
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }

    // Cleanup method to clear all intervals
    cleanup() {
        this.intervals.forEach(intervalId => {
            try {
                clearInterval(intervalId);
            } catch (error) {
                console.warn('Error clearing interval:', error);
            }
        });
        this.intervals = [];
    }
}

// Initialize analytics when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.hmherbsAnalytics = new AdvancedAnalytics();
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdvancedAnalytics;
}
