// Advanced Device-Adaptive Performance Manager for HM Herbs
// Device-specific optimizations and adaptive loading strategies

class DeviceAdaptiveManager {
    constructor() {
        this.config = {
            debugMode: false // Reduce console noise
        };
        
        this.deviceInfo = this.getDeviceInfo();
        this.performanceBudgets = this.getPerformanceBudgets();
        this.adaptiveStrategies = this.getAdaptiveStrategies();
        this.resourceLoadingStrategy = null;
        
        // Track intervals for cleanup
        this.intervals = [];
        
        this.init();
    }

    init() {
        // Analyze device capabilities
        this.analyzeDeviceCapabilities();
        
        // Set up adaptive loading strategy
        this.setupAdaptiveLoading();
        
        // Initialize performance monitoring
        this.initializePerformanceMonitoring();
        
        // Set up responsive image loading
        this.setupResponsiveImages();
        
        // Initialize touch gesture optimization
        this.initializeTouchOptimization();
        
        // Set up viewport optimization
        this.setupViewportOptimization();
        
        // Initialize battery-aware features
        this.initializeBatteryAwareness();
        
        // Set up memory management
        this.setupMemoryManagement();
    }

    getDeviceInfo() {
        const userAgent = navigator.userAgent;
        const screen = window.screen;
        const devicePixelRatio = window.devicePixelRatio || 1;
        
        return {
            // Device type detection
            isMobile: /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent),
            isTablet: /iPad|Android(?=.*Mobile)/i.test(userAgent) && screen.width >= 768,
            isDesktop: !/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent),
            
            // Screen information
            screenWidth: screen.width,
            screenHeight: screen.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            devicePixelRatio: devicePixelRatio,
            
            // Performance indicators
            hardwareConcurrency: navigator.hardwareConcurrency || 2,
            maxTouchPoints: navigator.maxTouchPoints || 0,
            
            // Network information
            connection: navigator.connection || navigator.mozConnection || navigator.webkitConnection,
            
            // Memory information (if available)
            deviceMemory: navigator.deviceMemory,
            
            // Platform detection
            isIOS: /iPad|iPhone|iPod/.test(userAgent),
            isAndroid: /Android/.test(userAgent),
            isSafari: /Safari/.test(userAgent) && !/Chrome/.test(userAgent),
            isChrome: /Chrome/.test(userAgent),
            
            // Capabilities
            supportsWebP: this.supportsWebP(),
            supportsAVIF: this.supportsAVIF(),
            supportsIntersectionObserver: 'IntersectionObserver' in window,
            supportsServiceWorker: 'serviceWorker' in navigator,
            supportsWebGL: this.supportsWebGL()
        };
    }

    analyzeDeviceCapabilities() {
        // Classify device performance tier
        this.deviceInfo.performanceTier = this.classifyPerformanceTier();
        
        // Determine optimal loading strategy
        this.resourceLoadingStrategy = this.determineLoadingStrategy();
        
        // Set performance budget based on device
        this.currentPerformanceBudget = this.performanceBudgets[this.deviceInfo.performanceTier];
        
        // Only log in debug mode
        if (this.config.debugMode) {
            console.log('Device Analysis:', {
                tier: this.deviceInfo.performanceTier,
                strategy: this.resourceLoadingStrategy,
                budget: this.currentPerformanceBudget
            });
        }
    }

    classifyPerformanceTier() {
        let score = 0;
        
        // CPU cores
        if (this.deviceInfo.hardwareConcurrency >= 8) score += 3;
        else if (this.deviceInfo.hardwareConcurrency >= 4) score += 2;
        else if (this.deviceInfo.hardwareConcurrency >= 2) score += 1;
        
        // Memory
        if (this.deviceInfo.deviceMemory >= 8) score += 3;
        else if (this.deviceInfo.deviceMemory >= 4) score += 2;
        else if (this.deviceInfo.deviceMemory >= 2) score += 1;
        
        // Screen resolution
        const totalPixels = this.deviceInfo.screenWidth * this.deviceInfo.screenHeight * this.deviceInfo.devicePixelRatio;
        if (totalPixels >= 2073600) score += 2; // 1920x1080 or higher
        else if (totalPixels >= 921600) score += 1; // 1280x720 or higher
        
        // Network connection
        if (this.deviceInfo.connection) {
            const effectiveType = this.deviceInfo.connection.effectiveType;
            if (effectiveType === '4g') score += 2;
            else if (effectiveType === '3g') score += 1;
        }
        
        // Device type penalty for mobile
        if (this.deviceInfo.isMobile && !this.deviceInfo.isTablet) score -= 1;
        
        // Classify based on score
        if (score >= 8) return 'high';
        else if (score >= 5) return 'medium';
        else return 'low';
    }

    getPerformanceBudgets() {
        return {
            high: {
                maxImageSize: 2000000, // 2MB
                maxScriptSize: 1000000, // 1MB
                maxCSSSize: 200000, // 200KB
                maxFonts: 6,
                maxRequests: 100,
                targetLCP: 2000, // 2 seconds
                targetFID: 100, // 100ms
                targetCLS: 0.1
            },
            medium: {
                maxImageSize: 1000000, // 1MB
                maxScriptSize: 500000, // 500KB
                maxCSSSize: 100000, // 100KB
                maxFonts: 4,
                maxRequests: 50,
                targetLCP: 2500, // 2.5 seconds
                targetFID: 200, // 200ms
                targetCLS: 0.15
            },
            low: {
                maxImageSize: 500000, // 500KB
                maxScriptSize: 250000, // 250KB
                maxCSSSize: 50000, // 50KB
                maxFonts: 2,
                maxRequests: 25,
                targetLCP: 4000, // 4 seconds
                targetFID: 300, // 300ms
                targetCLS: 0.25
            }
        };
    }

    determineLoadingStrategy() {
        const tier = this.deviceInfo.performanceTier;
        const connection = this.deviceInfo.connection;
        
        if (tier === 'low' || (connection && connection.saveData)) {
            return 'minimal';
        } else if (tier === 'medium' || (connection && connection.effectiveType === '3g')) {
            return 'progressive';
        } else {
            return 'full';
        }
    }

    getAdaptiveStrategies() {
        return {
            minimal: {
                imageQuality: 0.6,
                enableAnimations: false,
                lazyLoadThreshold: '50px',
                preloadCritical: 2,
                deferNonCritical: true,
                enableWebGL: false,
                maxConcurrentRequests: 3
            },
            progressive: {
                imageQuality: 0.8,
                enableAnimations: true,
                lazyLoadThreshold: '100px',
                preloadCritical: 4,
                deferNonCritical: true,
                enableWebGL: true,
                maxConcurrentRequests: 6
            },
            full: {
                imageQuality: 0.95,
                enableAnimations: true,
                lazyLoadThreshold: '200px',
                preloadCritical: 8,
                deferNonCritical: false,
                enableWebGL: true,
                maxConcurrentRequests: 10
            }
        };
    }

    setupAdaptiveLoading() {
        const strategy = this.adaptiveStrategies[this.resourceLoadingStrategy];
        
        // Apply CSS class for strategy-specific styles
        document.documentElement.classList.add(`loading-strategy-${this.resourceLoadingStrategy}`);
        document.documentElement.classList.add(`performance-tier-${this.deviceInfo.performanceTier}`);
        
        // Disable animations for low-performance devices
        if (!strategy.enableAnimations) {
            this.disableAnimations();
        }
        
        // Set up lazy loading with appropriate threshold
        this.setupLazyLoading(strategy.lazyLoadThreshold);
        
        // Configure resource loading priorities
        this.configureResourcePriorities(strategy);
        
        // Set up adaptive image loading
        this.setupAdaptiveImageLoading(strategy.imageQuality);
    }

    configureResourcePriorities(strategy) {
        // Configure resource loading priorities based on device capabilities
        // This is a placeholder - can be expanded with actual priority configuration
        if (strategy && strategy.priorities) {
            // Apply priority hints to critical resources
            const criticalLinks = document.querySelectorAll('link[rel="preload"], link[rel="prefetch"]');
            criticalLinks.forEach(link => {
                if (link.href && !link.hasAttribute('fetchpriority')) {
                    link.setAttribute('fetchpriority', 'high');
                }
            });
        }
    }

    setupAdaptiveImageLoading(imageQuality) {
        // Set up adaptive image loading based on device capabilities
        // This can be expanded with actual image quality adaptation
        if (imageQuality) {
            const images = document.querySelectorAll('img[data-src]');
            images.forEach(img => {
                // Apply quality settings if needed
                if (imageQuality === 'low' && img.dataset.src) {
                    // Could modify image URL for lower quality
                }
            });
        }
    }

    disableAnimations() {
        const style = document.createElement('style');
        style.textContent = `
            *, *::before, *::after {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
                scroll-behavior: auto !important;
            }
        `;
        document.head.appendChild(style);
    }

    setupLazyLoading(threshold) {
        if (!this.deviceInfo.supportsIntersectionObserver) {
            // Fallback for older browsers
            this.setupFallbackLazyLoading();
            return;
        }
        
        const imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    this.loadImage(img);
                    imageObserver.unobserve(img);
                }
            });
        }, {
            rootMargin: threshold
        });
        
        // Observe all images with data-src
        document.querySelectorAll('img[data-src]').forEach(img => {
            imageObserver.observe(img);
        });
        
        // Set up mutation observer for dynamically added images
        const mutationObserver = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        const images = node.querySelectorAll ? node.querySelectorAll('img[data-src]') : [];
                        images.forEach(img => imageObserver.observe(img));
                    }
                });
            });
        });
        
        mutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    setupFallbackLazyLoading() {
        let lazyImages = document.querySelectorAll('img[data-src]');
        
        const loadImagesInViewport = () => {
            lazyImages.forEach(img => {
                if (this.isInViewport(img)) {
                    this.loadImage(img);
                    lazyImages = Array.from(lazyImages).filter(image => image !== img);
                }
            });
        };
        
        // Load images on scroll and resize
        window.addEventListener('scroll', loadImagesInViewport);
        window.addEventListener('resize', loadImagesInViewport);
        
        // Initial load
        loadImagesInViewport();
    }

    loadImage(img) {
        const strategy = this.adaptiveStrategies[this.resourceLoadingStrategy];
        
        // Determine optimal image format
        const src = this.getOptimalImageSrc(img.dataset.src, strategy.imageQuality);
        
        // Create new image to preload
        const newImg = new Image();
        newImg.onload = () => {
            img.src = src;
            img.classList.add('loaded');
        };
        newImg.onerror = () => {
            // Fallback to original src
            img.src = img.dataset.src;
            img.classList.add('error');
        };
        
        newImg.src = src;
    }

    getOptimalImageSrc(originalSrc, quality) {
        // Generate responsive image URL based on device capabilities
        const width = Math.min(this.deviceInfo.viewportWidth * this.deviceInfo.devicePixelRatio, 2000);
        
        // Choose format based on support
        let format = 'jpg';
        if (this.deviceInfo.supportsAVIF) {
            format = 'avif';
        } else if (this.deviceInfo.supportsWebP) {
            format = 'webp';
        }
        
        // Construct optimized URL (this would integrate with your image optimization service)
        return originalSrc.replace(/\.(jpg|jpeg|png|webp)$/i, `_w${width}_q${Math.round(quality * 100)}.${format}`);
    }

    setupResponsiveImages() {
        // Set up picture element optimization
        const pictures = document.querySelectorAll('picture');
        pictures.forEach(picture => {
            this.optimizePictureElement(picture);
        });
        
        // Set up srcset optimization
        const imagesWithSrcset = document.querySelectorAll('img[srcset]');
        imagesWithSrcset.forEach(img => {
            this.optimizeSrcset(img);
        });
    }

    optimizePictureElement(picture) {
        const sources = picture.querySelectorAll('source');
        const strategy = this.adaptiveStrategies[this.resourceLoadingStrategy];
        
        sources.forEach(source => {
            // Adjust media queries based on device capabilities
            const media = source.getAttribute('media');
            if (media && this.deviceInfo.isMobile) {
                // Adjust breakpoints for mobile devices
                const adjustedMedia = this.adjustMediaQuery(media);
                source.setAttribute('media', adjustedMedia);
            }
            
            // Optimize srcset based on device pixel ratio
            const srcset = source.getAttribute('srcset');
            if (srcset) {
                const optimizedSrcset = this.optimizeSrcsetForDevice(srcset, strategy.imageQuality);
                source.setAttribute('srcset', optimizedSrcset);
            }
        });
    }

    initializeTouchOptimization() {
        if (this.deviceInfo.maxTouchPoints > 0) {
            // Add touch-specific optimizations
            document.documentElement.classList.add('touch-device');
            
            // Optimize touch targets
            this.optimizeTouchTargets();
            
            // Set up touch gesture handling
            this.setupTouchGestures();
            
            // Enable haptic feedback if available
            this.setupHapticFeedback();
        }
    }

    optimizeTouchTargets() {
        const minTouchSize = 44; // 44px minimum as per accessibility guidelines
        
        const touchElements = document.querySelectorAll('button, a, input, select, textarea, [role="button"]');
        
        touchElements.forEach(element => {
            // Footer content links should keep typographic spacing from CSS.
            // Avoid injecting inline min-size styles that create large vertical gaps.
            if (this.shouldSkipTouchOptimization(element)) {
                if (element.classList.contains('touch-optimized')) {
                    element.classList.remove('touch-optimized');
                }
                if (element.style.minWidth) {
                    element.style.minWidth = '';
                }
                if (element.style.minHeight) {
                    element.style.minHeight = '';
                }
                return;
            }

            const rect = element.getBoundingClientRect();
            
            if (rect.width < minTouchSize || rect.height < minTouchSize) {
                element.style.minWidth = `${minTouchSize}px`;
                element.style.minHeight = `${minTouchSize}px`;
                element.classList.add('touch-optimized');
            }
        });
    }

    shouldSkipTouchOptimization(element) {
        return Boolean(
            element.closest('.footer .footer-section') ||
            element.closest('.footer .footer-link') ||
            element.closest('.footer .footer-contact') ||
            element.closest('.footer .footer-get-in-touch')
        );
    }

    setupTouchGestures() {
        // Implement swipe gestures for mobile navigation
        let startX, startY, startTime;
        
        document.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            startTime = Date.now();
        }, { passive: true });
        
        document.addEventListener('touchend', (e) => {
            if (!startX || !startY) return;
            
            const touch = e.changedTouches[0];
            const endX = touch.clientX;
            const endY = touch.clientY;
            const endTime = Date.now();
            
            const deltaX = endX - startX;
            const deltaY = endY - startY;
            const deltaTime = endTime - startTime;
            
            // Detect swipe gestures
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50 && deltaTime < 300) {
                if (deltaX > 0) {
                    this.handleSwipeRight();
                } else {
                    this.handleSwipeLeft();
                }
            }
            
            // Reset
            startX = startY = null;
        }, { passive: true });
    }

    setupHapticFeedback() {
        if ('vibrate' in navigator) {
            // Add haptic feedback to important interactions
            const importantButtons = document.querySelectorAll('.btn-primary, .btn-success, [data-haptic]');
            
            importantButtons.forEach(button => {
                button.addEventListener('click', () => {
                    navigator.vibrate(50); // Short vibration
                });
            });
        }
    }

    setupViewportOptimization() {
        // Dynamic viewport meta tag optimization
        this.optimizeViewportMeta();
        
        // Set up orientation change handling
        this.setupOrientationHandling();
        
        // Optimize for safe areas (iPhone X and similar)
        this.setupSafeAreaHandling();
    }

    optimizeViewportMeta() {
        let viewport = document.querySelector('meta[name="viewport"]');
        
        if (!viewport) {
            viewport = document.createElement('meta');
            viewport.name = 'viewport';
            document.head.appendChild(viewport);
        }
        
        // Optimize viewport based on device
        let content = 'width=device-width, initial-scale=1';
        
        if (this.deviceInfo.isMobile) {
            // Prevent zoom on mobile for better UX
            content += ', maximum-scale=1, user-scalable=no';
        }
        
        if (this.deviceInfo.isIOS) {
            // iOS-specific optimizations
            content += ', viewport-fit=cover';
        }
        
        viewport.content = content;
    }

    setupOrientationHandling() {
        const handleOrientationChange = () => {
            // Update device info on orientation change
            this.deviceInfo.viewportWidth = window.innerWidth;
            this.deviceInfo.viewportHeight = window.innerHeight;
            
            // Trigger layout recalculation
            this.optimizeLayoutForOrientation();
        };
        
        window.addEventListener('orientationchange', () => {
            // Delay to allow viewport to update
            setTimeout(handleOrientationChange, 100);
        });
        
        window.addEventListener('resize', handleOrientationChange);
    }

    optimizeLayoutForOrientation() {
        const isLandscape = window.innerWidth > window.innerHeight;
        
        document.documentElement.classList.toggle('landscape', isLandscape);
        document.documentElement.classList.toggle('portrait', !isLandscape);
        
        // Adjust UI elements for orientation
        if (this.deviceInfo.isMobile) {
            this.adjustMobileLayoutForOrientation(isLandscape);
        }
    }

    adjustMobileLayoutForOrientation(isLandscape) {
        const header = document.querySelector('header');
        const navigation = document.querySelector('nav');
        
        if (isLandscape) {
            // Compact header in landscape mode
            if (header) header.classList.add('compact');
            if (navigation) navigation.classList.add('horizontal');
        } else {
            // Full header in portrait mode
            if (header) header.classList.remove('compact');
            if (navigation) navigation.classList.remove('horizontal');
        }
    }

    setupSafeAreaHandling() {
        if (this.deviceInfo.isIOS) {
            // Add CSS custom properties for safe areas
            const style = document.createElement('style');
            style.textContent = `
                :root {
                    --safe-area-inset-top: env(safe-area-inset-top);
                    --safe-area-inset-right: env(safe-area-inset-right);
                    --safe-area-inset-bottom: env(safe-area-inset-bottom);
                    --safe-area-inset-left: env(safe-area-inset-left);
                }
                
                .safe-area-padding {
                    padding-top: var(--safe-area-inset-top);
                    padding-right: var(--safe-area-inset-right);
                    padding-bottom: var(--safe-area-inset-bottom);
                    padding-left: var(--safe-area-inset-left);
                }
            `;
            document.head.appendChild(style);
        }
    }

    initializeBatteryAwareness() {
        if ('getBattery' in navigator) {
            navigator.getBattery().then(battery => {
                this.adaptToBatteryLevel(battery);
                
                // Listen for battery changes
                battery.addEventListener('levelchange', () => {
                    this.adaptToBatteryLevel(battery);
                });
                
                battery.addEventListener('chargingchange', () => {
                    this.adaptToBatteryLevel(battery);
                });
            });
        }
    }

    adaptToBatteryLevel(battery) {
        const isLowBattery = battery.level < 0.2 && !battery.charging;
        
        if (isLowBattery) {
            // Enable power-saving mode
            document.documentElement.classList.add('low-battery-mode');
            
            // Reduce animations and effects
            this.disableAnimations();
            
            // Reduce background activity
            this.reduceBatteryConsumption();
        } else {
            document.documentElement.classList.remove('low-battery-mode');
        }
    }

    reduceBatteryConsumption() {
        // Reduce polling intervals
        if (window.hmherbsAnalytics) {
            window.hmherbsAnalytics.updateConfig({ sampleRate: 0.1 });
        }
        
        // Pause non-essential animations
        const animations = document.querySelectorAll('[data-animation]');
        animations.forEach(element => {
            element.style.animationPlayState = 'paused';
        });
    }

    setupMemoryManagement() {
        // Monitor memory usage if available
        if ('memory' in performance) {
            const memoryCheckInterval = setInterval(() => {
                this.checkMemoryUsage();
            }, 30000); // Check every 30 seconds
            this.intervals.push(memoryCheckInterval);
        }
        
        // Set up garbage collection hints
        this.setupGarbageCollectionHints();
    }

    setupGarbageCollectionHints() {
        // Provide hints to the garbage collector for better memory management
        // This is a placeholder - actual GC hints depend on browser implementation
        if (window.gc && typeof window.gc === 'function') {
            // Only available in Chrome with --js-flags="--expose-gc"
            // Don't call directly, just note it's available
        }
        
        // Clear unused references periodically
        if (this.intervals) {
            const gcInterval = setInterval(() => {
                // Force cleanup of unused resources
                if (this.resourceCache && this.resourceCache.size > 100) {
                    // Clear old cache entries
                    const entries = Array.from(this.resourceCache.entries());
                    entries.slice(0, entries.length - 50).forEach(([key]) => {
                        this.resourceCache.delete(key);
                    });
                }
            }, 60000); // Every minute
            this.intervals.push(gcInterval);
        }
    }

    checkMemoryUsage() {
        const memory = performance.memory;
        const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
        
        if (usageRatio > 0.8) {
            // High memory usage - trigger cleanup
            this.performMemoryCleanup();
        }
    }

    performMemoryCleanup() {
        // Remove unused images from DOM
        const unusedImages = document.querySelectorAll('img:not([src])');
        unusedImages.forEach(img => {
            if (!this.isInViewport(img)) {
                img.remove();
            }
        });
        
        // Clear caches if available
        if (window.cacheManager) {
            window.cacheManager.clearExpiredCache();
        }
        
        // Trigger garbage collection hint
        if (window.gc) {
            window.gc();
        }
    }

    // Utility Methods
    supportsWebP() {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    }

    supportsAVIF() {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        return canvas.toDataURL('image/avif').indexOf('data:image/avif') === 0;
    }

    supportsWebGL() {
        try {
            const canvas = document.createElement('canvas');
            return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
        } catch (e) {
            return false;
        }
    }

    isInViewport(element) {
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    adjustMediaQuery(media) {
        // Adjust media queries for mobile devices
        return media.replace(/(\d+)px/g, (match, pixels) => {
            const adjustedPixels = Math.round(pixels * 0.8); // Reduce by 20% for mobile
            return `${adjustedPixels}px`;
        });
    }

    optimizeSrcsetForDevice(srcset, quality) {
        // Optimize srcset based on device capabilities
        return srcset.split(',').map(src => {
            const [url, descriptor] = src.trim().split(' ');
            const optimizedUrl = this.getOptimalImageSrc(url, quality);
            return `${optimizedUrl} ${descriptor}`;
        }).join(', ');
    }

    handleSwipeLeft() {
        // Implement swipe left functionality
        const event = new CustomEvent('swipeleft');
        document.dispatchEvent(event);
    }

    handleSwipeRight() {
        // Implement swipe right functionality
        const event = new CustomEvent('swiperight');
        document.dispatchEvent(event);
    }

    initializePerformanceMonitoring() {
        // Monitor performance metrics specific to device capabilities
        if ('PerformanceObserver' in window) {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    this.analyzePerformanceEntry(entry);
                }
            });
            
            observer.observe({ entryTypes: ['measure', 'navigation', 'resource'] });
        }
    }

    analyzePerformanceEntry(entry) {
        const budget = this.currentPerformanceBudget;
        
        if (entry.entryType === 'navigation') {
            // Check if LCP exceeds budget
            if (entry.loadEventEnd - entry.navigationStart > budget.targetLCP) {
                if (this.config.debugMode) {
                    console.warn('LCP budget exceeded:', entry.loadEventEnd - entry.navigationStart);
                }
                this.optimizeForSlowLoading();
            }
        } else if (entry.entryType === 'resource') {
            // Check resource size against budget
            if (entry.transferSize > budget.maxImageSize && entry.name.match(/\.(jpg|jpeg|png|webp|avif)$/i)) {
                if (this.config.debugMode) {
                    console.warn('Image size budget exceeded:', entry.name, entry.transferSize);
                }
            }
        }
    }

    optimizeForSlowLoading() {
        // Switch to more aggressive optimization strategy
        if (this.resourceLoadingStrategy !== 'minimal') {
            this.resourceLoadingStrategy = 'minimal';
            this.setupAdaptiveLoading();
        }
    }

    // Cleanup method to clear all intervals
    cleanup() {
        this.intervals.forEach(intervalId => {
            try {
                clearInterval(intervalId);
            } catch (error) {
                if (this.config.debugMode) {
                    console.warn('Error clearing interval:', error);
                }
            }
        });
        this.intervals = [];
    }

    // Public API
    getDeviceCapabilities() {
        return {
            deviceInfo: this.deviceInfo,
            performanceTier: this.deviceInfo.performanceTier,
            loadingStrategy: this.resourceLoadingStrategy,
            performanceBudget: this.currentPerformanceBudget
        };
    }

    updateLoadingStrategy(strategy) {
        if (this.adaptiveStrategies[strategy]) {
            this.resourceLoadingStrategy = strategy;
            this.setupAdaptiveLoading();
        }
    }

    forceImageReload() {
        const images = document.querySelectorAll('img[data-src]');
        images.forEach(img => this.loadImage(img));
    }
}

// Initialize Device Adaptive Manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.deviceAdaptiveManager = new DeviceAdaptiveManager();
    
    // Setup cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (window.deviceAdaptiveManager) {
            window.deviceAdaptiveManager.cleanup();
        }
    });
    
    // Also cleanup on page hide (for mobile)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && window.deviceAdaptiveManager) {
            window.deviceAdaptiveManager.cleanup();
        }
    });
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DeviceAdaptiveManager;
}
