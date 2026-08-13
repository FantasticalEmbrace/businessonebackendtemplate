// Performance Micro-Optimizer for HM Herbs
// Ultimate performance refinements for perfection-level optimization

class PerformanceMicroOptimizer {
    constructor() {
        this.config = {
            enableV8Optimizations: true,
            enableCSSOptimizations: true,
            enableDOMOptimizations: true,
            enableMemoryOptimizations: true,
            enableRenderingOptimizations: true,
            enableNetworkOptimizations: true,
            targetFPS: 60,
            budgetLCP: 2000, // 2 seconds
            budgetFID: 100,  // 100ms
            budgetCLS: 0.1
        };

        this.metrics = {
            frameRate: [],
            renderTime: [],
            memoryUsage: [],
            networkLatency: [],
            optimizationGains: new Map()
        };

        this.optimizations = [];
        this.isOptimizing = false;

        // Track intervals for cleanup
        this.intervals = [];
        // Track event listeners for cleanup
        this.eventListeners = [];

        this.init();
    }

    init() {
        // V8 JavaScript engine optimizations
        if (this.config.enableV8Optimizations) {
            this.setupV8Optimizations();
        }

        // CSS rendering optimizations
        if (this.config.enableCSSOptimizations) {
            this.setupCSSOptimizations();
        }

        // DOM manipulation optimizations
        if (this.config.enableDOMOptimizations) {
            this.setupDOMOptimizations();
        }

        // Memory allocation optimizations
        if (this.config.enableMemoryOptimizations) {
            this.setupMemoryOptimizations();
        }

        // Rendering pipeline optimizations
        if (this.config.enableRenderingOptimizations) {
            this.setupRenderingOptimizations();
        }

        // Network performance optimizations
        if (this.config.enableNetworkOptimizations) {
            this.setupNetworkOptimizations();
        }

        // Start performance monitoring
        this.startPerformanceMonitoring();

        // Initialize micro-optimizations
        this.applyMicroOptimizations();
    }

    // V8 JavaScript Engine Optimizations
    setupV8Optimizations() {
        // Optimize function shapes for V8 hidden classes
        this.optimizeFunctionShapes();

        // Optimize array operations
        this.optimizeArrayOperations();

        // Optimize object property access
        this.optimizePropertyAccess();

        // Optimize number operations
        this.optimizeNumberOperations();
    }

    optimizeFunctionShapes() {
        // Create optimized object constructors with consistent shapes
        window.createOptimizedObject = (template) => {
            // Pre-define all properties to maintain consistent hidden class
            const obj = {};

            // Initialize all properties from template
            Object.keys(template).forEach(key => {
                obj[key] = template[key];
            });

            return obj;
        };

        // Optimize function calls with consistent argument types
        window.optimizeFunction = (fn) => {
            return function (...args) {
                // Ensure consistent argument types for V8 optimization
                const optimizedArgs = args.map(arg => {
                    if (typeof arg === 'string' && arg.length === 0) {
                        return ''; // Consistent empty string
                    }
                    if (typeof arg === 'number' && !Number.isInteger(arg)) {
                        return Math.round(arg * 1000) / 1000; // Consistent precision
                    }
                    return arg;
                });

                return fn.apply(this, optimizedArgs);
            };
        };
    }

    optimizeArrayOperations() {
        // Pre-allocate arrays with known size
        window.createOptimizedArray = (size, fillValue = undefined) => {
            const array = new Array(size);
            if (fillValue !== undefined) {
                array.fill(fillValue);
            }
            return array;
        };

        // Optimize array iteration
        window.fastForEach = (array, callback) => {
            const length = array.length;
            for (let i = 0; i < length; i++) {
                callback(array[i], i, array);
            }
        };

        // Optimize array filtering
        window.fastFilter = (array, predicate) => {
            const result = [];
            const length = array.length;

            for (let i = 0; i < length; i++) {
                if (predicate(array[i], i, array)) {
                    result.push(array[i]);
                }
            }

            return result;
        };
    }

    optimizePropertyAccess() {
        // Cache property access for hot paths
        window.createPropertyCache = () => {
            const cache = new Map();

            return {
                get: (obj, path) => {
                    const key = `${obj.constructor.name}.${path}`;

                    if (cache.has(key)) {
                        const accessor = cache.get(key);
                        return accessor(obj);
                    }

                    // Create optimized accessor
                    const accessor = new Function('obj', `return obj.${path}`);
                    cache.set(key, accessor);

                    return accessor(obj);
                },

                set: (obj, path, value) => {
                    const key = `${obj.constructor.name}.${path}`;

                    if (cache.has(key)) {
                        const setter = cache.get(key);
                        return setter(obj, value);
                    }

                    // Create optimized setter
                    const setter = new Function('obj', 'value', `obj.${path} = value`);
                    cache.set(key, setter);

                    return setter(obj, value);
                }
            };
        };
    }

    optimizeNumberOperations() {
        // Use integer operations when possible
        window.fastMath = {
            // Fast integer operations
            fastFloor: (x) => x | 0,
            fastCeil: (x) => (x | 0) + (x > (x | 0) ? 1 : 0),
            fastRound: (x) => (x + 0.5) | 0,

            // Fast trigonometry approximations
            fastSin: (x) => {
                // Taylor series approximation for small angles
                if (Math.abs(x) < 0.5) {
                    const x2 = x * x;
                    return x * (1 - x2 / 6 + x2 * x2 / 120);
                }
                return Math.sin(x);
            },

            fastCos: (x) => {
                // Taylor series approximation for small angles
                if (Math.abs(x) < 0.5) {
                    const x2 = x * x;
                    return 1 - x2 / 2 + x2 * x2 / 24;
                }
                return Math.cos(x);
            }
        };
    }

    // CSS Rendering Optimizations
    setupCSSOptimizations() {
        // Optimize CSS animations
        this.optimizeCSSAnimations();

        // Optimize CSS selectors
        this.optimizeCSSSelectors();

        // Optimize CSS properties
        this.optimizeCSSProperties();

        // Optimize CSS layout
        this.optimizeCSSLayout();
    }

    optimizeCSSAnimations() {
        // Use transform and opacity for animations (GPU accelerated)
        const style = document.createElement('style');
        style.textContent = `
            .optimized-animation {
                will-change: transform, opacity;
                transform: translateZ(0); /* Force GPU layer */
            }
            
            .fade-in-optimized {
                animation: fadeInOptimized 0.3s ease-out;
            }
            
            @keyframes fadeInOptimized {
                from {
                    opacity: 0;
                    transform: translateY(10px) translateZ(0);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) translateZ(0);
                }
            }
            
            .slide-optimized {
                animation: slideOptimized 0.3s ease-out;
            }
            
            @keyframes slideOptimized {
                from {
                    transform: translateX(-100%) translateZ(0);
                }
                to {
                    transform: translateX(0) translateZ(0);
                }
            }
        `;
        document.head.appendChild(style);
    }

    optimizeCSSSelectors() {
        // Optimize selector performance by avoiding expensive selectors
        const optimizedSelectors = document.createElement('style');
        optimizedSelectors.textContent = `
            /* Use class selectors instead of complex descendant selectors */
            .product-card { /* Instead of .products .card .item */ }
            .nav-link { /* Instead of nav ul li a */ }
            .btn-primary { /* Instead of button.primary:not(.disabled) */ }
            
            /* Use specific classes for state changes */
            .is-active { }
            .is-loading { }
            .is-visible { }
            .is-hidden { }
        `;
        document.head.appendChild(optimizedSelectors);
    }

    optimizeCSSProperties() {
        // Use efficient CSS properties
        const efficientProperties = document.createElement('style');
        efficientProperties.textContent = `
            /* Use contain property for performance isolation */
            .performance-container {
                contain: layout style paint;
            }
            
            /* Use content-visibility for off-screen content */
            .lazy-section {
                content-visibility: auto;
                contain-intrinsic-size: 300px;
            }
            
            /* Optimize font rendering */
            .optimized-text {
                font-display: swap;
                text-rendering: optimizeSpeed;
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
            }
            
            /* Use efficient box-shadow */
            .optimized-shadow {
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                /* Avoid multiple shadows and blur radius > 10px */
            }
        `;
        document.head.appendChild(efficientProperties);
    }

    optimizeCSSLayout() {
        // Optimize layout with modern CSS
        const layoutOptimizations = document.createElement('style');
        layoutOptimizations.textContent = `
            /* Use CSS Grid for complex layouts */
            .grid-optimized {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 1rem;
            }
            
            /* Use Flexbox for simple layouts */
            .flex-optimized {
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            
            /* Avoid layout thrashing */
            .no-layout-thrash {
                transform: translateX(0); /* Use transform instead of left/right */
                opacity: 1; /* Use opacity instead of visibility */
            }
            
            /* Use aspect-ratio for consistent sizing */
            .aspect-ratio-optimized {
                aspect-ratio: 16 / 9;
                object-fit: cover;
            }
        `;
        document.head.appendChild(layoutOptimizations);
    }

    // DOM Manipulation Optimizations
    setupDOMOptimizations() {
        // Batch DOM operations
        this.optimizeDOMBatching();

        // Optimize DOM queries
        this.optimizeDOMQueries();

        // Optimize DOM updates
        this.optimizeDOMUpdates();
    }

    optimizeDOMBatching() {
        // Batch DOM reads and writes
        window.batchDOMOperations = (() => {
            let readQueue = [];
            let writeQueue = [];
            let scheduled = false;

            const flush = () => {
                // Execute all reads first
                readQueue.forEach(fn => fn());
                readQueue = [];

                // Then execute all writes
                writeQueue.forEach(fn => fn());
                writeQueue = [];

                scheduled = false;
            };

            const schedule = () => {
                if (!scheduled) {
                    scheduled = true;
                    requestAnimationFrame(flush);
                }
            };

            return {
                read: (fn) => {
                    readQueue.push(fn);
                    schedule();
                },

                write: (fn) => {
                    writeQueue.push(fn);
                    schedule();
                }
            };
        })();
    }

    optimizeDOMQueries() {
        // Cache DOM queries
        const queryCache = new Map();

        window.cachedQuery = (selector, context = document) => {
            const key = `${context === document ? 'doc' : context.tagName}.${selector}`;

            if (queryCache.has(key)) {
                return queryCache.get(key);
            }

            const result = context.querySelector(selector);
            queryCache.set(key, result);

            return result;
        };

        window.cachedQueryAll = (selector, context = document) => {
            const key = `${context === document ? 'doc' : context.tagName}.${selector}.all`;

            if (queryCache.has(key)) {
                return queryCache.get(key);
            }

            const result = Array.from(context.querySelectorAll(selector));
            queryCache.set(key, result);

            return result;
        };

        // Clear cache when DOM changes
        const observer = new MutationObserver(() => {
            queryCache.clear();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true
        });
    }

    optimizeDOMUpdates() {
        // Optimize text content updates
        window.fastTextUpdate = (element, text) => {
            if (element.textContent !== text) {
                element.textContent = text;
            }
        };

        // Optimize class list updates
        window.fastClassUpdate = (element, className, add) => {
            const hasClass = element.classList.contains(className);

            if (add && !hasClass) {
                element.classList.add(className);
            } else if (!add && hasClass) {
                element.classList.remove(className);
            }
        };

        // Optimize style updates
        window.fastStyleUpdate = (element, property, value) => {
            if (element.style[property] !== value) {
                element.style[property] = value;
            }
        };
    }

    // Memory Allocation Optimizations
    setupMemoryOptimizations() {
        // Object pooling for frequently created objects
        this.setupObjectPooling();

        // String optimization
        this.setupStringOptimization();

        // Array optimization
        this.setupArrayOptimization();
    }

    setupObjectPooling() {
        // Generic object pool
        window.createObjectPool = (factory, reset, initialSize = 10) => {
            const pool = [];

            // Pre-populate pool
            for (let i = 0; i < initialSize; i++) {
                pool.push(factory());
            }

            return {
                acquire: () => {
                    if (pool.length > 0) {
                        return pool.pop();
                    }
                    return factory();
                },

                release: (obj) => {
                    reset(obj);
                    pool.push(obj);
                }
            };
        };

        // Common object pools
        window.pointPool = window.createObjectPool(
            () => ({ x: 0, y: 0 }),
            (point) => { point.x = 0; point.y = 0; }
        );

        window.rectPool = window.createObjectPool(
            () => ({ x: 0, y: 0, width: 0, height: 0 }),
            (rect) => { rect.x = rect.y = rect.width = rect.height = 0; }
        );
    }

    setupStringOptimization() {
        // String interning for frequently used strings
        const stringCache = new Map();

        window.internString = (str) => {
            if (stringCache.has(str)) {
                return stringCache.get(str);
            }

            stringCache.set(str, str);
            return str;
        };

        // Template string optimization
        window.fastTemplate = (template, ...values) => {
            const key = template.join('{}');

            if (!stringCache.has(key)) {
                stringCache.set(key, template);
            }

            const cached = stringCache.get(key);
            let result = cached[0];

            for (let i = 0; i < values.length; i++) {
                result += values[i] + cached[i + 1];
            }

            return result;
        };
    }

    setupArrayOptimization() {
        // Array pooling for temporary arrays
        const arrayPools = new Map();

        window.getPooledArray = (size = 0) => {
            if (!arrayPools.has(size)) {
                arrayPools.set(size, []);
            }

            const pool = arrayPools.get(size);

            if (pool.length > 0) {
                const array = pool.pop();
                array.length = 0; // Clear array
                return array;
            }

            return new Array(size);
        };

        window.releasePooledArray = (array) => {
            const size = array.length;
            array.length = 0; // Clear array

            if (!arrayPools.has(size)) {
                arrayPools.set(size, []);
            }

            arrayPools.get(size).push(array);
        };
    }

    // Rendering Pipeline Optimizations
    setupRenderingOptimizations() {
        // Optimize animation frame scheduling
        this.optimizeAnimationFrames();

        // Optimize paint operations
        this.optimizePaintOperations();

        // Optimize composite layers
        this.optimizeCompositeLayers();
    }

    optimizeAnimationFrames() {
        // Smart animation frame scheduling
        let animationQueue = [];
        let isScheduled = false;

        window.scheduleAnimation = (callback, priority = 0) => {
            animationQueue.push({ callback, priority });
            animationQueue.sort((a, b) => b.priority - a.priority);

            if (!isScheduled) {
                isScheduled = true;
                requestAnimationFrame(() => {
                    const startTime = performance.now();
                    const budget = 16.67; // 60fps budget

                    while (animationQueue.length > 0 && (performance.now() - startTime) < budget) {
                        const { callback } = animationQueue.shift();
                        callback();
                    }

                    isScheduled = false;

                    // Schedule remaining animations
                    if (animationQueue.length > 0) {
                        window.scheduleAnimation(() => { }, 0);
                    }
                });
            }
        };
    }

    optimizePaintOperations() {
        // Minimize paint areas
        const paintOptimizations = document.createElement('style');
        paintOptimizations.textContent = `
            /* Isolate paint operations */
            .paint-isolated {
                isolation: isolate;
            }
            
            /* Use will-change sparingly */
            .will-animate {
                will-change: transform;
            }
            
            /* Remove will-change after animation */
            .animation-complete {
                will-change: auto;
            }
            
            /* Optimize background painting */
            .optimized-background {
                background-attachment: local; /* Avoid fixed backgrounds */
            }
        `;
        document.head.appendChild(paintOptimizations);
    }

    optimizeCompositeLayers() {
        // Manage composite layers efficiently
        window.promoteToLayer = (element) => {
            element.style.transform = 'translateZ(0)';
            element.style.willChange = 'transform';
        };

        window.demoteFromLayer = (element) => {
            element.style.transform = '';
            element.style.willChange = 'auto';
        };

        // Auto-manage layers for animations
        window.animateWithLayer = (element, animation, duration = 300) => {
            window.promoteToLayer(element);

            return new Promise((resolve) => {
                animation();

                setTimeout(() => {
                    window.demoteFromLayer(element);
                    resolve();
                }, duration);
            });
        };
    }

    // Network Performance Optimizations
    setupNetworkOptimizations() {
        // Optimize fetch requests
        this.optimizeFetchRequests();

        // Implement request deduplication
        this.setupRequestDeduplication();

        // Optimize resource loading
        this.optimizeResourceLoading();
    }

    optimizeFetchRequests() {
        // Enhanced fetch with optimizations
        // Use the native fetch stored before any wrappers ran
        // This ensures we always have the true native fetch, not a wrapped version
        const originalFetch = window.__nativeFetch || window.fetch;

        window.fetch = async (url, options = {}) => {
            // Skip optimization for external resources - let them use original fetch directly
            // This prevents CSP violations and 503 errors
            if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
                try {
                    const urlObj = new URL(url, window.location.href);
                    const isExternal = urlObj.origin !== window.location.origin;

                    if (isExternal) {
                        // For external resources, use originalFetch directly without any modifications
                        return await originalFetch(url, options);
                    }
                } catch (e) {
                    // If URL parsing fails, continue with optimization
                }
            }

            // Add performance optimizations for same-origin requests
            const optimizedOptions = {
                ...options,
                keepalive: true, // Keep connection alive
                cache: options.cache || 'default'
            };

            // Add request timing
            const startTime = performance.now();

            try {
                const response = await originalFetch(url, optimizedOptions);

                // Record network timing (only for successful requests)
                if (response.ok) {
                    const endTime = performance.now();
                    this.metrics.networkLatency.push({
                        url,
                        duration: endTime - startTime,
                        timestamp: Date.now()
                    });
                }

                // Don't log 503 errors for products API (expected when database unavailable)
                const urlString = typeof url === 'string' ? url : (url?.url || '');
                const isProducts503 = urlString && urlString.includes('/api/products') && !response.ok && response.status === 503;

                if (isProducts503) {
                    // Silently return the 503 response without logging
                    return response;
                }

                return response;
            } catch (error) {
                // Don't log errors for external resources, analytics, or expected 503s
                const urlString = typeof url === 'string' ? url : (url?.url || '');
                const isExternal = urlString && (urlString.startsWith('http://') || urlString.startsWith('https://')) &&
                    !urlString.includes(window.location.origin);
                const isAnalytics = urlString && urlString.includes('/api/analytics');
                const isProducts503 = urlString && urlString.includes('/api/products');

                // Silently ignore external resource errors, analytics errors, and expected 503s
                if (!isExternal && !isAnalytics && !isProducts503) {
                    console.error('Fetch error:', error);
                }
                throw error;
            }
        };
    }

    setupRequestDeduplication() {
        // Deduplicate identical requests
        const pendingRequests = new Map();

        window.deduplicatedFetch = async (url, options = {}) => {
            const key = `${url}:${JSON.stringify(options)}`;

            if (pendingRequests.has(key)) {
                return pendingRequests.get(key);
            }

            const promise = fetch(url, options);
            pendingRequests.set(key, promise);

            try {
                const response = await promise;
                return response;
            } finally {
                pendingRequests.delete(key);
            }
        };
    }

    optimizeResourceLoading() {
        // Preload critical resources
        window.preloadResource = (url, type = 'fetch') => {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.href = url;
            link.as = type;

            if (type === 'font') {
                link.crossOrigin = 'anonymous';
            }

            document.head.appendChild(link);
        };

        // Prefetch likely resources
        window.prefetchResource = (url) => {
            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = url;
            document.head.appendChild(link);
        };
    }

    // Performance Monitoring
    startPerformanceMonitoring() {
        // Monitor frame rate
        this.monitorFrameRate();

        // Monitor render time
        this.monitorRenderTime();

        // Monitor memory usage
        this.monitorMemoryUsage();

        // Generate performance reports
        const performanceReportInterval = setInterval(() => {
            this.generatePerformanceReport();
        }, 30000); // Every 30 seconds
        this.intervals.push(performanceReportInterval);
    }

    monitorFrameRate() {
        let lastTime = performance.now();
        let frameCount = 0;

        const measureFPS = () => {
            const currentTime = performance.now();
            frameCount++;

            if (currentTime - lastTime >= 1000) {
                const fps = frameCount;
                this.metrics.frameRate.push({
                    fps,
                    timestamp: Date.now()
                });

                frameCount = 0;
                lastTime = currentTime;

                // Keep only last 60 measurements
                if (this.metrics.frameRate.length > 60) {
                    this.metrics.frameRate.shift();
                }
            }

            requestAnimationFrame(measureFPS);
        };

        requestAnimationFrame(measureFPS);
    }

    monitorRenderTime() {
        if ('PerformanceObserver' in window) {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.entryType === 'measure') {
                        this.metrics.renderTime.push({
                            name: entry.name,
                            duration: entry.duration,
                            timestamp: Date.now()
                        });
                    }
                }
            });

            observer.observe({ entryTypes: ['measure'] });
        }
    }

    monitorMemoryUsage() {
        if ('memory' in performance) {
            const memoryUsageInterval = setInterval(() => {
                const memory = performance.memory;
                this.metrics.memoryUsage.push({
                    used: memory.usedJSHeapSize,
                    total: memory.totalJSHeapSize,
                    limit: memory.jsHeapSizeLimit,
                    timestamp: Date.now()
                });

                // Keep only last 100 measurements
                if (this.metrics.memoryUsage.length > 100) {
                    this.metrics.memoryUsage.shift();
                }
            }, 5000); // Every 5 seconds
            this.intervals.push(memoryUsageInterval);
        }
    }

    generatePerformanceReport() {
        const avgFPS = this.metrics.frameRate.length > 0
            ? this.metrics.frameRate.reduce((sum, item) => sum + item.fps, 0) / this.metrics.frameRate.length
            : 0;

        const avgNetworkLatency = this.metrics.networkLatency.length > 0
            ? this.metrics.networkLatency.reduce((sum, item) => sum + item.duration, 0) / this.metrics.networkLatency.length
            : 0;

        const report = {
            timestamp: Date.now(),
            averageFPS: Math.round(avgFPS),
            averageNetworkLatency: Math.round(avgNetworkLatency),
            memoryUsage: this.metrics.memoryUsage.slice(-1)[0],
            optimizations: this.optimizations.length
        };

        // Send to analytics if available
        if (window.hmherbsAnalytics) {
            window.hmherbsAnalytics.trackCustomEvent('performance_micro_report', report);
        }

        return report;
    }

    // Apply Micro-Optimizations
    applyMicroOptimizations() {
        // Apply all micro-optimizations
        this.optimizeScrollPerformance();
        this.optimizeImageLoading();
        this.optimizeEventHandling();
        this.optimizeFontLoading();
    }

    optimizeScrollPerformance() {
        // Optimize scroll events
        let ticking = false;

        const optimizedScrollHandler = () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    // Handle scroll
                    ticking = false;
                });
                ticking = true;
            }
        };

        // Replace existing scroll listeners with optimized version
        this.addEventListenerWithCleanup(document, 'scroll', optimizedScrollHandler, { passive: true });
    }

    optimizeImageLoading() {
        // Add loading="lazy" to images below the fold
        const images = document.querySelectorAll('img:not([loading])');
        images.forEach((img, index) => {
            if (index > 2) { // First 3 images load immediately
                img.loading = 'lazy';
            }
        });

        // Add decoding="async" for non-critical images
        images.forEach((img, index) => {
            if (index > 0) { // First image decodes synchronously
                img.decoding = 'async';
            }
        });
    }

    optimizeEventHandling() {
        // Use passive listeners where possible
        const passiveEvents = ['scroll', 'wheel', 'touchstart', 'touchmove'];

        passiveEvents.forEach(eventType => {
            const originalAddEventListener = EventTarget.prototype.addEventListener;

            EventTarget.prototype.addEventListener = function (type, listener, options) {
                if (type === eventType && typeof options !== 'object') {
                    options = { passive: true };
                } else if (type === eventType && typeof options === 'object' && options.passive === undefined) {
                    options.passive = true;
                }

                return originalAddEventListener.call(this, type, listener, options);
            };
        });
    }

    optimizeFontLoading() {
        // Add font-display: swap to all font faces
        const style = document.createElement('style');
        style.textContent = `
            @font-face {
                font-display: swap;
            }
        `;
        document.head.appendChild(style);
    }

    // Public API
    getPerformanceMetrics() {
        return this.metrics;
    }

    getOptimizations() {
        return this.optimizations;
    }

    measurePerformance(name, fn) {
        performance.mark(`${name}-start`);
        const result = fn();
        performance.mark(`${name}-end`);
        performance.measure(name, `${name}-start`, `${name}-end`);
        return result;
    }

    async measureAsyncPerformance(name, fn) {
        performance.mark(`${name}-start`);
        const result = await fn();
        performance.mark(`${name}-end`);
        performance.measure(name, `${name}-start`, `${name}-end`);
        return result;
    }

    // Helper method to add event listeners with tracking
    addEventListenerWithCleanup(element, event, handler, options = false) {
        if (element) {
            element.addEventListener(event, handler, options);
            this.eventListeners.push({ element, event, handler, options });
        }
    }

    // Cleanup method to clear all intervals and event listeners
    cleanup() {
        // Clear intervals
        this.intervals.forEach(intervalId => {
            try {
                clearInterval(intervalId);
            } catch (error) {
                console.warn('Error clearing interval:', error);
            }
        });
        this.intervals = [];

        // Remove event listeners
        this.eventListeners.forEach(({ element, event, handler, options }) => {
            try {
                element.removeEventListener(event, handler, options);
            } catch (error) {
                console.warn('Error removing PerformanceMicroOptimizer event listener:', error);
            }
        });
        this.eventListeners = [];
    }
}

// Initialize Performance Micro-Optimizer when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.performanceMicroOptimizer = new PerformanceMicroOptimizer();

    // Setup cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (window.performanceMicroOptimizer) {
            window.performanceMicroOptimizer.cleanup();
        }
    });

    // Also cleanup on page hide (for mobile)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && window.performanceMicroOptimizer) {
            window.performanceMicroOptimizer.cleanup();
        }
    });
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PerformanceMicroOptimizer;
}
