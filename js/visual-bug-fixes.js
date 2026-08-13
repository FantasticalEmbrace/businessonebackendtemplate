// Visual Bug Fixes for HM Herbs
// Addresses carousel flickering, scroll bar issues, and image loading problems

function hmHerbsIsCheckoutPage() {
    const path = (typeof window !== 'undefined' && window.location && window.location.pathname) || '';
    return path.includes('checkout.html') || /\/checkout\/?$/i.test(path);
}

class VisualBugFixer {
    constructor() {
        this.config = {
            enableFlickerFix: true,
            enableImageFallbacks: true,
            enableScrollOptimization: true,
            enableTransitionOptimization: true,
            debugMode: false // Reduced logging - only enable for debugging
        };

        this.imageCache = new Map();
        this.loadingImages = new Set();
        this.processedImages = new WeakSet(); // Track processed images to avoid duplicates
        this.flickerElements = new WeakSet();
        this.initialized = false;
        this.eventListeners = []; // Track event listeners for cleanup

        this.init();
    }

    init() {
        // Checkout: skip scroll pointer-events hack, body-wide image observer, and carousel fixes.
        if (hmHerbsIsCheckoutPage()) {
            this.initialized = true;
            return;
        }

        // Fix carousel and image flickering
        if (this.config.enableFlickerFix) {
            this.fixCarouselFlickering();
        }

        // Fix image loading issues
        if (this.config.enableImageFallbacks) {
            this.setupImageFallbacks();
        }

        // Fix scroll bar flickering
        if (this.config.enableScrollOptimization) {
            this.fixScrollBarFlickering();
        }

        // Optimize transitions to prevent flickering
        if (this.config.enableTransitionOptimization) {
            this.optimizeTransitions();
        }

        // Set up mutation observer for dynamic content
        this.setupDynamicContentObserver();

        // Initialize on DOM ready
        if (document.readyState === 'loading') {
            this.addEventListenerWithCleanup(document, 'DOMContentLoaded', () => this.applyFixes());
        } else {
            this.applyFixes();
        }
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
                console.warn('Error removing VisualBugFixer event listener:', error);
            }
        });
        this.eventListeners = [];
    }

    // Fix Carousel Flickering
    fixCarouselFlickering() {
        // Add CSS to prevent flickering during transitions
        const flickerFixCSS = document.createElement('style');
        flickerFixCSS.textContent = `
            /* Spotlight cards — tall uniform layout; no GPU layer on cards (breaks photos) */
            .product-spotlight .spotlight-grid,
            .product-spotlight .product-card {
                backface-visibility: visible;
                -webkit-backface-visibility: visible;
                transform: none;
                -webkit-transform: none;
                will-change: auto;
            }

            @media (min-width: 768px) {
                .product-spotlight .product-card {
                    min-height: 400px;
                    contain: layout style paint;
                }
            }

            @media (max-width: 767px) {
                .product-spotlight .product-card,
                .products-grid .product-card,
                .products-section .product-card {
                    min-height: 0;
                }
            }

            .product-spotlight .product-card:hover {
                transform: translateY(-8px);
                -webkit-transform: translateY(-8px);
            }
            
            /* Keep product photos visible: opacity 0 + waiting for .loaded hid real images (lazy/cached races). */
            .product-image {
                transition: opacity 0.3s ease, transform 0.3s ease;
                opacity: 1;
            }
            
            .product-image.loaded {
                opacity: 1;
            }
            
            .product-image.loading {
                opacity: 1;
            }

            .product-image--empty {
                display: block;
                width: 100%;
                min-height: 180px;
                background: var(--gray-100, #f3f4f6);
                border-radius: var(--border-radius, 0.5rem);
            }
            
            /* Catalog grid cards only — spotlight uses rules above */
            @media (min-width: 768px) {
                .products-grid .product-card,
                .products-section .product-card {
                    min-height: 400px;
                    contain: layout style;
                }
            }
            
            /* Optimize GPU layers — catalog only; no translateZ (breaks photos on mobile) */
            .products-grid .product-card:hover {
                will-change: transform;
            }
            
            .products-grid .product-card:not(:hover) {
                will-change: auto;
            }
            
            /* Fix scroll bar flickering — use site theme tokens (not undefined --color-* vars) */
            ::-webkit-scrollbar {
                width: 12px;
                background: var(--gray-100, #f3f4f6);
            }
            
            ::-webkit-scrollbar-track {
                background: var(--gray-100, #f3f4f6);
                border-radius: 6px;
            }
            
            ::-webkit-scrollbar-thumb {
                background: var(--primary-green, #059669);
                border-radius: 6px;
                border: 2px solid var(--gray-100, #f3f4f6);
                transition: background-color 0.2s ease;
            }
            
            ::-webkit-scrollbar-thumb:hover {
                background: var(--primary-green-dark);
            }
            
            html {
                scrollbar-gutter: stable;
                scrollbar-color: var(--primary-green, #059669) var(--gray-100, #f3f4f6);
            }
            
            /* Smooth scrolling optimization */
            html {
                scroll-behavior: smooth;
            }
            
            @media (prefers-reduced-motion: reduce) {
                html {
                    scroll-behavior: auto;
                }
                
                .product-image,
                .product-card {
                    transition: none !important;
                    animation: none !important;
                }
            }
        `;
        document.head.appendChild(flickerFixCSS);
    }

    // Fix Image Loading Issues
    setupImageFallbacks() {
        // Create fallback image data URL
        const fallbackImageDataURL = this.createFallbackImage();

        // Set up image loading with proper error handling
        this.setupImageLoading(fallbackImageDataURL);

        // Preload critical images
        this.preloadCriticalImages();
    }

    createFallbackImage() {
        // Create a simple SVG fallback image
        const svgContent = `
            <svg width="300" height="200" xmlns="http://www.w3.org/2000/svg">
                <rect width="100%" height="100%" fill="#f8f9fa"/>
                <rect x="50" y="50" width="200" height="100" fill="#e9ecef" rx="8"/>
                <circle cx="100" cy="80" r="15" fill="#dee2e6"/>
                <rect x="130" y="70" width="80" height="8" fill="#dee2e6" rx="4"/>
                <rect x="130" y="85" width="60" height="6" fill="#dee2e6" rx="3"/>
                <text x="150" y="130" font-family="Arial, sans-serif" font-size="12" fill="#6c757d" text-anchor="middle">
                    Image unavailable
                </text>
            </svg>
        `;

        return `data:image/svg+xml;base64,${btoa(svgContent)}`;
    }

    setupImageLoading(_fallbackImageDataURL) {
        // Override HMHerbsApp cards only if that app exists — do not double-load via new Image()
        // (races handleNewImage and can replace real photos with SVG after retries).
        const originalCreateProductCard = window.HMHerbsApp?.prototype?.createProductCard;
        if (originalCreateProductCard) {
            window.HMHerbsApp.prototype.createProductCard = function (product) {
                return originalCreateProductCard.call(this, product);
            };
        }
    }

    preloadCriticalImages() {
        // Preload images that are likely to be needed
        // Only preload if not in file:// protocol and images are accessible
        if (window.location.protocol === 'file:') {
            return; // Skip preloading in file:// protocol
        }

        // Same-origin spotlight assets only — old hmherbs.com /application/files/... URLs 404 (HTML) and trigger CORB when used as images
        const criticalImageUrls = [
            '/images/products/nature-s-puls-probiotic-mega.jpg',
            '/images/products/nature-s-plus-ageloss-kidney-support.jpg',
            '/images/products/nature-s-plus-ageloss-first-day-inflammation-response.jpg'
        ];

        criticalImageUrls.forEach(url => {
            if (!this.imageCache.has(url)) {
                const img = new Image();
                img.onload = () => {
                    this.imageCache.set(url, img);
                };
                img.onerror = () => {
                    // Silently fail - these are optional preloads
                    // CORS errors are expected for external images without CORS headers
                    // Don't log to avoid console noise
                };
                // Don't set crossOrigin for external images - they may not have CORS headers
                // Setting crossOrigin = 'anonymous' causes CORS errors if server doesn't send headers
                // Let the browser handle it naturally without CORS restrictions
                img.src = url;
            }
        });
    }

    // Fix Scroll Bar Flickering
    fixScrollBarFlickering() {
        // Stabilize scrollbar
        document.documentElement.style.scrollbarGutter = 'stable';

        // Optimize scroll events
        let scrollTimeout;
        let isScrolling = false;

        const optimizedScrollHandler = () => {
            if (!isScrolling) {
                isScrolling = true;
                document.body.classList.add('scrolling');
            }

            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                isScrolling = false;
                document.body.classList.remove('scrolling');
            }, 150);
        };

        // Use passive listeners for better performance
        this.addEventListenerWithCleanup(window, 'scroll', optimizedScrollHandler, { passive: true });

        // Add CSS for scroll optimization
        const scrollOptimizationCSS = document.createElement('style');
        scrollOptimizationCSS.textContent = `
            /* Prevent scrollbar layout shifts — html is the sole vertical scroll container */
            html {
                overflow-x: clip;
                overflow-y: scroll;
                scrollbar-gutter: stable;
                scrollbar-color: var(--primary-green, #059669) var(--gray-100, #f3f4f6);
            }

            body {
                overflow-x: clip;
                overflow-y: visible;
            }
            
            /* Smooth scrollbar transitions */
            ::-webkit-scrollbar-thumb {
                transition: background-color 0.2s ease !important;
            }
        `;
        document.head.appendChild(scrollOptimizationCSS);
    }

    // Optimize Transitions
    optimizeTransitions() {
        // Add CSS to prevent transition flickering
        const transitionOptimizationCSS = document.createElement('style');
        transitionOptimizationCSS.textContent = `
            /* Prevent transition flickering */
            * {
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
            }
            
            /* Optimize transform transitions — buttons/nav only (not product cards; breaks photos) */
            .btn,
            .nav-menu a {
                transform: translateZ(0);
                backface-visibility: hidden;
                perspective: 1000px;
            }

            .products-grid .product-card,
            .products-section .product-card {
                transform: none !important;
                -webkit-transform: none !important;
                backface-visibility: visible !important;
                -webkit-backface-visibility: visible !important;
                perspective: none !important;
            }

            .product-spotlight .product-card {
                transform: none;
                backface-visibility: visible;
                perspective: none;
            }
            
            /* Don't apply transforms to mobile menu links - causes rendering issues */
            .nav-menu.show a {
                transform: none !important;
                backface-visibility: visible !important;
            }

            /* Modals: .btn rules above break fixed panels + overflow; keep modal trees transform-clean. */
            .wishlist-modal .btn,
            .acct-modal-floating .btn,
            .edsa-modal .btn,
            #edsa-booking-modal .btn {
                transform: none !important;
                -webkit-transform: none !important;
                backface-visibility: visible !important;
                -webkit-backface-visibility: visible !important;
                perspective: none !important;
                will-change: auto !important;
            }
            
            /* Prevent layout thrashing — catalog grid */
            .products-grid .product-card:hover {
                transform: translateY(-4px);
                will-change: transform;
            }
            
            .products-grid .product-card:not(:hover) {
                will-change: auto;
            }

            .product-spotlight .product-card:hover {
                transform: translateY(-8px);
                -webkit-transform: translateY(-8px);
            }
            
            /* Optimize opacity transitions */
            .fade-in,
            .product-image {
                transition: opacity 0.3s ease;
            }
            
            /* Keep spotlight visible — opacity 0 here hid the whole carousel until .loaded */
            .product-spotlight {
                opacity: 1;
                transition: opacity 0.5s ease;
            }
            
            .product-spotlight.loaded {
                opacity: 1;
            }
        `;
        document.head.appendChild(transitionOptimizationCSS);

        // Mark spotlight section as loaded after content is ready
        const notifySpotlightReady = () => {
            try {
                window.dispatchEvent(new CustomEvent('hmSpotlightReady'));
            } catch (_) {
                /* ignore */
            }
        };
        setTimeout(() => {
            const spotlight = document.querySelector('.product-spotlight');
            if (spotlight) {
                spotlight.classList.add('loaded');
            }
            notifySpotlightReady();
        }, 100);
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', notifySpotlightReady, { once: true });
        }
    }

    // Dynamic Content Observer
    setupDynamicContentObserver() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // Element node
                        // Handle new images
                        const images = node.querySelectorAll ? node.querySelectorAll('img') : [];
                        images.forEach(img => {
                            if (this.shouldProcessImage(img) && !this.processedImages.has(img) && !this.loadingImages.has(img)) {
                                this.handleNewImage(img);
                            }
                        });

                        // Handle product images specifically
                        const productImages = node.querySelectorAll ? node.querySelectorAll('.product-image') : [];
                        productImages.forEach(img => {
                            if (img.tagName !== 'IMG') return;
                            if (this.shouldProcessImage(img) && !this.processedImages.has(img) && !this.loadingImages.has(img)) {
                                this.handleNewImage(img);
                            }
                        });

                        // Handle new product cards
                        const productCards = node.querySelectorAll ? node.querySelectorAll('.product-card') : [];
                        productCards.forEach(card => {
                            this.optimizeProductCard(card);
                        });
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    shouldProcessImage(img) {
        if (!img || img.tagName !== 'IMG') return false;
        const src = img.currentSrc || img.src || img.getAttribute('src') || '';
        if (!src || src.trim() === '' || src.startsWith('data:image/svg+xml')) return false;
        if (src === window.location.href) return false;
        try {
            const imgUrl = new URL(src, window.location.href);
            if (imgUrl.href === window.location.href) return false;
            const path = imgUrl.pathname.toLowerCase();
            if (path.endsWith('.html') && !path.includes('/images/')) return false;
        } catch {
            return false;
        }
        return true;
    }

    handleNewImage(img) {
        // Skip if already processed or currently loading
        if (this.loadingImages.has(img) || this.processedImages.has(img)) {
            return;
        }

        if (!this.shouldProcessImage(img)) {
            this.processedImages.add(img);
            return;
        }

        // Final placeholder only (SVG) — skip re-processing
        if (img.getAttribute('data-fallback-applied') === 'true') {
            this.processedImages.add(img);
            return;
        }

        // Skip EDSA images, product detail images, and other static images that should not be processed
        if (img.closest('.edsa-image') ||
            img.closest('.product-main-image') ||
            img.classList.contains('product-image-main') ||
            img.src.includes('edsa-icon') ||
            img.hasAttribute('data-skip-error-handling')) {
            // Just mark as loaded if it's already complete, but don't apply error handling
            if (img.complete && img.naturalWidth > 0) {
                img.classList.add('loaded');
            }
            this.processedImages.add(img);
            return;
        }

        // Mark as processed to avoid duplicate processing
        this.processedImages.add(img);
        const isLazyImage = img.getAttribute('loading') === 'lazy' || img.loading === 'lazy';
        if (!isLazyImage) {
            this.loadingImages.add(img);
        }
        img.classList.add('loading');

        const originalSrc = img.src;

        // Don't clear the src - just check if it loads properly
        const handleLoad = () => {
            img.classList.remove('loading');
            img.classList.add('loaded');
            this.loadingImages.delete(img);
            // Only log in debug mode
            if (this.config.debugMode) {
                console.log('✅ Image loaded successfully:', originalSrc);
            }
        };

        const handleError = () => {
            img.classList.remove('loading');
            img.classList.add('error');
            this.loadingImages.delete(img);
            console.error('Image failed to load (fix URL, file on disk, or DB image_url — no placeholder swap):', originalSrc);
        };

        // Lazy images may report complete + naturalWidth 0 before decode; only treat "complete"
        // as authoritative for eager images (avoids false "error" and placeholder CSS).
        if (!isLazyImage && img.complete) {
            if (img.naturalWidth === 0 || !originalSrc || originalSrc === '') {
                handleError();
            } else {
                handleLoad();
            }
        } else {
            // Set up listeners for images still loading — rely on native load/error only.
            // Do NOT use a timed fallback: products.html uses loading="lazy", so off-screen
            // images intentionally have not started downloading yet; a timeout would fire
            // before the browser even requests the file and would replace real photos with placeholders.
            this.addEventListenerWithCleanup(img, 'load', handleLoad, { once: true });
            this.addEventListenerWithCleanup(img, 'error', handleError, { once: true });
            if (!isLazyImage && img.complete) {
                if (img.naturalWidth === 0 || !originalSrc || originalSrc === '') {
                    handleError();
                } else {
                    handleLoad();
                }
            }
        }
    }

    optimizeProductCard(card) {
        // GPU layers on product cards break <img> painting in WebKit (especially mobile).
        if (card.closest('.product-spotlight')) {
            return;
        }
        card.style.transform = 'none';
        card.style.webkitTransform = 'none';
        card.style.backfaceVisibility = 'visible';
        card.style.webkitBackfaceVisibility = 'visible';
        card.style.willChange = 'auto';
    }

    // Apply all fixes
    applyFixes() {
        if (hmHerbsIsCheckoutPage()) {
            this.initialized = true;
            return;
        }

        // Only log in debug mode
        if (this.config.debugMode) {
            console.log('🔧 Applying visual bug fixes...');
        }

        // Fix existing elements
        document.querySelectorAll('.product-card').forEach(card => {
            this.optimizeProductCard(card);
        });

        // Fix ALL images on the page - be more aggressive
        document.querySelectorAll('img').forEach(img => {
            // Skip EDSA images and other static images
            if (img.closest('.edsa-image') ||
                img.closest('.product-main-image') ||
                img.classList.contains('product-image-main') ||
                img.src.includes('edsa-icon') ||
                img.hasAttribute('data-skip-error-handling')) {
                // Just ensure EDSA images are marked as loaded if they're complete
                if (img.complete && img.naturalWidth > 0) {
                    img.classList.add('loaded');
                }
                this.processedImages.add(img);
                return;
            }

            // Skip images without a usable src (empty src resolves to the page URL)
            if (!this.shouldProcessImage(img)) {
                this.processedImages.add(img);
                return;
            }

            const src = img.src || img.getAttribute('src') || '';

            // Only log in debug mode
            if (this.config.debugMode) {
                console.log('🖼️ Processing image:', src, 'Complete:', img.complete);
            }

            if (!this.processedImages.has(img)) {
                this.handleNewImage(img);
            }
        });

        this.initialized = true;

        // Only log in debug mode
        if (this.config.debugMode) {
            console.log('✅ Visual bug fixes applied successfully');
            console.log('📊 Status:', this.getLoadingStatus());
        }
    }

    // Utility method for image loading with retry
    loadImageWithRetry(img, src, retries = 3) {
        return new Promise((resolve, _reject) => {
            const attemptLoad = (attempt) => {
                const tempImg = new Image();

                tempImg.onload = () => {
                    img.src = src;
                    img.classList.remove('loading');
                    img.classList.add('loaded');
                    this.loadingImages.delete(img);
                    resolve(img);
                };

                tempImg.onerror = () => {
                    if (attempt < retries) {
                        setTimeout(() => attemptLoad(attempt + 1), 1000 * attempt);
                    } else {
                        const fallbackSrc = this.createFallbackImage();
                        img.src = fallbackSrc;
                        img.classList.remove('loading');
                        img.classList.add('error');
                        img.alt = img.alt + ' (Image unavailable)';
                        this.loadingImages.delete(img);
                        resolve(img);
                    }
                };

                tempImg.src = src;
            };

            attemptLoad(1);
        });
    }

    // Public API
    fixImage(img, src) {
        return this.loadImageWithRetry(img, src);
    }

    getLoadingStatus() {
        return {
            loadingImages: this.loadingImages.size,
            cachedImages: this.imageCache.size,
            flickerElements: this.flickerElements
        };
    }

    enableDebugMode() {
        this.config.debugMode = true;
        console.log('Visual bug fixer debug mode enabled');
    }
}

// Initialize Visual Bug Fixer IMMEDIATELY - don't wait for DOM
(function () {
    // Apply critical CSS fixes immediately
    const criticalCSS = document.createElement('style');
    criticalCSS.textContent = `
        /* Avoid universal translateZ(0) — inflates scroll height and breaks fixed overlays. */
        .btn,
        .carousel-btn,
        .carousel-indicator {
            -webkit-backface-visibility: hidden !important;
            backface-visibility: hidden !important;
        }

        /* Root must stay untransformed or position:fixed overlays (age gate, modals) mis-center. */
        html,
        body {
            -webkit-transform: none !important;
            transform: none !important;
            -webkit-backface-visibility: visible !important;
            backface-visibility: visible !important;
        }

        .hm-age-gate,
        .hm-age-gate * {
            -webkit-transform: none !important;
            transform: none !important;
        }
        img, picture, video, svg, canvas {
            backface-visibility: visible !important;
            -webkit-backface-visibility: visible !important;
            transform: none !important;
            -webkit-transform: none !important;
        }
        
        .testimonials-carousel-container,
        .testimonials-carousel {
            overflow: hidden !important;
            contain: layout style !important;
            isolation: isolate !important;
        }

        .testimonials-track {
            backface-visibility: visible !important;
            -webkit-backface-visibility: visible !important;
            transform: none;
            -webkit-transform: none;
        }

        .testimonials-track .testimonial-card {
            transform: none !important;
            -webkit-transform: none !important;
            backface-visibility: visible !important;
            -webkit-backface-visibility: visible !important;
        }
        
        .products-grid .product-card {
            will-change: transform !important;
            transform: translate3d(0,0,0) !important;
            -webkit-transform: translate3d(0,0,0) !important;
        }

        .product-spotlight .product-card,
        .product-spotlight .spotlight-grid {
            will-change: auto !important;
            transform: none !important;
            -webkit-transform: none !important;
            backface-visibility: visible !important;
            -webkit-backface-visibility: visible !important;
        }

        .product-image-zoom,
        .product-image-zoom * {
            -webkit-backface-visibility: visible !important;
            backface-visibility: visible !important;
        }

        .product-image-zoom-nav {
            -webkit-transform: translateY(-50%) !important;
            transform: translateY(-50%) !important;
        }
        
        /* IMMEDIATE SCROLLBAR FIX — html scrolls; body must not create a second scrollport */
        html {
            scrollbar-gutter: stable !important;
            overflow-x: clip !important;
            overflow-y: scroll !important;
            scrollbar-color: var(--primary-green, #059669) var(--gray-100, #f3f4f6);
        }

        body {
            overflow-x: clip !important;
            overflow-y: visible !important;
        }
        
        /* Images must stay visible: hide-until-.loaded + !important broke every <img> when .loaded
           was missing (race, lazy load, or script order). Do not default img to opacity 0. */
        img {
            opacity: 1 !important;
            transition: opacity 0.3s ease !important;
        }
        
        img.loaded, 
        img.error,
        .edsa-image img,
        img[data-skip-error-handling],
        img[src*="data:"] {
            opacity: 1 !important;
        }
        
        img[src=""]:not(.hero-search-suggestion-img), img:not([src]):not(.hero-search-suggestion-img) {
            background: #f8f9fa url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iI2Y4ZjlmYSIvPgo8cmVjdCB4PSI1MCIgeT0iNTAiIHdpZHRoPSIyMDAiIGhlaWdodD0iMTAwIiBmaWxsPSIjZTllY2VmIiByeD0iOCIvPgo8Y2lyY2xlIGN4PSIxMDAiIGN5PSI4MCIgcj0iMTUiIGZpbGw9IiNkZWUyZTYiLz4KPHJlY3QgeD0iMTMwIiB5PSI3MCIgd2lkdGg9IjgwIiBoZWlnaHQ9IjgiIGZpbGw9IiNkZWUyZTYiIHJ4PSI0Ii8+CjxyZWN0IHg9IjEzMCIgeT0iODUiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2IiBmaWxsPSIjZGVlMmU2IiByeD0iMyIvPgo8dGV4dCB4PSIxNTAiIHk9IjEzMCIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjEyIiBmaWxsPSIjNmM3NTdkIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5JbWFnZSB1bmF2YWlsYWJsZTwvdGV4dD4KPC9zdmc+') center/contain no-repeat !important;
            opacity: 1 !important;
        }
    `;
    document.head.insertBefore(criticalCSS, document.head.firstChild);

    // Initialize immediately
    window.visualBugFixer = new VisualBugFixer();

    // Also initialize on DOM ready as backup
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (!window.visualBugFixer.initialized) {
                window.visualBugFixer.applyFixes();
            }
        });
    }

    // Setup cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (window.visualBugFixer) {
            window.visualBugFixer.cleanup();
        }
    });

    // Also cleanup on page hide (for mobile)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && window.visualBugFixer) {
            window.visualBugFixer.cleanup();
        }
    });
})();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VisualBugFixer;
}

(function loadPasswordToggle() {
    if (document.querySelector('script[src*="password-toggle.js"]')) return;
    const script = document.createElement('script');
    script.src = 'js/password-toggle.js?v=4';
    script.defer = true;
    document.head.appendChild(script);
})();
