// Advanced Code Quality Optimizer for HM Herbs
// Final polish for maintainability, performance, and developer experience

class CodeQualityOptimizer {
    constructor() {
        this.config = {
            enablePerformanceOptimization: true,
            enableMemoryOptimization: true,
            enableErrorBoundaries: true,
            enableCodeSplitting: true,
            enableLazyLoading: true,
            enableDebugMode: false
        };

        this.performanceMetrics = {
            functionCalls: new Map(),
            memoryUsage: [],
            errorCounts: new Map(),
            loadTimes: new Map()
        };

        this.optimizations = [];
        this.errorBoundaries = new Map();

        // Track intervals for cleanup
        this.intervals = [];

        this.init();
    }

    init() {
        // Set up performance monitoring
        this.setupPerformanceMonitoring();

        // Initialize memory optimization
        this.setupMemoryOptimization();
    }

    setupPerformanceMonitoring() {
        // Performance monitoring setup
        // This can be expanded with actual performance tracking
        if ('PerformanceObserver' in window) {
            try {
                const perfObserver = new PerformanceObserver((_list) => {
                    // Monitor performance entries
                });
                perfObserver.observe({ entryTypes: ['navigation', 'resource', 'paint'] });
            } catch (e) {
                // PerformanceObserver not fully supported
            }
        }

        // Set up error boundaries
        this.setupErrorBoundaries();

        // Initialize code splitting
        this.setupCodeSplitting();

        // Set up lazy loading optimization
        this.setupLazyLoadingOptimization();

        // Initialize debugging tools
        if (this.config.enableDebugMode) {
            this.setupDebuggingTools();
        }

        // Start quality monitoring
        this.startQualityMonitoring();
    }

    // Performance Optimization
    setupPerformanceOptimization() {
        // Function call optimization with memoization
        this.optimizeFunctionCalls();

        // DOM manipulation optimization
        this.optimizeDOMOperations();

        // Event listener optimization
        this.optimizeEventListeners();

        // Async operation optimization
        this.optimizeAsyncOperations();
    }

    optimizeFunctionCalls() {
        // Memoization decorator for expensive functions
        window.memoize = (fn, keyGenerator = (...args) => JSON.stringify(args)) => {
            const cache = new Map();

            return function (...args) {
                const key = keyGenerator(...args);

                if (cache.has(key)) {
                    return cache.get(key);
                }

                const result = fn.apply(this, args);
                cache.set(key, result);

                // Limit cache size to prevent memory leaks
                if (cache.size > 100) {
                    const firstKey = cache.keys().next().value;
                    cache.delete(firstKey);
                }

                return result;
            };
        };

        // Debounce decorator for frequent function calls
        window.debounce = (fn, delay = 300) => {
            let timeoutId;

            return function (...args) {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => fn.apply(this, args), delay);
            };
        };

        // Throttle decorator for high-frequency events
        window.throttle = (fn, limit = 100) => {
            let inThrottle;

            return function (...args) {
                if (!inThrottle) {
                    fn.apply(this, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            };
        };
    }

    optimizeDOMOperations() {
        // Batch DOM operations to minimize reflows
        window.batchDOMOperations = (operations) => {
            return new Promise((resolve) => {
                requestAnimationFrame(() => {
                    const fragment = document.createDocumentFragment();

                    operations.forEach(operation => {
                        if (typeof operation === 'function') {
                            operation(fragment);
                        }
                    });

                    resolve(fragment);
                });
            });
        };

        // Efficient element creation with attributes
        window.createElement = (tag, attributes = {}, children = []) => {
            const element = document.createElement(tag);

            // Set attributes efficiently
            Object.entries(attributes).forEach(([key, value]) => {
                if (key === 'className') {
                    element.className = value;
                } else if (key === 'textContent') {
                    element.textContent = value;
                } else if (key === 'innerHTML') {
                    element.innerHTML = value;
                } else if (key.startsWith('data-')) {
                    element.dataset[key.slice(5)] = value;
                } else {
                    element.setAttribute(key, value);
                }
            });

            // Add children efficiently
            children.forEach(child => {
                if (typeof child === 'string') {
                    element.appendChild(document.createTextNode(child));
                } else if (child instanceof Node) {
                    element.appendChild(child);
                }
            });

            return element;
        };
    }

    optimizeEventListeners() {
        // Event delegation optimization
        window.delegateEvent = (container, selector, event, handler) => {
            container.addEventListener(event, (e) => {
                const target = e.target.closest(selector);
                if (target) {
                    handler.call(target, e);
                }
            });
        };

        // Passive event listener optimization
        window.addPassiveListener = (element, event, handler) => {
            element.addEventListener(event, handler, { passive: true });
        };

        // Event listener cleanup tracking
        const eventListeners = new WeakMap();

        window.addTrackedListener = (element, event, handler, options = {}) => {
            element.addEventListener(event, handler, options);

            if (!eventListeners.has(element)) {
                eventListeners.set(element, []);
            }

            eventListeners.get(element).push({ event, handler, options });
        };

        window.removeAllListeners = (element) => {
            const listeners = eventListeners.get(element);
            if (listeners) {
                listeners.forEach(({ event, handler, options }) => {
                    element.removeEventListener(event, handler, options);
                });
                eventListeners.delete(element);
            }
        };
    }

    optimizeAsyncOperations() {
        // Promise pool for concurrent operation limiting
        window.createPromisePool = (concurrency = 5) => {
            let running = 0;
            const queue = [];

            const execute = async (promiseFactory) => {
                return new Promise((resolve, reject) => {
                    queue.push({ promiseFactory, resolve, reject });
                    process();
                });
            };

            const process = async () => {
                if (running >= concurrency || queue.length === 0) {
                    return;
                }

                running++;
                const { promiseFactory, resolve, reject } = queue.shift();

                try {
                    const result = await promiseFactory();
                    resolve(result);
                } catch (error) {
                    reject(error);
                } finally {
                    running--;
                    process();
                }
            };

            return { execute };
        };

        // Retry mechanism with exponential backoff
        window.retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    return await fn();
                } catch (error) {
                    if (attempt === maxRetries) {
                        throw error;
                    }

                    const delay = baseDelay * Math.pow(2, attempt);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        };
    }

    // Memory Optimization
    setupMemoryOptimization() {
        // Weak reference management
        this.setupWeakReferences();

        // Memory leak detection
        this.setupMemoryLeakDetection();

        // Garbage collection optimization
        this.setupGarbageCollectionOptimization();
    }

    setupWeakReferences() {
        // WeakMap for temporary data storage
        window.createWeakCache = () => {
            const cache = new WeakMap();

            return {
                set: (key, value) => cache.set(key, value),
                get: (key) => cache.get(key),
                has: (key) => cache.has(key),
                delete: (key) => cache.delete(key)
            };
        };

        // WeakSet for object tracking
        window.createWeakTracker = () => {
            const tracker = new WeakSet();

            return {
                add: (obj) => tracker.add(obj),
                has: (obj) => tracker.has(obj),
                delete: (obj) => tracker.delete(obj)
            };
        };
    }

    setupMemoryLeakDetection() {
        // Monitor DOM node creation and removal
        const nodeTracker = new Set();

        const originalCreateElement = document.createElement;
        document.createElement = function (tagName) {
            const element = originalCreateElement.call(this, tagName);
            nodeTracker.add(element);
            return element;
        };

        // Monitor for orphaned nodes
        const orphanedNodesInterval = setInterval(() => {
            let orphanedCount = 0;

            nodeTracker.forEach(node => {
                if (!document.contains(node)) {
                    nodeTracker.delete(node);
                    orphanedCount++;
                }
            });

            // Only warn if there are a significant number of orphaned nodes (potential memory leak)
            // This is normal during dynamic content updates, so we use a higher threshold
            if (orphanedCount > 50) {
                console.warn(`Detected ${orphanedCount} orphaned DOM nodes - this may indicate a memory leak`);
            }
        }, 30000); // Check every 30 seconds
        this.intervals.push(orphanedNodesInterval);
    }

    setupGarbageCollectionOptimization() {
        // Manual garbage collection hints
        window.triggerGC = () => {
            if (window.gc) {
                window.gc();
            } else {
                // Force garbage collection through memory pressure
                const arrays = [];
                for (let i = 0; i < 100; i++) {
                    arrays.push(new Array(1000000).fill(0));
                }
                arrays.length = 0;
            }
        };

        // Memory pressure monitoring
        if ('memory' in performance) {
            const memoryPressureInterval = setInterval(() => {
                const memory = performance.memory;
                const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;

                if (usageRatio > 0.9) {
                    console.warn('High memory usage detected:', usageRatio);
                    this.performMemoryCleanup();
                }
            }, 10000); // Check every 10 seconds
            this.intervals.push(memoryPressureInterval);
        }
    }

    performMemoryCleanup() {
        // Clear expired caches
        if (window.cacheManager) {
            window.cacheManager.clearExpiredCache();
        }

        // Clear analytics data
        if (window.hmherbsAnalytics) {
            window.hmherbsAnalytics.clearOldData();
        }

        // Trigger garbage collection
        window.triggerGC();
    }

    // Error Boundaries
    setupErrorBoundaries() {
        // Global error boundary
        window.addEventListener('error', (event) => {
            this.handleError('javascript', {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error
            });
        });

        // Promise rejection boundary
        window.addEventListener('unhandledrejection', (event) => {
            this.handleError('promise', {
                reason: event.reason,
                promise: event.promise
            });
        });

        // Component error boundary
        window.createErrorBoundary = (component, fallback) => {
            return (...args) => {
                try {
                    return component(...args);
                } catch (error) {
                    this.handleError('component', { error, component: component.name });
                    return fallback ? fallback(error) : null;
                }
            };
        };
    }

    handleError(type, details) {
        const errorId = `${type}_${Date.now()}`;

        this.errorBoundaries.set(errorId, {
            type,
            details,
            timestamp: Date.now(),
            userAgent: navigator.userAgent,
            url: window.location.href
        });

        // Update error count
        const count = this.performanceMetrics.errorCounts.get(type) || 0;
        this.performanceMetrics.errorCounts.set(type, count + 1);

        // Send to analytics if available
        if (window.hmherbsAnalytics) {
            window.hmherbsAnalytics.trackError({
                type,
                details,
                errorId
            });
        }

        // Show user-friendly error message for critical errors
        if (type === 'javascript' && details.message.includes('is not defined')) {
            this.showUserFriendlyError('A component failed to load. Please refresh the page.');
        }
    }

    showUserFriendlyError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-notification';
        errorDiv.textContent = message;
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #f44336;
            color: white;
            padding: 12px 16px;
            border-radius: 4px;
            z-index: 10000;
            font-family: system-ui, -apple-system, sans-serif;
        `;

        document.body.appendChild(errorDiv);

        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 5000);
    }

    // Code Splitting
    setupCodeSplitting() {
        // Dynamic import wrapper with error handling
        window.loadModule = async (modulePath) => {
            try {
                const module = await import(modulePath);
                return module;
            } catch (error) {
                console.error(`Failed to load module: ${modulePath}`, error);
                throw error;
            }
        };

        // Lazy component loader
        window.createLazyComponent = (loader) => {
            let component = null;
            let loading = false;

            return async (...args) => {
                if (component) {
                    return component(...args);
                }

                if (!loading) {
                    loading = true;
                    try {
                        component = await loader();
                    } catch (error) {
                        loading = false;
                        throw error;
                    }
                }

                return component(...args);
            };
        };
    }

    // Lazy Loading Optimization
    setupLazyLoadingOptimization() {
        // Intersection Observer for lazy loading
        if ('IntersectionObserver' in window) {
            this.setupIntersectionObserver();
        } else {
            this.setupFallbackLazyLoading();
        }

        // Preload critical resources
        this.preloadCriticalResources();
    }

    setupIntersectionObserver() {
        const lazyObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const element = entry.target;
                    this.loadLazyElement(element);
                    lazyObserver.unobserve(element);
                }
            });
        }, {
            rootMargin: '50px'
        });

        // Observe lazy elements
        document.querySelectorAll('[data-lazy]').forEach(element => {
            lazyObserver.observe(element);
        });

        // Set up mutation observer for dynamic content
        const mutationObserver = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1 && node.hasAttribute('data-lazy')) {
                        lazyObserver.observe(node);
                    }
                    if (node.querySelectorAll) {
                        node.querySelectorAll('[data-lazy]').forEach(element => {
                            lazyObserver.observe(element);
                        });
                    }
                });
            });
        });

        mutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    loadLazyElement(element) {
        const lazyType = element.dataset.lazy;

        switch (lazyType) {
            case 'image':
                this.loadLazyImage(element);
                break;
            case 'component':
                this.loadLazyComponent(element);
                break;
            case 'script':
                this.loadLazyScript(element);
                break;
            default:
                console.warn('Unknown lazy type:', lazyType);
        }
    }

    loadLazyImage(img) {
        const src = img.dataset.src;
        if (src) {
            img.src = src;
            img.removeAttribute('data-lazy');
            img.removeAttribute('data-src');
        }
    }

    async loadLazyComponent(element) {
        const componentPath = element.dataset.component;
        if (componentPath) {
            try {
                const module = await window.loadModule(componentPath);
                const component = module.default || module;

                if (typeof component === 'function') {
                    const result = component(element);
                    if (result instanceof Promise) {
                        await result;
                    }
                }

                element.removeAttribute('data-lazy');
                element.removeAttribute('data-component');
            } catch (error) {
                console.error('Failed to load lazy component:', error);
            }
        }
    }

    loadLazyScript(element) {
        const scriptSrc = element.dataset.script;
        if (scriptSrc) {
            const script = document.createElement('script');
            script.src = scriptSrc;
            script.async = true;

            script.onload = () => {
                element.removeAttribute('data-lazy');
                element.removeAttribute('data-script');
            };

            script.onerror = () => {
                console.error('Failed to load lazy script:', scriptSrc);
            };

            document.head.appendChild(script);
        }
    }

    preloadCriticalResources() {
        // Preload critical images
        const criticalImages = document.querySelectorAll('img[data-critical]');
        criticalImages.forEach(img => {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'image';
            link.href = img.src || img.dataset.src;
            document.head.appendChild(link);
        });

        // Preload critical scripts
        const criticalScripts = document.querySelectorAll('script[data-critical]');
        criticalScripts.forEach(script => {
            if (script.src) {
                const link = document.createElement('link');
                link.rel = 'preload';
                link.as = 'script';
                link.href = script.src;
                document.head.appendChild(link);
            }
        });
    }

    // Quality Monitoring
    startQualityMonitoring() {
        // Performance monitoring
        this.monitorPerformance();

        // Memory monitoring
        this.monitorMemory();

        // Error monitoring
        this.monitorErrors();

        // Generate quality report
        const qualityReportInterval = setInterval(() => {
            this.generateQualityReport();
        }, 60000); // Every minute
        this.intervals.push(qualityReportInterval);
    }

    monitorPerformance() {
        if ('PerformanceObserver' in window) {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    this.recordPerformanceMetric(entry);
                }
            });

            observer.observe({ entryTypes: ['measure', 'navigation', 'resource'] });
        }
    }

    recordPerformanceMetric(entry) {
        const metrics = this.performanceMetrics;

        if (entry.entryType === 'measure') {
            metrics.loadTimes.set(entry.name, entry.duration);
        } else if (entry.entryType === 'navigation') {
            metrics.loadTimes.set('page_load', entry.loadEventEnd - entry.navigationStart);
        }
    }

    monitorMemory() {
        if ('memory' in performance) {
            const memoryMonitorInterval = setInterval(() => {
                const memory = performance.memory;
                this.performanceMetrics.memoryUsage.push({
                    timestamp: Date.now(),
                    used: memory.usedJSHeapSize,
                    total: memory.totalJSHeapSize,
                    limit: memory.jsHeapSizeLimit
                });

                // Keep only last 100 measurements
                if (this.performanceMetrics.memoryUsage.length > 100) {
                    this.performanceMetrics.memoryUsage.shift();
                }
            }, 5000); // Every 5 seconds
            this.intervals.push(memoryMonitorInterval);
        }
    }

    monitorErrors() {
        // Error rate monitoring
        const errorMonitorInterval = setInterval(() => {
            const totalErrors = Array.from(this.performanceMetrics.errorCounts.values())
                .reduce((sum, count) => sum + count, 0);

            if (totalErrors > 10) {
                console.warn('High error rate detected:', totalErrors);
            }
        }, 30000); // Every 30 seconds
        this.intervals.push(errorMonitorInterval);
    }

    generateQualityReport() {
        const report = {
            timestamp: Date.now(),
            performance: {
                loadTimes: Object.fromEntries(this.performanceMetrics.loadTimes),
                memoryUsage: this.performanceMetrics.memoryUsage.slice(-10) // Last 10 measurements
            },
            errors: Object.fromEntries(this.performanceMetrics.errorCounts),
            optimizations: this.optimizations.length
        };

        // Send to analytics if available
        if (window.hmherbsAnalytics) {
            window.hmherbsAnalytics.trackCustomEvent('quality_report', report);
        }

        return report;
    }

    // Public API
    getQualityMetrics() {
        return {
            performance: this.performanceMetrics,
            errors: Array.from(this.errorBoundaries.values()),
            optimizations: this.optimizations
        };
    }

    optimizeFunction(fn, options = {}) {
        const { memoize = false, debounce = 0, throttle = 0 } = options;

        let optimizedFn = fn;

        if (memoize) {
            optimizedFn = window.memoize(optimizedFn);
        }

        if (debounce > 0) {
            optimizedFn = window.debounce(optimizedFn, debounce);
        }

        if (throttle > 0) {
            optimizedFn = window.throttle(optimizedFn, throttle);
        }

        return optimizedFn;
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

    clearMetrics() {
        this.performanceMetrics.functionCalls.clear();
        this.performanceMetrics.memoryUsage.length = 0;
        this.performanceMetrics.errorCounts.clear();
        this.performanceMetrics.loadTimes.clear();
        this.errorBoundaries.clear();
    }
}

// Initialize Code Quality Optimizer when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.codeQualityOptimizer = new CodeQualityOptimizer();

    // Setup cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (window.codeQualityOptimizer) {
            window.codeQualityOptimizer.cleanup();
        }
    });

    // Also cleanup on page hide (for mobile)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && window.codeQualityOptimizer) {
            window.codeQualityOptimizer.cleanup();
        }
    });
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CodeQualityOptimizer;
}
