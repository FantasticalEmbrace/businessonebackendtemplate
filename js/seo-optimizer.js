// Advanced SEO Optimizer for HM Herbs
// Next-level SEO enhancements and Core Web Vitals micro-optimizations

class SEOOptimizer {
    constructor() {
        this.config = {
            enableCriticalCSS: true,
            enableResourceHints: true,
            enableImageOptimization: true,
            enableStructuredData: true,
            enableCoreWebVitalsOptimization: true,
            enableSitemapGeneration: true,
            targetLCP: 2500, // 2.5 seconds
            targetFID: 100, // 100ms
            targetCLS: 0.1
        };

        this.coreWebVitals = {
            lcp: null,
            fid: null,
            cls: null,
            fcp: null,
            ttfb: null
        };

        this.optimizations = [];
        this.criticalResources = [];
        this.eventListeners = []; // Track event listeners for cleanup
        this.clsOptimized = false; // Track if CLS has been optimized to prevent multiple logs

        this.init();
    }

    async init() {
        // Initialize Core Web Vitals monitoring
        if (this.config.enableCoreWebVitalsOptimization) {
            this.initializeCoreWebVitalsOptimization();
        }

        // Set up critical CSS extraction
        if (this.config.enableCriticalCSS) {
            this.setupCriticalCSS();
        }

        // Initialize resource hints optimization
        if (this.config.enableResourceHints) {
            this.setupResourceHints();
        }

        // Set up image optimization
        if (this.config.enableImageOptimization) {
            this.setupImageOptimization();
        }

        // Initialize structured data enhancements
        if (this.config.enableStructuredData) {
            this.setupAdvancedStructuredData();
        }

        // Set up sitemap generation
        if (this.config.enableSitemapGeneration) {
            this.setupSitemapGeneration();
        }

        // Initialize technical SEO optimizations
        this.setupTechnicalSEO();
    }

    setupSitemapGeneration() {
        // Set up sitemap generation functionality
        // This is a placeholder - actual sitemap generation would typically be server-side
        if (window.location.protocol === 'file:') {
            // Skip sitemap generation for file:// protocol
            return;
        }

        // Check if sitemap.xml exists
        // Use native fetch with silent error handling to avoid console noise
        try {
            const nativeFetch = window.__nativeFetch || window.fetch;
            nativeFetch('/sitemap.xml')
                .then(response => {
                    if (response && response.ok) {
                        // Sitemap exists - can be used for SEO
                    }
                })
                .catch(() => {
                    // Silently ignore - sitemap may be generated server-side
                });
        } catch (error) {
            // Silently ignore
        }

        // Add sitemap reference to robots.txt if needed
        // This would typically be done server-side
    }

    setupCriticalCSS() {
        // Set up critical CSS extraction and inlining
        // Critical CSS is the CSS needed for above-the-fold content

        // Extract and inline critical CSS
        const criticalCSS = this.extractCriticalCSS();

        if (criticalCSS) {
            // Create a style element for critical CSS
            const style = document.createElement('style');
            style.id = 'critical-css';
            style.textContent = criticalCSS;

            // Insert critical CSS at the beginning of head for faster rendering
            if (document.head) {
                document.head.insertBefore(style, document.head.firstChild);
            }
        }

        // Load non-critical CSS asynchronously
        const nonCriticalStylesheets = document.querySelectorAll('link[rel="stylesheet"][data-non-critical]');
        nonCriticalStylesheets.forEach(link => {
            link.setAttribute('media', 'print');
            link.setAttribute('onload', "this.media='all'");
            // Fallback for browsers that don't support onload
            const noscript = document.createElement('noscript');
            const fallbackLink = link.cloneNode(true);
            fallbackLink.removeAttribute('data-non-critical');
            fallbackLink.removeAttribute('media');
            fallbackLink.removeAttribute('onload');
            noscript.appendChild(fallbackLink);
            link.parentNode.insertBefore(noscript, link.nextSibling);
        });
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
                // Silently ignore cleanup errors
            }
        });
        this.eventListeners = [];
    }

    initializeCoreWebVitalsOptimization() {
        // Largest Contentful Paint (LCP) optimization
        this.optimizeLCP();

        // First Input Delay (FID) optimization
        this.optimizeFID();

        // Cumulative Layout Shift (CLS) optimization
        this.optimizeCLS();

        // First Contentful Paint (FCP) optimization
        this.optimizeFCP();

        // Time to First Byte (TTFB) optimization
        this.optimizeTTFB();

        // Set up Core Web Vitals monitoring
        this.monitorCoreWebVitals();
    }

    optimizeTTFB() {
        // Optimize Time to First Byte (TTFB) - mostly server-side, but some client optimizations
        // TTFB measures the time from when a user requests a page to when the first byte is received

        // Preconnect to important origins
        const importantOrigins = [
            'https://fonts.googleapis.com',
            'https://fonts.gstatic.com',
            'https://hmherbs.com'
        ];

        importantOrigins.forEach(origin => {
            if (window.location.protocol !== 'file:') {
                const link = document.createElement('link');
                link.rel = 'preconnect';
                link.href = origin;
                link.crossOrigin = 'anonymous';
                document.head.appendChild(link);
            }
        });

        // DNS prefetch for external resources
        const dnsPrefetchDomains = [
            'fonts.googleapis.com',
            'fonts.gstatic.com'
        ];

        dnsPrefetchDomains.forEach(domain => {
            if (window.location.protocol !== 'file:') {
                const link = document.createElement('link');
                link.rel = 'dns-prefetch';
                link.href = `https://${domain}`;
                document.head.appendChild(link);
            }
        });

        // Minimize redirects (client-side check)
        // Note: Most redirect optimization happens server-side
        // This is just a placeholder for client-side optimizations
    }

    optimizeLCP() {
        // Preload LCP element
        this.identifyAndPreloadLCPElement();

        // Optimize LCP image loading
        this.optimizeLCPImages();

        // Remove render-blocking resources
        this.removeRenderBlockingResources();

        // Optimize server response time
        this.optimizeServerResponse();
    }

    optimizeServerResponse() {
        // Server response optimization
        // This is a placeholder for server-side optimizations
        // Can be expanded with actual response time optimizations
        if (window.location.protocol === 'file:') {
            // Skip server optimizations for file:// protocol
            return;
        }
        // Add any client-side optimizations here
    }

    identifyAndPreloadLCPElement() {
        // Common LCP candidates
        const lcpCandidates = [
            'img[src*="hero"]',
            '.hero img',
            '.banner img',
            'h1',
            '.main-content img:first-of-type',
            '.featured-image img'
        ];

        lcpCandidates.forEach(selector => {
            const element = document.querySelector(selector);
            if (element) {
                if (element.tagName === 'IMG') {
                    this.preloadImage(element.src || element.dataset.src);
                } else if (element.tagName === 'H1') {
                    // Preload font for H1
                    this.preloadFont(getComputedStyle(element).fontFamily);
                }
            }
        });
    }

    optimizeLCPImages() {
        const images = document.querySelectorAll('img');
        images.forEach((img, index) => {
            if (index < 3) { // First 3 images are likely above-the-fold
                // Add fetchpriority="high" for modern browsers
                img.setAttribute('fetchpriority', 'high');

                // Ensure no lazy loading for above-the-fold images
                img.removeAttribute('loading');

                // Add decoding="sync" for critical images
                img.setAttribute('decoding', 'sync');
            }
        });
    }

    /**
     * Never defer same-origin stylesheets with media=print + onload.
     * The first stylesheet is only emergency-fixes; main styles.css was being deferred.
     * If onload does not run (CSP, timing), the page stays unstyled.
     */
    shouldDeferStylesheet(link) {
        const href = link.href || link.getAttribute('href') || '';
        if (!href) return false;
        try {
            const url = new URL(href, window.location.href);
            return url.origin !== window.location.origin;
        } catch (e) {
            return false;
        }
    }

    removeRenderBlockingResources() {
        // Defer non-critical third-party CSS only (never same-origin app CSS)
        const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');
        stylesheets.forEach(link => {
            if (!this.shouldDeferStylesheet(link)) return;
            if (!this.isCriticalCSS(link.href)) {
                link.setAttribute('media', 'print');
                link.setAttribute('onload', "this.media='all'");
            }
        });

        // Defer non-critical JavaScript
        const scripts = document.querySelectorAll('script[src]');
        scripts.forEach(script => {
            if (!this.isCriticalScript(script.src)) {
                script.setAttribute('defer', '');
            }
        });
    }

    optimizeFID() {
        // Break up long tasks
        this.breakUpLongTasks();

        // Optimize third-party code
        this.optimizeThirdPartyCode();

        // Use web workers for heavy computations
        this.setupWebWorkers();
    }

    optimizeThirdPartyCode() {
        // Optimize third-party scripts and resources
        // This can be expanded with actual third-party optimization
        if (window.location.protocol === 'file:') {
            // Skip third-party optimizations for file:// protocol
            return;
        }

        // Defer non-critical third-party scripts
        const thirdPartyScripts = document.querySelectorAll('script[src*="google"], script[src*="facebook"], script[src*="analytics"]');
        thirdPartyScripts.forEach(script => {
            if (!script.hasAttribute('defer') && !script.hasAttribute('async')) {
                script.setAttribute('defer', '');
            }
        });
    }

    setupWebWorkers() {
        // Set up web workers for heavy computations
        // This is a placeholder - can be expanded with actual web worker implementation
        if (window.location.protocol === 'file:') {
            // Skip web workers for file:// protocol (they don't work with file://)
            return;
        }

        // Check if Web Workers are supported
        if (typeof Worker !== 'undefined') {
            // Web Workers are available
            // Can be used for heavy computations like image processing, data parsing, etc.
            // Implementation would go here if needed
        }
    }

    breakUpLongTasks() {
        // Use scheduler.postTask if available, otherwise setTimeout
        const scheduleTask = (callback) => {
            const sched = window.scheduler;
            if (sched && typeof sched.postTask === 'function') {
                sched.postTask(callback, { priority: 'user-blocking' });
            } else {
                setTimeout(callback, 0);
            }
        };

        // Example: Break up form validation
        const forms = document.querySelectorAll('form');
        forms.forEach(form => {
            // EDSA + auth forms own submit (API / redirect); native form.submit() breaks booking redirect.
            if (
                form.id === 'edsa-booking-form' ||
                form.id === 'customer-login-form' ||
                form.id === 'customer-register-form' ||
                form.id === 'customer-forgot-password-form'
            ) {
                return;
            }
            this.addEventListenerWithCleanup(form, 'submit', (e) => {
                e.preventDefault();

                // Break validation into chunks
                const fields = Array.from(form.elements);
                const validateChunk = (startIndex) => {
                    const endIndex = Math.min(startIndex + 5, fields.length);

                    for (let i = startIndex; i < endIndex; i++) {
                        this.validateField(fields[i]);
                    }

                    if (endIndex < fields.length) {
                        scheduleTask(() => validateChunk(endIndex));
                    } else {
                        // All fields validated, submit form
                        this.submitForm(form);
                    }
                };

                scheduleTask(() => validateChunk(0));
            });
        });
    }

    optimizeCLS() {
        this.protectHeroImages();

        // Set explicit dimensions for images
        this.setImageDimensions();

        // Reserve space for ads and embeds
        this.reserveSpaceForDynamicContent();

        // Avoid inserting content above existing content
        this.preventContentShifts();

        // Use CSS containment
        this.applyCSSContainment();
    }

    preventContentShifts() {
        // Prevent content layout shifts by reserving space for dynamic content
        // This helps maintain CLS (Cumulative Layout Shift) score

        // Reserve space for dynamically loaded content
        const dynamicContentContainers = document.querySelectorAll('[data-dynamic-content]');
        dynamicContentContainers.forEach(container => {
            if (!container.style.minHeight) {
                // Set a minimum height to prevent shifts
                const computedHeight = container.offsetHeight || 200;
                container.style.minHeight = `${computedHeight}px`;
            }
        });

        // Prevent font loading shifts
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => {
                // Fonts loaded, no shift expected
            });
        }

        // Reserve space for ads and embeds
        const adContainers = document.querySelectorAll('[data-ad], [data-embed]');
        adContainers.forEach(container => {
            if (!container.style.minHeight) {
                container.style.minHeight = '250px'; // Default ad height
            }
        });
    }

    applyCSSContainment() {
        // Apply CSS containment to improve layout stability and performance
        // CSS containment helps isolate layout, style, and paint operations

        // Apply containment to common layout containers
        const containers = document.querySelectorAll('.container, .card, .product-card, .section');
        containers.forEach(container => {
            if (!container.style.contain) {
                // Use layout and paint containment for better performance
                if (CSS.supports('contain', 'layout paint')) {
                    container.style.contain = 'layout paint';
                }
            }
        });

        // Apply content-visibility to off-screen sections for better performance
        if (CSS.supports('content-visibility', 'auto')) {
            const sections = document.querySelectorAll('section:not(:first-of-type)');
            sections.forEach(section => {
                if (!section.hasAttribute('data-content-visible')) {
                    section.style.contentVisibility = 'auto';
                    section.setAttribute('data-content-visible', 'true');
                }
            });
        }
    }

    protectHeroImages() {
        document.querySelectorAll('.hero-image img, .hero-visual img').forEach(img => {
            img.style.removeProperty('aspect-ratio');
            img.style.removeProperty('height');
            img.style.removeProperty('max-height');
        });
    }

    isHeroImage(element) {
        return element.closest && element.closest('.hero-image, .hero-visual');
    }

    shouldSkipAspectRatio(element) {
        return this.isHeroImage(element) || element.hasAttribute('data-skip-aspect-ratio');
    }

    setImageDimensions() {
        const images = document.querySelectorAll('img:not([width]):not([height])');
        images.forEach(img => {
            if (this.shouldSkipAspectRatio(img)) {
                return;
            }
            // Use aspect-ratio CSS property for modern browsers
            if (CSS.supports('aspect-ratio', '16/9')) {
                img.style.aspectRatio = '16/9'; // Default aspect ratio
            } else {
                // Fallback for older browsers
                img.style.width = '100%';
                img.style.height = 'auto';
            }
        });
    }

    reserveSpaceForDynamicContent() {
        // Reserve space for common dynamic content
        const adSlots = document.querySelectorAll('.ad-slot, [data-ad]');
        adSlots.forEach(slot => {
            if (!slot.style.minHeight) {
                slot.style.minHeight = '250px'; // Standard ad height
            }
        });

        // Reserve space for social media embeds
        const socialEmbeds = document.querySelectorAll('[data-embed]');
        socialEmbeds.forEach(embed => {
            if (!embed.style.minHeight) {
                embed.style.minHeight = '400px';
            }
        });
    }

    optimizeFCP() {
        // Inline critical CSS
        this.inlineCriticalCSS();

        // Optimize font loading
        this.optimizeFontLoading();

        // Minimize main thread work
        this.minimizeMainThreadWork();
    }

    minimizeMainThreadWork() {
        // Minimize work on the main thread to improve FCP (First Contentful Paint)
        // This helps improve page responsiveness and performance

        // Defer non-critical JavaScript execution
        const nonCriticalScripts = document.querySelectorAll('script[data-defer]');
        nonCriticalScripts.forEach(script => {
            if (!script.hasAttribute('defer') && !script.hasAttribute('async')) {
                script.setAttribute('defer', '');
            }
        });

        // Use requestIdleCallback for non-urgent work
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
                // Perform non-critical work during idle time
                // This could include analytics initialization, non-critical animations, etc.
            }, { timeout: 2000 });
        }

        // Break up long tasks using setTimeout
        const longTasks = document.querySelectorAll('[data-long-task]');
        longTasks.forEach(task => {
            // Use setTimeout to break up long-running operations
            if (task.dataset.longTask === 'true') {
                setTimeout(() => {
                    // Process task in chunks
                }, 0);
            }
        });

        // Use passive event listeners where possible
        const scrollElements = document.querySelectorAll('[data-scroll]');
        scrollElements.forEach(element => {
            element.addEventListener('scroll', () => {
                // Scroll handling
            }, { passive: true });
        });
    }

    inlineCriticalCSS() {
        // Extract and inline critical CSS for above-the-fold content
        const criticalCSS = this.extractCriticalCSS();

        if (criticalCSS) {
            const style = document.createElement('style');
            style.textContent = criticalCSS;
            document.head.insertBefore(style, document.head.firstChild);
        }
    }

    extractCriticalCSS() {
        // This would typically be done at build time
        // For runtime, we can identify critical styles
        const criticalSelectors = [
            'body', 'html',
            'header', 'nav', 'main',
            '.hero', '.banner',
            'h1', 'h2',
            '.btn', '.button',
            '.container', '.wrapper'
        ];

        let criticalCSS = '';

        // Extract styles for critical selectors
        const stylesheets = Array.from(document.styleSheets);
        stylesheets.forEach(stylesheet => {
            try {
                const rules = Array.from(stylesheet.cssRules || []);
                rules.forEach(rule => {
                    if (rule.type === CSSRule.STYLE_RULE) {
                        const selector = rule.selectorText;
                        if (/hero-visual img|hero-image img/i.test(selector)) {
                            return;
                        }
                        if (criticalSelectors.some(critical => selector.includes(critical))) {
                            criticalCSS += rule.cssText + '\n';
                        }
                    }
                });
            } catch (e) {
                // Cross-origin stylesheet, skip
            }
        });

        return criticalCSS;
    }

    optimizeFontLoading() {
        // Add font-display: swap to all fonts
        // Skip font preloading in file:// protocol or if already preconnected
        if (window.location.protocol !== 'file:') {
            const fontFaces = document.querySelectorAll('link[href*="fonts"]');
            fontFaces.forEach(link => {
                // Only preload if not already preconnected (Google Fonts uses preconnect)
                // Preloading Google Fonts CSS can cause credentials mismatch warnings
                // Preconnect is sufficient for Google Fonts
                const href = link.href || link.getAttribute('href') || '';
                if (this.isCriticalFont(href) && !href.includes('fonts.googleapis.com')) {
                    // Only preload non-Google Fonts (they're already optimized with preconnect)
                    const preload = document.createElement('link');
                    preload.rel = 'preload';
                    preload.href = href;
                    preload.as = 'style';
                    preload.crossOrigin = 'anonymous';
                    document.head.insertBefore(preload, link);
                }
            });
        }

        // Add font-display: swap via CSS
        const style = document.createElement('style');
        style.textContent = `
            @font-face {
                font-display: swap;
            }
        `;
        document.head.appendChild(style);
    }

    setupResourceHints() {
        // DNS prefetch for external domains
        this.addDNSPrefetch([
            'fonts.googleapis.com',
            'fonts.gstatic.com',
            'www.google-analytics.com',
            'cdnjs.cloudflare.com'
        ]);

        // Preconnect to critical origins
        this.addPreconnect([
            'https://fonts.googleapis.com',
            'https://fonts.gstatic.com'
        ]);

        // Preload critical resources
        this.preloadCriticalResources();

        // Prefetch likely next pages
        this.prefetchLikelyPages();
    }

    addDNSPrefetch(domains) {
        domains.forEach(domain => {
            const link = document.createElement('link');
            link.rel = 'dns-prefetch';
            link.href = `//${domain}`;
            document.head.appendChild(link);
        });
    }

    addPreconnect(origins) {
        origins.forEach(origin => {
            const link = document.createElement('link');
            link.rel = 'preconnect';
            link.href = origin;
            link.crossOrigin = 'anonymous';
            document.head.appendChild(link);
        });
    }

    preloadCriticalResources() {
        // Skip preloading in file:// protocol
        if (window.location.protocol === 'file:') {
            return;
        }

        // Preload hero image
        const heroImage = document.querySelector('.hero img, .banner img');
        if (heroImage) {
            this.preloadImage(heroImage.src || heroImage.dataset.src);
        }

        // NOTE: Do NOT inject <link rel="preload"> for stylesheets/scripts that
        // already exist as regular <link rel="stylesheet"> or <script src="">
        // tags in the document. By the time this code runs (DOMContentLoaded),
        // the browser has already kicked off (and usually completed) the
        // request for those resources, so the preload hint is never "used"
        // and the browser logs a warning:
        //   "The resource ... was preloaded using link preload but not used
        //    within a few seconds from the window's load event."
        // Preload hints only help when added BEFORE the resource is requested
        // — i.e. inline in the HTML <head>, not via JS after parsing.
    }

    prefetchLikelyPages() {
        // Prefetch likely next pages based on current page
        // Only prefetch pages that are known to exist to avoid 404 errors
        const currentPath = window.location.pathname;
        let likelyPages = [];

        if (currentPath === '/' || currentPath === '/index.html') {
            // Don't prefetch products.html - it may not exist and causes 503 errors
            // Prefetching optional pages causes console errors
            likelyPages = [];
            // Note: products.html, about.html and contact.html are optional and may not exist
            // Prefetching them causes 404/503 errors, so we skip them
        } else if (currentPath.includes('product')) {
            likelyPages = ['/cart.html', '/checkout.html'];
        }

        likelyPages.forEach(page => {
            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = page;
            // Suppress errors for prefetch failures
            link.onerror = () => { /* Silently ignore prefetch errors */ };
            document.head.appendChild(link);
        });
    }

    setupImageOptimization() {
        this.protectHeroImages();

        // Implement next-gen image formats
        this.implementNextGenFormats();

        // Set up responsive images
        this.setupResponsiveImages();

        // Optimize image loading
        this.optimizeImageLoading();

        // Implement image compression
        this.implementImageCompression();
    }

    implementNextGenFormats() {
        const images = document.querySelectorAll('img[src]');
        images.forEach(img => {
            const originalSrc = img.src;

            // Create picture element with multiple formats
            if (!img.parentElement.tagName === 'PICTURE') {
                const picture = document.createElement('picture');

                // AVIF source
                const avifSource = document.createElement('source');
                avifSource.srcset = this.convertToFormat(originalSrc, 'avif');
                avifSource.type = 'image/avif';
                picture.appendChild(avifSource);

                // WebP source
                const webpSource = document.createElement('source');
                webpSource.srcset = this.convertToFormat(originalSrc, 'webp');
                webpSource.type = 'image/webp';
                picture.appendChild(webpSource);

                // Original image as fallback
                img.parentNode.insertBefore(picture, img);
                picture.appendChild(img);
            }
        });
    }

    convertToFormat(src, format) {
        // Convert image URL to specified format
        return src.replace(/\.(jpg|jpeg|png)$/i, `.${format}`);
    }

    setupResponsiveImages() {
        // Set up responsive images with srcset
        const images = document.querySelectorAll('img[src]');
        images.forEach(img => {
            if (!img.hasAttribute('srcset') && !img.hasAttribute('data-responsive')) {
                // Add responsive srcset if not already present
                const src = img.src;
                if (src && !src.includes('data:')) {
                    img.setAttribute('data-responsive', 'true');
                    // Could add srcset generation here if needed
                }
            }
        });
    }

    optimizeImageLoading() {
        // Optimize image loading with lazy loading and priority hints
        const images = document.querySelectorAll('img:not([loading])');
        images.forEach((img, index) => {
            // First few images load immediately, others lazy load
            if (index > 2) {
                img.setAttribute('loading', 'lazy');
            } else {
                img.setAttribute('loading', 'eager');
                img.setAttribute('fetchpriority', 'high');
            }
        });
    }

    implementImageCompression() {
        // Client-side image compression hints
        // Note: Actual compression should be done server-side
        // This just adds attributes for browser optimization
        const images = document.querySelectorAll('img[src]');
        images.forEach(img => {
            if (!img.hasAttribute('decoding')) {
                // Use async decoding for non-critical images
                if (!img.closest('.hero, .banner, .spotlight')) {
                    img.setAttribute('decoding', 'async');
                }
            }
        });
    }

    setupAdvancedStructuredData() {
        const path = window.location.pathname || '';
        const isHomepage = path === '/' || path === '/index.html' || path.endsWith('/index.html');
        if (isHomepage) {
            // Homepage JSON-LD lives in index.html — skip injected duplicates.
            return;
        }

        // Enhanced organization schema
        this.addOrganizationSchema();

        // Product schema for e-commerce
        this.addProductSchemas();

        // FAQ schema
        this.addFAQSchema();

        // Review schema
        this.addReviewSchema();

        // Breadcrumb schema
        this.addBreadcrumbSchema();

        // Local business schema
        this.addLocalBusinessSchema();
    }

    addReviewSchema() {
        // Add review/rating schema only when real review data is available
    }

    addLocalBusinessSchema() {
        // Add LocalBusiness schema for physical location
        const schema = {
            "@context": "https://schema.org",
            "@type": "LocalBusiness",
            "name": "H&M Herbs & Vitamins",
            "address": {
                "@type": "PostalAddress",
                "streetAddress": "1140 Battlefield Pkwy",
                "addressLocality": "Fort Oglethorpe",
                "addressRegion": "GA",
                "postalCode": "30742",
                "addressCountry": "US"
            },
            "telephone": "+1-706-861-9454",
            "email": "hmherbs1@gmail.com",
            "url": window.location.origin
        };
        this.addStructuredData(schema);
    }

    addOrganizationSchema() {
        const schema = {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "H&M Herbs & Vitamins",
            "url": window.location.origin,
            "logo": `${window.location.origin}/images/logo.png`,
            "description": "Premium natural health products, herbs, and vitamins for optimal wellness",
            "contactPoint": {
                "@type": "ContactPoint",
                "telephone": "+1-706-861-9454",
                "contactType": "customer service",
                "availableLanguage": "English"
            },
            "sameAs": [
                "https://facebook.com/hmherbs",
                "https://twitter.com/hmherbs",
                "https://www.instagram.com/hmherbs1"
            ]
        };

        this.addStructuredData(schema);
    }

    addProductSchemas() {
        const products = document.querySelectorAll('[data-product-id]');
        products.forEach(productElement => {
            const productId = productElement.dataset.productId;
            const name = productElement.querySelector('.product-name')?.textContent;
            const price = productElement.querySelector('.product-price')?.textContent;
            const image = productElement.querySelector('img')?.src;

            if (name && price) {
                const schema = {
                    "@context": "https://schema.org",
                    "@type": "Product",
                    "name": name,
                    "image": image,
                    "description": productElement.querySelector('.product-description')?.textContent,
                    "sku": productId,
                    "offers": {
                        "@type": "Offer",
                        "price": price.replace(/[^0-9.]/g, ''),
                        "priceCurrency": "USD",
                        "availability": "https://schema.org/InStock",
                        "seller": {
                            "@type": "Organization",
                            "name": "H&M Herbs & Vitamins"
                        }
                    }
                };

                this.addStructuredData(schema);
            }
        });
    }

    addFAQSchema() {
        const faqSections = document.querySelectorAll('.faq-item, [data-faq]');
        if (faqSections.length > 0) {
            const faqSchema = {
                "@context": "https://schema.org",
                "@type": "FAQPage",
                "mainEntity": []
            };

            faqSections.forEach(faq => {
                const question = faq.querySelector('.faq-question, h3, h4')?.textContent;
                const answer = faq.querySelector('.faq-answer, p')?.textContent;

                if (question && answer) {
                    faqSchema.mainEntity.push({
                        "@type": "Question",
                        "name": question,
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": answer
                        }
                    });
                }
            });

            if (faqSchema.mainEntity.length > 0) {
                this.addStructuredData(faqSchema);
            }
        }
    }

    addBreadcrumbSchema() {
        const breadcrumbs = document.querySelectorAll('.breadcrumb a, nav[aria-label="breadcrumb"] a');
        if (breadcrumbs.length > 0) {
            const schema = {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": []
            };

            breadcrumbs.forEach((breadcrumb, index) => {
                schema.itemListElement.push({
                    "@type": "ListItem",
                    "position": index + 1,
                    "name": breadcrumb.textContent,
                    "item": breadcrumb.href
                });
            });

            this.addStructuredData(schema);
        }
    }

    setupTechnicalSEO() {
        // Optimize meta tags
        this.optimizeMetaTags();

        // Set up canonical URLs
        this.setupCanonicalURLs();

        // Optimize URL structure
        this.optimizeURLStructure();

        // Set up hreflang for international SEO
        this.setupHreflang();

        // Optimize robots.txt directives
        this.optimizeRobotsTxt();
    }

    optimizeMetaTags() {
        // Ensure title is optimized
        const title = document.title;
        if (title.length > 60) {
            // Title tag is too long - silently continue
        }

        // Ensure meta description is optimized
        const metaDescription = document.querySelector('meta[name="description"]');
        if (metaDescription) {
            const content = metaDescription.content;
            if (content.length > 160) {
                // Meta description is too long - silently continue
            }
        }

        // Add Open Graph tags if missing
        this.addOpenGraphTags();

        // Add Twitter Card tags if missing
        this.addTwitterCardTags();
    }

    addOpenGraphTags() {
        const ogTags = [
            { property: 'og:title', content: document.title },
            { property: 'og:description', content: document.querySelector('meta[name="description"]')?.content },
            { property: 'og:url', content: window.location.href },
            { property: 'og:type', content: 'website' },
            { property: 'og:image', content: `${window.location.origin}/images/og-image.jpg` }
        ];

        ogTags.forEach(tag => {
            if (!document.querySelector(`meta[property="${tag.property}"]`) && tag.content) {
                const meta = document.createElement('meta');
                meta.setAttribute('property', tag.property);
                meta.content = tag.content;
                document.head.appendChild(meta);
            }
        });
    }

    addTwitterCardTags() {
        // Add Twitter Card meta tags if missing
        const twitterTags = [
            { name: 'twitter:card', content: 'summary_large_image' },
            { name: 'twitter:title', content: document.title },
            { name: 'twitter:description', content: document.querySelector('meta[name="description"]')?.content },
            { name: 'twitter:image', content: `${window.location.origin}/images/twitter-card.jpg` }
        ];

        twitterTags.forEach(tag => {
            if (!document.querySelector(`meta[name="${tag.name}"]`) && tag.content) {
                const meta = document.createElement('meta');
                meta.setAttribute('name', tag.name);
                meta.content = tag.content;
                document.head.appendChild(meta);
            }
        });
    }

    setupCanonicalURLs() {
        // Ensure canonical URL is set
        if (!document.querySelector('link[rel="canonical"]')) {
            const canonical = document.createElement('link');
            canonical.rel = 'canonical';
            canonical.href = window.location.href.split('?')[0]; // Remove query params
            document.head.appendChild(canonical);
        }
    }

    optimizeURLStructure() {
        // Optimize URL structure (mostly server-side, but can check client-side)
        const currentUrl = window.location.href;
        // Check for URL best practices
        if (currentUrl.length > 100) {
            // URL is very long - silently continue
        }
        if (currentUrl.includes('#')) {
            // Hash fragments are okay for client-side navigation
        }
    }

    setupHreflang() {
        // Set up hreflang tags for international SEO
        // This is a placeholder - would need actual language/region data
        if (!document.querySelector('link[hreflang]')) {
            // Add default hreflang for English
            const hreflang = document.createElement('link');
            hreflang.rel = 'alternate';
            hreflang.hreflang = 'en';
            hreflang.href = window.location.href;
            document.head.appendChild(hreflang);
        }
    }

    optimizeRobotsTxt() {
        // Check robots.txt (mostly server-side)
        // Use native fetch with silent error handling to avoid console noise
        if (window.location.protocol !== 'file:') {
            try {
                const nativeFetch = window.__nativeFetch || window.fetch;
                nativeFetch('/robots.txt')
                    .then(response => {
                        if (response && response.ok) {
                            // robots.txt exists
                        }
                    })
                    .catch(() => {
                        // Silently ignore - robots.txt may be generated server-side
                    });
            } catch (error) {
                // Silently ignore
            }
        }
    }

    monitorCoreWebVitals() {
        // Monitor LCP
        if ('PerformanceObserver' in window) {
            try {
                const lcpObserver = new PerformanceObserver((list) => {
                    const entries = list.getEntries();
                    const lastEntry = entries[entries.length - 1];
                    this.coreWebVitals.lcp = lastEntry.startTime;

                    if (lastEntry.startTime > this.config.targetLCP) {
                        this.optimizeLCPFurther();
                    }
                });
                lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
            } catch (e) {
                // LCP monitoring not supported - silently continue
            }
        }

        // Monitor CLS
        if ('PerformanceObserver' in window) {
            try {
                let clsValue = 0;
                const clsObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (!entry.hadRecentInput) {
                            clsValue += entry.value;
                        }
                    }
                    this.coreWebVitals.cls = clsValue;

                    if (clsValue > this.config.targetCLS && !this.clsOptimized) {
                        this.clsOptimized = true; // Mark as optimized to prevent multiple calls
                        this.optimizeCLSFurther();
                    }
                });
                clsObserver.observe({ entryTypes: ['layout-shift'] });
            } catch (e) {
                // CLS monitoring not supported - silently continue
            }
        }
    }

    optimizeLCPFurther() {
        // Additional LCP optimizations when target is exceeded
        // Applying additional LCP optimizations

        // Lazy load non-critical images more aggressively
        const images = document.querySelectorAll('img');
        images.forEach((img, index) => {
            if (index > 2) { // Beyond first 3 images
                img.setAttribute('loading', 'lazy');
            }
        });

        // Defer non-critical third-party CSS only (same-origin rules as removeRenderBlockingResources)
        const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');
        stylesheets.forEach((link, index) => {
            if (index === 0) return;
            if (!this.shouldDeferStylesheet(link)) return;
            link.setAttribute('media', 'print');
            link.setAttribute('onload', "this.media='all'");
        });
    }

    optimizeCLSFurther() {
        // Additional CLS optimizations when target is exceeded
        // Only apply once to reduce processing
        if (!this.clsOptimized) {
            // Applying additional CLS optimizations
        }

        // Add more explicit dimensions
        const elements = document.querySelectorAll('img, iframe, video');
        elements.forEach(element => {
            if (this.shouldSkipAspectRatio(element)) {
                return;
            }
            if (!element.style.aspectRatio && !element.width && !element.height) {
                // Only set aspect-ratio if element has natural dimensions
                if (element.tagName === 'IMG' && element.naturalWidth && element.naturalHeight) {
                    element.style.aspectRatio = `${element.naturalWidth} / ${element.naturalHeight}`;
                } else if (element.tagName === 'IMG') {
                    // For images without dimensions, use a safe default
                    element.style.aspectRatio = '16/9';
                }
            }
        });

        this.protectHeroImages();
    }

    // Utility Methods
    preloadImage(src) {
        if (src) {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.href = src;
            link.as = 'image';
            document.head.appendChild(link);
        }
    }

    preloadFont(fontFamily) {
        // This would need to be customized based on your font setup
        const fontUrl = this.getFontURL(fontFamily);
        if (fontUrl) {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.href = fontUrl;
            link.as = 'font';
            link.type = 'font/woff2';
            link.crossOrigin = 'anonymous';
            document.head.appendChild(link);
        }
    }

    getFontURL(fontFamily) {
        // Map font families to URLs
        const fontMap = {
            'Inter': 'https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiA.woff2'
        };

        return fontMap[fontFamily.replace(/['"]/g, '')];
    }

    isCriticalCSS(href) {
        // Determine if CSS is critical
        return href.includes('critical') || href.includes('above-fold') || href === document.querySelector('link[rel="stylesheet"]')?.href;
    }

    isCriticalScript(src) {
        // Determine if script is critical
        return src.includes('critical') || src.includes('inline') || src.includes('polyfill');
    }

    isCriticalFont(href) {
        // Determine if font is critical
        return href.includes('Inter') || href.includes('primary');
    }

    addStructuredData(schema) {
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.textContent = JSON.stringify(schema);
        document.head.appendChild(script);
    }

    validateField(field) {
        // Simple field validation
        if (field.required && !field.value) {
            field.classList.add('error');
            return false;
        }
        field.classList.remove('error');
        return true;
    }

    submitForm(form) {
        // Submit form after validation
        form.submit();
    }

    // Public API
    getCoreWebVitals() {
        return this.coreWebVitals;
    }

    getOptimizations() {
        return this.optimizations;
    }

    runSEOAudit() {
        const audit = {
            title: this.auditTitle(),
            metaDescription: this.auditMetaDescription(),
            headings: this.auditHeadings(),
            images: this.auditImages(),
            links: this.auditLinks(),
            structuredData: this.auditStructuredData()
        };

        return audit;
    }

    auditTitle() {
        const title = document.title;
        return {
            content: title,
            length: title.length,
            isOptimal: title.length >= 30 && title.length <= 60,
            recommendations: title.length > 60 ? ['Shorten title'] : title.length < 30 ? ['Lengthen title'] : []
        };
    }

    auditMetaDescription() {
        const meta = document.querySelector('meta[name="description"]');
        const content = meta?.content || '';
        return {
            content: content,
            length: content.length,
            isOptimal: content.length >= 120 && content.length <= 160,
            recommendations: content.length > 160 ? ['Shorten description'] : content.length < 120 ? ['Lengthen description'] : []
        };
    }

    auditHeadings() {
        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        const h1Count = document.querySelectorAll('h1').length;

        return {
            total: headings.length,
            h1Count: h1Count,
            isOptimal: h1Count === 1,
            recommendations: h1Count === 0 ? ['Add H1 tag'] : h1Count > 1 ? ['Use only one H1 tag'] : []
        };
    }

    auditImages() {
        const images = document.querySelectorAll('img');
        const imagesWithoutAlt = document.querySelectorAll('img:not([alt])');

        return {
            total: images.length,
            withoutAlt: imagesWithoutAlt.length,
            isOptimal: imagesWithoutAlt.length === 0,
            recommendations: imagesWithoutAlt.length > 0 ? ['Add alt text to all images'] : []
        };
    }

    auditLinks() {
        const links = document.querySelectorAll('a[href]');
        const linksWithoutRel = document.querySelectorAll('a[href^="http"]:not([rel])');
        const brokenLinks = []; // Would need to check actual link validity

        return {
            total: links.length,
            withoutRel: linksWithoutRel.length,
            broken: brokenLinks.length,
            isOptimal: linksWithoutRel.length === 0 && brokenLinks.length === 0,
            recommendations: [
                ...(linksWithoutRel.length > 0 ? ['Add rel="noopener noreferrer" to external links'] : []),
                ...(brokenLinks.length > 0 ? ['Fix broken links'] : [])
            ]
        };
    }

    auditStructuredData() {
        const structuredData = document.querySelectorAll('script[type="application/ld+json"]');
        const validSchemas = [];
        const invalidSchemas = [];

        structuredData.forEach(script => {
            try {
                const schema = JSON.parse(script.textContent);
                if (schema['@context'] === 'https://schema.org') {
                    validSchemas.push(schema['@type'] || 'Unknown');
                } else {
                    invalidSchemas.push('Invalid context');
                }
            } catch (e) {
                invalidSchemas.push('Invalid JSON');
            }
        });

        return {
            total: structuredData.length,
            valid: validSchemas.length,
            invalid: invalidSchemas.length,
            types: validSchemas,
            isOptimal: invalidSchemas.length === 0 && validSchemas.length > 0,
            recommendations: [
                ...(invalidSchemas.length > 0 ? ['Fix invalid structured data'] : []),
                ...(validSchemas.length === 0 ? ['Add structured data'] : [])
            ]
        };
    }
}

// Initialize SEO Optimizer when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.seoOptimizer = new SEOOptimizer();

    // Setup cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (window.seoOptimizer) {
            window.seoOptimizer.cleanup();
        }
    });

    // Also cleanup on page hide (for mobile)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && window.seoOptimizer) {
            window.seoOptimizer.cleanup();
        }
    });
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SEOOptimizer;
}
