// H&M Herbs & Vitamins - Interactive JavaScript
// Modern, accessible, and feature-rich functionality

/** Cart drawer top offset = sticky header height (taller on index with top bar). */
function syncHmHeaderOffset() {
    const header = document.querySelector('.header');
    if (!header) return;
    document.documentElement.style.setProperty('--hm-header-offset', `${header.offsetHeight}px`);
}

/** True on dedicated checkout (no cart drawer / heavy storefront init). */
function hmHerbsIsCheckoutPage() {
    const path = (typeof window !== 'undefined' && window.location && window.location.pathname) || '';
    return path.includes('checkout.html') || /\/checkout\/?$/i.test(path);
}

// Production-safe logging utility - completely silent
const Logger = {
    isDevelopment: false, // Disable all logging
    log: function () {
        // Completely silent - no logging
    },
    error: function () {
        // Completely silent - no logging
    },
    warn: function () {
        // Completely silent - no logging
    }
};

/** SVG trash + “Delete” — works even when icon fonts fail (home page cart). */
function appendCartDeleteButtonContents(button) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'cart-item-delete-icon');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute(
        'd',
        'M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z'
    );
    svg.appendChild(path);
    button.appendChild(svg);
    button.appendChild(document.createTextNode(' Delete'));
}

class HMHerbsApp {
    constructor() {
        this.cart = [];
        this.products = [];
        this.isLoading = false;
        this.eventListeners = []; // Track event listeners for cleanup

        // Debouncing for cart operations to prevent race conditions
        this.cartOperationTimeouts = new Map();
        this.cartOperationDelay = 300; // 300ms debounce

        // Initialize the application
        this.init();
    }

    async init() {
        try {
            // Ensure cart starts closed
            this.ensureCartClosed();

            // Load products data
            await this.loadProducts();

            // Setup event listeners
            this.setupEventListeners();

            // Initialize components
            this.initializeComponents();

            // Load cart from localStorage
            this.loadCartFromStorage();

            // Cart loaded silently - no debug logging needed

            // Render initial content - wait for products to be loaded
            await this.renderSpotlightProducts();
            this.updateCartDisplay();

            // H&M Herbs app initialized successfully
        } catch (error) {
            Logger.error('Error initializing app:', error);
            this.showNotification('Unable to load the application. Please refresh the page or try again later.', 'error');
        }
    }

    ensureCartClosed() {
        this.closeCart();
    }

    toggleCart() {
        const cartSidebar = document.getElementById('cart-sidebar');
        const cartOverlay = document.getElementById('cart-overlay');
        const cartToggle = document.querySelector('.cart-toggle');

        if (cartSidebar && cartOverlay) {
            const isOpen = cartSidebar.classList.contains('open') || cartSidebar.classList.contains('show');

            if (isOpen) {
                this.closeCart();
            } else {
                syncHmHeaderOffset();
                // Set aria-hidden to false BEFORE showing and focusing
                cartSidebar.setAttribute('aria-hidden', 'false');
                cartSidebar.classList.add('show', 'open');
                cartOverlay.classList.add('active');
                document.body.classList.add('cart-open');
                document.body.style.overflow = 'hidden';
                if (cartToggle) {
                    cartToggle.setAttribute('aria-expanded', 'true');
                }
                // Update cart display when opening
                setTimeout(() => {
                    this.updateCartDisplay();
                }, 50);
            }
        }
    }

    closeCart() {
        const cartSidebar = document.getElementById('cart-sidebar');
        const cartOverlay = document.getElementById('cart-overlay');
        const cartToggle = document.querySelector('.cart-toggle');

        if (cartSidebar && cartOverlay) {
            // Accessibility: move focus out of the sidebar BEFORE hiding it
            // Use requestAnimationFrame to ensure focus is moved before aria-hidden is set
            const activeEl = document.activeElement;
            if (activeEl && cartSidebar.contains(activeEl)) {
                activeEl.blur();
                // Remove focus from any focused elements inside the cart
                const focusedElements = cartSidebar.querySelectorAll(':focus');
                focusedElements.forEach(el => el.blur());
            }

            // Release focus so the cart icon does not stay stuck in :focus-visible green
            if (cartToggle) {
                cartToggle.blur();
                cartToggle.setAttribute('aria-expanded', 'false');
            }

            // Use requestAnimationFrame to ensure focus change completes before setting aria-hidden
            requestAnimationFrame(() => {
                // Set aria-hidden after focus has been moved
                cartSidebar.setAttribute('aria-hidden', 'true');
                cartSidebar.classList.remove('show', 'open');
                cartOverlay.classList.remove('active');
                document.body.classList.remove('cart-open');
                document.body.style.overflow = '';
            });
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
                Logger.warn('Error removing HMHerbsApp event listener:', error);
            }
        });
        this.eventListeners = [];

        // Clear any pending cart operation timeouts
        this.cartOperationTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        this.cartOperationTimeouts.clear();
    }

    async loadProducts() {
        // Check if we're in file:// protocol (local file)
        const isFileProtocol = window.location.protocol === 'file:';

        // Skip API call if in file:// protocol to avoid CORS errors
        if (isFileProtocol) {
            Logger.log('File protocol detected, skipping API call');
            this.products = [];
            return;
        }

        try {
            // Get API base URL from environment or default to current origin
            const apiBaseUrl =
                typeof window.hmHerbsStorefrontApiBase === 'function'
                    ? window.hmHerbsStorefrontApiBase()
                    : (() => {
                          const h = window.location.hostname;
                          const isLoopback = h === 'localhost' || h === '127.0.0.1';
                          if (isLoopback && window.location.port !== '3001') return 'http://localhost:3001';
                          return window.location.origin;
                      })();

            try {
                const nativeFetch = window.__nativeFetch || window.fetch;
                const apiUrl = `${apiBaseUrl}/api/products?limit=4&featured=true`;
                Logger.log(`Fetching featured products from: ${apiUrl}`);

                const response = await nativeFetch(apiUrl).catch((error) => {
                    console.error('❌ Fetch error:', error);
                    Logger.error('❌ Fetch error:', error);
                    return null;
                });

                if (response && response.ok) {
                    const data = await response.json();
                    const productsFromApi = data.products || [];
                    Logger.log(`Transforming ${productsFromApi.length} products from API format to expected format`);

                    // Transform API products to match the format expected by createProductCard
                    this.products = productsFromApi.map(product => {
                        // Handle image URL - if it's a relative path, make it absolute
                        let imageUrl = product.image_url || product.image || '';
                        if (imageUrl && !imageUrl.startsWith('http') && !imageUrl.startsWith('//')) {
                            // It's a relative path, prepend the API base URL
                            imageUrl = imageUrl.startsWith('/') ? `${apiBaseUrl}${imageUrl}` : `${apiBaseUrl}/${imageUrl}`;
                        }

                        return {
                            id: product.id,
                            name: product.name,
                            price: parseFloat(product.price) || 0,
                            image: imageUrl,
                            inventory: product.inventory_quantity || 0,
                            lowStockThreshold: 10, // Default threshold
                            description: product.short_description || product.long_description || '',
                            category: product.category_slug || product.category_name || '',
                            brand: product.brand_slug || product.brand_name || '',
                            brandName: product.brand_name || '',
                            slug: product.slug || '',
                            featured: product.is_featured === true || product.is_featured === 1 || product.is_featured === '1',
                            inStock: (product.inventory_quantity || 0) > 0 || product.inventory_quantity === null,
                            // Add URL for product link if slug exists
                            url: product.slug ? `product.html?slug=${encodeURIComponent(product.slug)}` : null,
                            // Keep original fields for reference
                            _original: product
                        };
                    });

                    Logger.log(`Loaded ${this.products.length} featured products from API:`, this.products.map(p => ({ id: p.id, name: p.name, is_featured: p.featured })));

                    if (this.products.length === 0) {
                        Logger.warn('API returned empty products array!', { data });
                    }
                } else {
                    // Log the error for debugging
                    const errorText = response ? await response.text().catch(() => 'Unable to read response') : 'No response';
                    console.error(`❌ API call failed:`, {
                        status: response ? response.status : 'No response',
                        statusText: response ? response.statusText : 'No response',
                        error: errorText,
                        apiUrl: apiUrl
                    });
                    Logger.error(`❌ API call failed:`, {
                        status: response ? response.status : 'No response',
                        statusText: response ? response.statusText : 'No response',
                        error: errorText,
                        apiUrl: apiUrl
                    });
                    this.products = [];
                }
            } catch (error) {
                console.error('Error loading featured products from API:', error);
                Logger.error('Error loading featured products from API:', error);
                this.products = [];
            }

            Logger.log(`Total products loaded: ${this.products.length}`);

            // Update the UI after loading products
            // Note: Products are rendered via renderSpotlightProducts() which uses this.products
            // No separate renderProducts() method needed - spotlight products are the main display
            // updateProductCount() method doesn't exist, so we skip it
            // if (typeof this.updateProductCount === 'function') {
            //     this.updateProductCount();
            // }

        } catch (error) {
            // Silently handle all errors - database may not be configured
            // Don't show error notifications for expected failures
            console.error('Error in loadProducts():', error);
            Logger.error('Error in loadProducts():', error);
            if (!this.products || this.products.length === 0) {
                this.products = [];
            } else {
                Logger.warn('Not resetting products — already have', this.products.length, 'loaded');
            }
        }
    }

    setupEventListeners() {
        // Mobile menu toggle - Skip if already handled by inline script
        // The inline script in head handles this to ensure it works immediately
        if (!window.toggleMobileMenu) {
            // Mobile menu toggle (fallback) - only set up if not already handled
            const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
            const navMenu = document.querySelector('.nav-menu');

            if (mobileMenuToggle && navMenu) {
                this.addEventListenerWithCleanup(mobileMenuToggle, 'click', () => {
                    const isExpanded = mobileMenuToggle.getAttribute('aria-expanded') === 'true';
                    mobileMenuToggle.setAttribute('aria-expanded', !isExpanded);
                    navMenu.classList.toggle('show');
                });

                // Close menu when clicking outside
                const handleOutsideClick = (e) => {
                    if (navMenu.classList.contains('show') &&
                        !mobileMenuToggle.contains(e.target) &&
                        !navMenu.contains(e.target)) {
                        navMenu.classList.remove('show');
                        mobileMenuToggle.setAttribute('aria-expanded', 'false');
                    }
                };
                document.addEventListener('click', handleOutsideClick, true);

                // Close menu on window resize if it becomes desktop size
                const handleResize = () => {
                    if (window.innerWidth > 768 && navMenu.classList.contains('show')) {
                        navMenu.classList.remove('show');
                        mobileMenuToggle.setAttribute('aria-expanded', 'false');
                    }
                };
                window.addEventListener('resize', handleResize);
            }
        }

        // Search functionality
        const searchToggle = document.querySelector('.search-toggle');
        const searchDropdown = document.querySelector('.search-dropdown');
        const searchForm = document.querySelector('.search-form');
        const searchInput = document.getElementById('search-input');

        if (searchToggle && searchDropdown) {
            this.addEventListenerWithCleanup(searchToggle, 'click', () => {
                const isExpanded = searchToggle.getAttribute('aria-expanded') === 'true';
                searchToggle.setAttribute('aria-expanded', !isExpanded);
                searchDropdown.classList.toggle('show');

                if (searchDropdown.classList.contains('show') && searchInput) {
                    setTimeout(() => searchInput.focus(), 100);
                }
            });
        }

        if (searchForm) {
            this.addEventListenerWithCleanup(searchForm, 'submit', (e) => {
                e.preventDefault();
                const query = searchInput.value.trim();
                if (query) {
                    window.location.href = `products.html?search=${encodeURIComponent(query)}`;
                }
            });
        }

        // Hero search is handled by js/hero-product-search.js

        // Cart functionality
        this.setupCartEventListeners();

        // Smooth scrolling for in-page anchors (skip href="#" placeholders used by modals)
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            const href = anchor.getAttribute('href') || '';
            if (href.length <= 1) return;
            let target;
            try {
                target = document.querySelector(href);
            } catch {
                return;
            }
            if (!target) return;
            this.addEventListenerWithCleanup(anchor, 'click', (e) => {
                e.preventDefault();
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            });
        });
    }

    initializeComponents() {
        // Initialize accessibility features
        this.initializeAccessibilityFeatures();
    }

    initializeAccessibilityFeatures() {
        // Add ARIA live regions for dynamic content updates
        const liveRegion = document.createElement('div');
        liveRegion.setAttribute('aria-live', 'polite');
        liveRegion.setAttribute('aria-atomic', 'true');
        liveRegion.className = 'sr-only';
        liveRegion.id = 'live-region';
        // Prevent focus from causing scroll
        liveRegion.style.position = 'absolute';
        liveRegion.style.left = '-9999px';
        liveRegion.style.width = '1px';
        liveRegion.style.height = '1px';
        liveRegion.style.overflow = 'hidden';
        liveRegion.tabIndex = -1;
        document.body.appendChild(liveRegion);

        // On checkout, focus moves to payment fields and NMI iframes at the bottom of a long form.
        // Forcing scroll-to-top on focusin made the page feel frozen / unusable.
        if (hmHerbsIsCheckoutPage()) {
            return;
        }

        // Monitor for any focus events that might cause scrolling (home page load quirk only)
        document.addEventListener('focusin', (e) => {
            const rect = e.target.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const documentHeight = document.documentElement.scrollHeight;

            if (!window.location.hash && (rect.top > viewportHeight * 0.8 || window.scrollY > documentHeight * 0.7)) {
                if (performance.now() < 3000) {
                    setTimeout(() => {
                        window.scrollTo(0, 0);
                        document.documentElement.scrollTop = 0;
                        document.body.scrollTop = 0;
                    }, 0);
                }
            }
        }, { passive: true });
    }

    setupCartEventListeners() {
        // Cart toggle
        const cartToggle = document.querySelector('.cart-toggle');
        const cartSidebar = document.getElementById('cart-sidebar');
        const cartOverlay = document.getElementById('cart-overlay');
        const cartClose = document.querySelector('.cart-close');

        // Ensure cart starts closed
        if (cartSidebar) {
            cartSidebar.classList.remove('show', 'open');
        }

        // Delegate on header toolbar so cart icon/count stay clickable under overlays
        document.querySelectorAll('.header-actions').forEach((toolbar) => {
            if (toolbar.dataset.hmCartDelegation === '1') return;
            toolbar.dataset.hmCartDelegation = '1';
            toolbar.addEventListener(
                'click',
                (e) => {
                    const toggle = e.target.closest('.cart-toggle');
                    if (!toggle) return;
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleCart();
                },
                true
            );
        });

        // Only attach if not already attached by fallback
        if (cartToggle && !cartToggle.hasAttribute('data-fallback-listener')) {
            cartToggle.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleCart();
            });
            cartToggle.setAttribute('data-main-listener', 'true');
        }

        if (cartClose && !cartClose.hasAttribute('data-listener-attached')) {
            cartClose.addEventListener('click', () => {
                this.closeCart();
            });
            cartClose.setAttribute('data-main-listener', 'true');
        }

        if (cartOverlay && !cartOverlay.hasAttribute('data-listener-attached')) {
            cartOverlay.addEventListener('click', () => {
                this.closeCart();
            });
            cartOverlay.setAttribute('data-main-listener', 'true');
        }

        // Use event delegation for checkout button (in case it's recreated).
        // Only on layouts that include the cart drawer (checkout.html has neither).
        if (!window.location.pathname.includes('products.html') && document.getElementById('cart-sidebar')) {
            document.body.addEventListener('click', (e) => {
                const checkoutBtn = e.target.closest('#checkout-btn, .checkout-btn');
                if (checkoutBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    Logger.log('Checkout button clicked via delegation');
                    if (this && this.proceedToCheckout) {
                        this.proceedToCheckout();
                    } else if (window.hmHerbsApp && window.hmHerbsApp.proceedToCheckout) {
                        window.hmHerbsApp.proceedToCheckout();
                    } else if (window.productsPage && window.productsPage.proceedToCheckout) {
                        window.productsPage.proceedToCheckout();
                    } else {
                        console.error('proceedToCheckout method not found');
                    }
                }
            }, true); // Use capture phase to catch early
        }

        // Also attach directly to button if it exists (pages with cart sidebar only)
        this.attachCheckoutButtonListener();

        if (document.getElementById('cart-sidebar')) {
            setTimeout(() => {
                this.attachCheckoutButtonListener();
            }, 500);

            setTimeout(() => {
                this.attachCheckoutButtonListener();
            }, 1000);
        }
    }

    attachCheckoutButtonListener() {
        // Don't attach on products page - it has its own handler
        if (window.location.pathname.includes('products.html')) {
            return;
        }
        // Dedicated checkout flow — no drawer #checkout-btn; script.js still loads here
        const path = window.location.pathname || '';
        if (path.includes('checkout.html') || /\/checkout\/?$/i.test(path)) {
            return;
        }

        // Checkout page and other layouts without the cart drawer have no #checkout-btn
        if (!document.getElementById('cart-sidebar')) {
            return;
        }

        const checkoutBtn = document.getElementById('checkout-btn');
        if (checkoutBtn) {
            // Don't re-attach if already attached
            if (checkoutBtn.hasAttribute('data-listener-attached')) {
                return;
            }

            // Set button type
            checkoutBtn.setAttribute('type', 'button');

            // Add inline onclick as absolute fallback (check both apps)
            checkoutBtn.setAttribute('onclick', 'if(window.hmHerbsApp && window.hmHerbsApp.proceedToCheckout) { window.hmHerbsApp.proceedToCheckout(); return false; } else if(window.productsPage && window.productsPage.proceedToCheckout) { window.productsPage.proceedToCheckout(); return false; } else { console.error(\'Checkout handler not available\'); } return false;');

            // Attach event listener
            checkoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                Logger.log('Checkout button clicked directly');
                if (this && this.proceedToCheckout) {
                    this.proceedToCheckout();
                } else if (window.hmHerbsApp && window.hmHerbsApp.proceedToCheckout) {
                    window.hmHerbsApp.proceedToCheckout();
                } else if (window.productsPage && window.productsPage.proceedToCheckout) {
                    window.productsPage.proceedToCheckout();
                } else {
                    console.error('proceedToCheckout method not found');
                }
                return false;
            }, { once: false, capture: false });

            checkoutBtn.setAttribute('data-listener-attached', 'true');
            Logger.log('Checkout button listener attached');
        } else {
            Logger.log('Checkout button not found, will retry');
        }
    }

    createInventoryStatusElement(product) {
        const statusDiv = document.createElement('div');
        statusDiv.className = 'inventory-status';

        const icon = document.createElement('i');
        const text = document.createElement('span');

        // Defensive programming: handle missing inventory data
        if (typeof product.inventory === 'undefined' || product.inventory === null) {
            // Fallback to inStock boolean if inventory data is missing
            if (product.inStock === false) {
                statusDiv.classList.add('out-of-stock');
                icon.className = 'fas fa-times-circle';
                text.textContent = ' Out of Stock';
            } else {
                statusDiv.classList.add('in-stock');
                icon.className = 'fas fa-check-circle';
                text.textContent = ' In Stock';
            }
        } else {
            // Normal inventory-based logic
            const inventoryCount = parseInt(product.inventory, 10);
            if (inventoryCount === 0) {
                statusDiv.classList.add('out-of-stock');
                icon.className = 'fas fa-times-circle';
                text.textContent = ' Out of Stock';
            } else if (product.lowStockThreshold && inventoryCount <= product.lowStockThreshold) {
                statusDiv.classList.add('low-stock');
                icon.className = 'fas fa-exclamation-triangle';
                text.textContent = ` Only ${inventoryCount} left!`;
            } else if (inventoryCount <= 20) {
                statusDiv.classList.add('in-stock');
                icon.className = 'fas fa-check-circle';
                text.textContent = ` ${inventoryCount} in stock`;
            } else {
                statusDiv.classList.add('in-stock');
                icon.className = 'fas fa-check-circle';
                text.textContent = ' In Stock';
            }
        }

        statusDiv.appendChild(icon);
        statusDiv.appendChild(text);
        return statusDiv;
    }

    // Legacy method for backward compatibility - now returns HTML safely
    renderInventoryStatus(product) {
        const element = this.createInventoryStatusElement(product);
        return element.outerHTML;
    }

    async renderSpotlightProducts() {
        const container = document.getElementById('spotlight-products-grid');
        if (!container) return;

        // Check if we're in file:// protocol (local file)
        const isFileProtocol = window.location.protocol === 'file:';

        try {
            // Skip fetch if in file:// protocol to avoid CORS errors
            if (isFileProtocol) {
                // Use fallback demo products for local file viewing
                const fallbackProducts = this.getFallbackSpotlightProducts();
                this.renderSpotlightProductsFromData(fallbackProducts);
                return;
            }

            // First, try to use products loaded from API (this.products)
            // These are already limited to 4 via the API call (limit=4&featured=true)
            if (this.products && this.products.length > 0) {
                Logger.log(`Rendering ${this.products.length} featured products from API:`, this.products.map(p => p.name));
                // Ensure maximum of 4 products
                const limitedProducts = this.products.slice(0, 4);
                this.renderSpotlightProductsFromData(limitedProducts);
                return;
            }

            // If products array is empty or undefined, try loading products now
            if (!this.products || this.products.length === 0) {
                Logger.warn('Products not loaded yet, calling loadProducts()...');
                await this.loadProducts();

                await new Promise(resolve => setTimeout(resolve, 50));

                if (this.products && this.products.length > 0) {
                    Logger.log(`Found ${this.products.length} products after loadProducts():`, this.products.map(p => p.name));
                    const limitedProducts = this.products.slice(0, 4);
                    this.renderSpotlightProductsFromData(limitedProducts);
                    return;
                } else {
                    Logger.error('Still no products after loadProducts()!', {
                        productsLength: this.products ? this.products.length : 'undefined'
                    });
                }
            }

            // If API products not available, DO NOT use fallback JSON
            // The fallback JSON has old/wrong products - better to show nothing than wrong products
            Logger.error('❌ No featured products available from API!', {
                productsArray: this.products,
                productsLength: this.products ? this.products.length : 'undefined'
            });

            // Show empty state or error message instead of wrong products
            if (container) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: var(--gray-500);">
                        <p>Featured products are currently unavailable. Please check back later.</p>
                        <p style="font-size: 0.875rem; margin-top: 0.5rem;">If this persists, please contact support.</p>
                    </div>
                `;
            }
        } catch (error) {
            // Log the error but DO NOT use fallback products (they're wrong!)
            console.error('❌ Error in renderSpotlightProducts():', error);
            Logger.error('❌ Error in renderSpotlightProducts():', error);

            // Show error message instead of wrong products
            if (container) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: var(--gray-500);">
                        <p>Error loading featured products. Please refresh the page.</p>
                        <p style="font-size: 0.875rem; margin-top: 0.5rem;">Error: ${error.message}</p>
                    </div>
                `;
            }
        }
    }

    getFallbackSpotlightProducts() {
        // Fallback products for when JSON file can't be loaded
        return [
            {
                id: 1,
                name: "Premium Herbal Blend",
                price: 24.99,
                image: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80",
                inventory: 25,
                featured: true,
                description: "Premium quality herbal blend for supporting your health and wellness goals."
            },
            {
                id: 2,
                name: "Natural Vitamin Complex",
                price: 19.99,
                image: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80",
                inventory: 30,
                featured: true,
                description: "Complete natural vitamin complex with essential nutrients for daily wellness."
            },
            {
                id: 3,
                name: "Organic Supplements",
                price: 29.99,
                image: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80",
                inventory: 20,
                featured: true,
                description: "Certified organic supplements made with natural ingredients."
            },
            {
                id: 4,
                name: "Wellness Formula",
                price: 34.99,
                image: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80",
                inventory: 15,
                featured: true,
                description: "Comprehensive wellness formula for overall health support."
            }
        ];
    }

    renderSpotlightProductsFromData(spotlightProducts) {
        const container = document.getElementById('spotlight-products-grid');
        if (!container) return;

        // Limit to exactly 4 products maximum
        const limitedProducts = spotlightProducts.slice(0, 4);

        // Remove existing event listeners by cloning the container
        const newContainer = container.cloneNode(false);
        newContainer.id = container.id;
        newContainer.className = container.className;
        container.parentNode.replaceChild(newContainer, container);

        // Clear existing content
        newContainer.innerHTML = '';

        // Create product cards safely using DOM methods to prevent XSS
        limitedProducts.forEach(product => {
            const productCard = this.createProductCard(product);
            newContainer.appendChild(productCard);
        });

        // Use event delegation to prevent memory leaks
        this.addEventListenerWithCleanup(newContainer, 'click', (e) => {
            // Find the add-to-cart button (could be clicked directly or via icon/text inside)
            const addToCartBtn = e.target.closest('.add-to-cart-btn');
            if (addToCartBtn) {
                // Prevent default button behavior
                e.preventDefault();
                e.stopPropagation();
                
                // Get product ID from the button's data attribute (most reliable)
                let productIdStr = addToCartBtn.dataset.productId || addToCartBtn.getAttribute('data-product-id');
                
                // Fallback: try to find product card if button doesn't have the attribute
                if (!productIdStr) {
                    const productCard = addToCartBtn.closest('[data-product-id]');
                    if (productCard) {
                        productIdStr = productCard.dataset.productId || productCard.getAttribute('data-product-id');
                    }
                }
                
                if (!productIdStr) {
                    console.error('❌ Invalid product ID - button:', addToCartBtn, 'dataset:', addToCartBtn.dataset);
                    this.showNotification('Unable to add product to cart. Please try again.', 'error');
                    return;
                }
                
                // Check if button is disabled (out of stock)
                if (addToCartBtn.disabled) {
                    this.showNotification('This product is out of stock', 'error');
                    return;
                }
                
                Logger.log('Adding spotlight product to cart:', { productId: productIdStr, limitedProducts: limitedProducts.length });
                
                // Use the limited products from closure for cart operations
                this.addToCartSpotlight(productIdStr, limitedProducts);
            }
        });
    }

    renderBestsellers() {
        const container = document.getElementById('bestsellers-grid');
        if (!container) {
            // Element doesn't exist on this page, skip silently
            return;
        }

        const bestsellers = this.products.filter(product => product.bestseller);
        if (bestsellers.length === 0) {
            return;
        }

        // Remove existing event listeners by cloning the container
        const newContainer = container.cloneNode(false);
        newContainer.id = container.id;
        newContainer.className = container.className;

        if (container.parentNode) {
            container.parentNode.replaceChild(newContainer, container);
        } else {
            return; // Safety check
        }

        // Clear existing content
        newContainer.innerHTML = '';

        // Create product cards safely using DOM methods to prevent XSS
        bestsellers.forEach(product => {
            const productCard = this.createProductCard(product);
            newContainer.appendChild(productCard);
        });

        // Use event delegation to prevent memory leaks
        this.addEventListenerWithCleanup(newContainer, 'click', (e) => {
            if (e.target.closest('.add-to-cart-btn')) {
                const productElement = e.target.closest('[data-product-id]');
                if (!productElement) {
                    Logger.error('Product element with data-product-id not found');
                    return;
                }
                const productId = productElement.dataset.productId || productElement.getAttribute('data-product-id');
                if (!productId) {
                    Logger.error('Invalid product ID:', productElement.dataset.productId);
                    return;
                }
                this.addToCart(productId);
            }
        });
    }

    addToCart(productId, quantity = 1) {
        // Debounce cart operations to prevent race conditions
        const operationKey = `add-${productId}`;

        // Clear existing timeout for this operation
        if (this.cartOperationTimeouts.has(operationKey)) {
            clearTimeout(this.cartOperationTimeouts.get(operationKey));
        }

        // Set new timeout
        const timeoutId = setTimeout(() => {
            this._performAddToCart(productId, quantity);
            this.cartOperationTimeouts.delete(operationKey);
        }, this.cartOperationDelay);

        this.cartOperationTimeouts.set(operationKey, timeoutId);
    }

    _performAddToCart(productId, quantity = 1) {
        const product = this.products.find(p => String(p.id) === String(productId));
        if (!product) {
            this.showNotification('Product not found', 'error');
            return;
        }

        // Check inventory availability (with fallback to inStock)
        const isOutOfStock = (typeof product.inventory !== 'undefined')
            ? product.inventory === 0
            : !product.inStock;

        if (isOutOfStock) {
            this.showNotification('Product is out of stock', 'error');
            return;
        }

        // Check if adding this quantity would exceed available inventory
        const existingItem = this.cart.find(item => String(item.id) === String(productId));
        const currentCartQuantity = existingItem ? existingItem.quantity : 0;
        const totalRequestedQuantity = currentCartQuantity + quantity;

        if (typeof product.inventory !== 'undefined' && totalRequestedQuantity > product.inventory) {
            const availableQuantity = product.inventory - currentCartQuantity;
            if (availableQuantity <= 0) {
                this.showNotification('No more items available', 'error');
                return;
            } else {
                this.showNotification(`Only ${availableQuantity} more available. Added ${availableQuantity} to cart.`, 'warning');
                quantity = availableQuantity;
            }
        }

        // Add or update cart item
        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            this.cart.push({
                id: productId,
                name: product.name,
                price: product.price,
                image: product.image,
                quantity: quantity
            });
        }

        this.updateCartDisplay();
        this.saveCartToStorage();
        this.showNotification(`${product.name} added to cart`, 'success');
        this.announceToScreenReader(`${product.name} added to cart`);
    }

    _cartMatchesLine(item, productId, variantId = null) {
        const sameProduct = String(item.id) === String(productId);
        const itemVariant = item.variant_id != null && item.variant_id !== '' ? String(item.variant_id) : '';
        const targetVariant = variantId != null && variantId !== '' ? String(variantId) : '';
        return sameProduct && itemVariant === targetVariant;
    }

    _findCartLine(productId, variantId = null) {
        return this.cart.find((item) => this._cartMatchesLine(item, productId, variantId));
    }

    addProductToCart(productData, quantity = 1) {
        // Add a product directly to cart using product data object
        // This is useful for product detail pages where the product isn't in this.products array
        if (!productData || !productData.product_id && !productData.id) {
            this.showNotification('Invalid product data', 'error');
            return;
        }

        const productId = productData.product_id || productData.id;
        const variantId = productData.variant_id || null;
        const variantName = productData.variant_name || productData.variantName || '';
        let productName = productData.name || 'Product';
        if (variantName && !productName.includes(variantName)) {
            productName = `${productName} — ${variantName}`;
        }
        const productPrice = productData.price || 0;
        const productImage = productData.image || '';
        const productQuantity = quantity || productData.quantity || 1;

        // Check inventory if available
        const inventory = productData.inventory_quantity !== undefined
            ? productData.inventory_quantity
            : (productData.inventory !== undefined ? productData.inventory : undefined);

        const isOutOfStock = inventory !== undefined
            ? inventory === 0
            : (productData.inStock === false);

        if (isOutOfStock) {
            this.showNotification('Product is out of stock', 'error');
            return;
        }

        const existingItem = this._findCartLine(productId, variantId);
        const currentCartQuantity = existingItem ? existingItem.quantity : 0;
        const totalRequestedQuantity = currentCartQuantity + productQuantity;

        if (inventory !== undefined && totalRequestedQuantity > inventory) {
            const availableQuantity = inventory - currentCartQuantity;
            if (availableQuantity <= 0) {
                this.showNotification('No more items available', 'error');
                return;
            } else {
                this.showNotification(`Only ${availableQuantity} more available. Added ${availableQuantity} to cart.`, 'warning');
                if (existingItem) {
                    existingItem.quantity += availableQuantity;
                } else {
                    this.cart.push({
                        id: productId,
                        variant_id: variantId,
                        variant_name: variantName || null,
                        name: productName,
                        price: productPrice,
                        image: productImage,
                        quantity: availableQuantity,
                        inventory_quantity: inventory,
                    });
                }
                this.updateCartDisplay();
                this.saveCartToStorage();
                this.showNotification(`${productName} added to cart`, 'success');
                this.announceToScreenReader(`${productName} added to cart`);
                return;
            }
        }

        if (existingItem) {
            existingItem.quantity += productQuantity;
            existingItem.price = productPrice;
            if (variantName) existingItem.variant_name = variantName;
        } else {
            this.cart.push({
                id: productId,
                variant_id: variantId,
                variant_name: variantName || null,
                name: productName,
                price: productPrice,
                image: productImage,
                quantity: productQuantity,
                inventory_quantity: inventory,
            });
        }

        this.updateCartDisplay();
        this.saveCartToStorage();
        this.showNotification(`${productName} added to cart`, 'success');
        this.announceToScreenReader(`${productName} added to cart`);
    }

    addToCartSpotlight(productId, spotlightProducts) {
        if (!productId) {
            console.error('❌ addToCartSpotlight: Invalid product ID', productId);
            this.showNotification('Invalid product ID', 'error');
            return;
        }

        // Convert productId to string for consistent comparison
        const productIdStr = String(productId);
        Logger.log('addToCartSpotlight called:', { productId: productIdStr, spotlightProductsCount: spotlightProducts.length });

        const product = spotlightProducts.find(p => {
            // Handle both string and number IDs by converting both to strings for comparison
            const pIdStr = String(p.id);
            const matches = pIdStr === productIdStr;
            if (matches) {
                Logger.log('Found product:', { id: p.id, name: p.name, price: p.price, inventory: p.inventory });
            }
            return matches;
        });

        if (!product) {
            console.error('❌ Product not found in spotlightProducts:', {
                productId: productIdStr,
                availableIds: spotlightProducts.map(p => ({ id: p.id, idType: typeof p.id, name: p.name }))
            });
            this.showNotification('Product not found', 'error');
            return;
        }

        // Check inventory availability (with fallback to inStock)
        const isOutOfStock = (typeof product.inventory !== 'undefined')
            ? product.inventory === 0
            : !product.inStock;

        if (isOutOfStock) {
            this.showNotification('Product is out of stock', 'error');
            return;
        }

        // Check if adding this quantity would exceed available inventory
        const existingItem = this.cart.find(item => {
            return String(item.id) === String(productId);
        });
        const currentCartQuantity = existingItem ? existingItem.quantity : 0;
        const totalRequestedQuantity = currentCartQuantity + 1;

        if (typeof product.inventory !== 'undefined' && totalRequestedQuantity > product.inventory) {
            const availableQuantity = product.inventory - currentCartQuantity;
            if (availableQuantity <= 0) {
                this.showNotification('No more items available', 'error');
                return;
            } else {
                this.showNotification(`Only ${availableQuantity} more available. Added ${availableQuantity} to cart.`, 'warning');
                // Add the available quantity instead of 1
                if (existingItem) {
                    existingItem.quantity += availableQuantity;
                } else {
                    this.cart.push({
                        id: productId,
                        name: product.name,
                        price: product.price,
                        image: product.image,
                        quantity: availableQuantity
                    });
                }
                this.updateCartDisplay();
                this.saveCartToStorage();
                this.showNotification(`${product.name} added to cart`, 'success');
                this.announceToScreenReader(`${product.name} added to cart`);
                return;
            }
        }

        // Add or update cart item
        if (existingItem) {
            existingItem.quantity += 1;
        } else {
            this.cart.push({
                id: productId,
                name: product.name,
                price: product.price,
                image: product.image,
                quantity: 1
            });
        }

        this.updateCartDisplay();
        this.saveCartToStorage();
        this.showNotification(`${product.name} added to cart`, 'success');
        this.announceToScreenReader(`${product.name} added to cart`);
    }

    removeFromCart(productId, variantId = null) {
        this.cart = this.cart.filter((item) => !this._cartMatchesLine(item, productId, variantId));
        this.updateCartDisplay();
        this.saveCartToStorage();
        this.showNotification('Item removed from cart', 'success');
    }

    proceedToCheckout() {
        Logger.log('proceedToCheckout called', { cartLength: this.cart?.length });

        // Check if cart is empty
        if (!this.cart || this.cart.length === 0) {
            Logger.log('Cart is empty, showing error');
            this.showNotification('Your cart is empty', 'error');
            return false;
        }

        // Save cart to sessionStorage for checkout page
        try {
            const cartData = JSON.stringify(this.cart);
            sessionStorage.setItem('checkout_cart', cartData);
            Logger.log('Cart saved to sessionStorage');
        } catch (error) {
            console.error('Error saving cart to sessionStorage:', error);
            Logger.error('Error saving cart to sessionStorage:', error);
            this.showNotification('Error saving cart. Please try again.', 'error');
            return false;
        }

        if (window.customerAuth && typeof window.customerAuth.stashCheckoutCustomerSnapshot === 'function') {
            window.customerAuth.stashCheckoutCustomerSnapshot();
        }

        // Navigate to checkout page
        const checkoutUrl = 'checkout.html';
        Logger.log('Navigating to checkout');

        try {
            // Force navigation
            if (window.location && window.location.href) {
                window.location.href = checkoutUrl;
                Logger.log('Navigation initiated via window.location.href');
                // Also try assign as backup
                setTimeout(() => {
                    if (window.location.href.indexOf('checkout.html') === -1) {
                        window.location.assign(checkoutUrl);
                    }
                }, 100);
            } else {
                console.error('window.location not available');
                this.showNotification('Navigation error. Please try again.', 'error');
                return false;
            }
        } catch (error) {
            console.error('Navigation error:', error);
            this.showNotification('Navigation error. Please try again.', 'error');
            return false;
        }

        return true;
    }

    updateCartQuantity(productId, newQuantity, variantId = null) {
        const operationKey = `update-${productId}-${variantId || 'base'}`;

        // Clear existing timeout for this operation
        if (this.cartOperationTimeouts.has(operationKey)) {
            clearTimeout(this.cartOperationTimeouts.get(operationKey));
        }

        // Set new timeout
        const timeoutId = setTimeout(() => {
            this._performUpdateCartQuantity(productId, newQuantity, variantId);
            this.cartOperationTimeouts.delete(operationKey);
        }, this.cartOperationDelay);

        this.cartOperationTimeouts.set(operationKey, timeoutId);
    }

    _performUpdateCartQuantity(productId, newQuantity, variantId = null) {
        const item = this._findCartLine(productId, variantId);

        if (item) {
            if (newQuantity <= 0) {
                this.removeFromCart(productId, variantId);
            } else {
                const product = this.products.find(p => String(p.id) === String(productId));
                const inventoryLimit = item.inventory_quantity ?? product?.inventory;
                if (inventoryLimit !== undefined && newQuantity > inventoryLimit) {
                    this.showNotification(`Only ${inventoryLimit} items available in stock`, 'error');
                    return;
                }
                item.quantity = newQuantity;
                this.updateCartDisplay();
                this.saveCartToStorage();
            }
        }
    }

    updateCartDisplay() {
        const cartCount = document.getElementById('cart-count');
        const cartItems = document.getElementById('cart-items');
        const cartEmpty = document.getElementById('cart-empty');
        const cartTotal = document.getElementById('cart-total');

        // Update cart count
        const totalItems = this.cart.reduce((sum, item) => sum + item.quantity, 0);
        if (cartCount) {
            cartCount.textContent = totalItems;
            cartCount.style.display = totalItems > 0 ? 'block' : 'none';
        }

        // Update cart items
        if (cartItems && cartEmpty) {
            if (this.cart.length === 0) {
                cartItems.style.display = 'none';
                cartEmpty.style.display = 'block';
            } else {
                cartItems.style.display = 'block';
                cartEmpty.style.display = 'none';

                cartItems.innerHTML = '';
                this.cart.forEach(item => {
                    const cartItem = this.createCartItem(item);
                    cartItems.appendChild(cartItem);
                });
            }
        }

        // Update cart total
        const total = this.cart.reduce((sum, item) => {
            let priceValue = typeof item.price === 'string' ? parseFloat(item.price) : (item.price || 0);
            // Ensure priceValue is a valid number
            if (isNaN(priceValue) || priceValue === null || priceValue === undefined) {
                priceValue = 0;
            }
            const quantity = item.quantity || 0;
            return sum + (priceValue * quantity);
        }, 0);
        if (cartTotal) {
            cartTotal.textContent = `$${total.toFixed(2)}`;
        }

        // Ensure checkout button listener is attached
        this.attachCheckoutButtonListener();
    }

    createCartItem(item) {
        const cartItem = document.createElement('div');
        cartItem.className = 'cart-item';
        cartItem.setAttribute('data-product-id', item.id);
        if (item.variant_id) {
            cartItem.setAttribute('data-variant-id', item.variant_id);
        }

        // Create elements safely to prevent XSS
        const img = document.createElement('img');
        img.src = item.image;
        img.alt = item.name;
        img.className = 'cart-item-image';

        const details = document.createElement('div');
        details.className = 'cart-item-details';

        const name = document.createElement('div');
        name.className = 'cart-item-name';
        name.textContent = item.name;

        const price = document.createElement('div');
        price.className = 'cart-item-price';
        let priceValue = typeof item.price === 'string' ? parseFloat(item.price) : (item.price || 0);
        // Ensure priceValue is a valid number
        if (isNaN(priceValue) || priceValue === null || priceValue === undefined) {
            priceValue = 0;
        }
        price.textContent = `$${priceValue.toFixed(2)}`;

        const controls = document.createElement('div');
        controls.className = 'cart-item-controls';

        const decreaseBtn = document.createElement('button');
        decreaseBtn.className = 'quantity-btn decrease-qty';
        decreaseBtn.setAttribute('data-product-id', item.id);
        decreaseBtn.textContent = '-';

        const quantitySpan = document.createElement('span');
        quantitySpan.className = 'quantity-display';
        quantitySpan.textContent = item.quantity;

        const increaseBtn = document.createElement('button');
        increaseBtn.className = 'quantity-btn increase-qty';
        increaseBtn.setAttribute('data-product-id', item.id);
        increaseBtn.textContent = '+';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-item';
        removeBtn.type = 'button';
        removeBtn.setAttribute('data-product-id', item.id);
        removeBtn.setAttribute('aria-label', `Remove ${item.name} from cart`);
        appendCartDeleteButtonContents(removeBtn);

        controls.appendChild(decreaseBtn);
        controls.appendChild(quantitySpan);
        controls.appendChild(increaseBtn);

        details.appendChild(name);
        details.appendChild(price);
        details.appendChild(controls);

        cartItem.appendChild(img);
        cartItem.appendChild(details);
        cartItem.appendChild(removeBtn);

        // Add event listeners (using the elements we created above)
        decreaseBtn.addEventListener('click', () => {
            this.updateCartQuantity(item.id, item.quantity - 1, item.variant_id || null);
        });

        increaseBtn.addEventListener('click', () => {
            const inventoryLimit = item.inventory_quantity;
            if (inventoryLimit !== undefined && item.quantity >= inventoryLimit) {
                this.showNotification(`Only ${inventoryLimit} items available in stock`, 'error');
                return;
            }
            const product = this.products.find(p => String(p.id) === String(item.id));
            if (product && typeof product.inventory !== 'undefined' && !item.variant_id) {
                if (item.quantity >= product.inventory) {
                    this.showNotification(`Only ${product.inventory} items available in stock`, 'error');
                    return;
                }
            }
            this.updateCartQuantity(item.id, item.quantity + 1, item.variant_id || null);
        });

        removeBtn.addEventListener('click', () => {
            this.removeFromCart(item.id, item.variant_id || null);
        });

        return cartItem;
    }

    performSearch(query) {
        // Keyword-based search - split query into individual words
        const searchKeywords = query.toLowerCase().trim().split(/\s+/).filter(word => word.length > 0);

        if (searchKeywords.length === 0) {
            this.showSearchResults([], query);
            return;
        }

        // Filter products where ANY keyword matches in name, description, or category
        const results = this.products.filter(product => {
            const name = (product.name || '').toLowerCase();
            const description = (product.description || '').toLowerCase();
            const category = (product.category || '').toLowerCase();
            const brandSlug = (product.brand || '').toLowerCase();
            const brandName = (product.brandName || '').toLowerCase();
            const brandNameClean = brandName.replace(/[^a-z0-9]/g, '');

            // Check if ALL keywords are found somewhere in the product data
            return searchKeywords.every(keyword => {
                const keywordClean = keyword.replace(/[^a-z0-9]/g, '');
                return name.includes(keyword) ||
                    description.includes(keyword) ||
                    category.includes(keyword) ||
                    brandSlug.includes(keyword) ||
                    brandName.includes(keyword) ||
                    (keywordClean.length > 0 && brandNameClean.includes(keywordClean));
            });
        });

        this.showSearchResults(results, query);
        this.announceToScreenReader(`Found ${results.length} results for "${query}"`);
    }

    showSearchResults(results, query) {
        const searchDropdown = document.querySelector('.search-dropdown');
        if (searchDropdown) {
            searchDropdown.classList.remove('show');
        }

        window.location.href = `products.html?search=${encodeURIComponent(query)}`;
    }

    saveCartToStorage() {
        try {
            localStorage.setItem('hmherbs_cart', JSON.stringify(this.cart));
        } catch (error) {
            Logger.error('Error saving cart to localStorage:', error);
        }
    }

    loadCartFromStorage() {
        try {
            const savedCart = localStorage.getItem('hmherbs_cart');
            if (savedCart) {
                const parsedCart = JSON.parse(savedCart);
                // Validate and filter out invalid cart items
                this.cart = Array.isArray(parsedCart)
                    ? parsedCart.filter(item => item && item.id && item.name && typeof item.quantity === 'number' && item.quantity > 0)
                    : [];

                // If cart was filtered, save the cleaned version
                if (this.cart.length !== (parsedCart?.length || 0)) {
                    this.saveCartToStorage();
                }
            }
        } catch (error) {
            Logger.error('Error loading cart from localStorage:', error);
            this.cart = [];
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;

        // Create content safely without innerHTML to prevent XSS
        const content = document.createElement('div');
        content.className = 'notification-content';

        const messageSpan = document.createElement('span');
        messageSpan.className = 'notification-message';
        messageSpan.textContent = message; // Use textContent to prevent XSS

        const closeBtn = document.createElement('button');
        closeBtn.className = 'notification-close';
        closeBtn.setAttribute('aria-label', 'Close notification');
        closeBtn.type = 'button';
        closeBtn.innerHTML =
            '<svg class="cart-close-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/></svg>';
        content.appendChild(messageSpan);
        content.appendChild(closeBtn);
        notification.appendChild(content);

        // Add styles for notification
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#059669' : type === 'error' ? '#dc2626' : '#2563eb'};
            color: white;
            padding: 1rem;
            border-radius: 0.5rem;
            box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
            z-index: 1070;
            transform: translateX(100%);
            transition: transform 250ms ease-in-out;
            max-width: 300px;
        `;

        document.body.appendChild(notification);

        // Animate in
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 100);

        // Add close functionality (closeBtn already created above)
        this.addEventListenerWithCleanup(closeBtn, 'click', () => {
            // Clear the auto-close timeout when manually closed
            if (notification.autoCloseTimeout) {
                clearTimeout(notification.autoCloseTimeout);
            }
            this.closeNotification(notification);
        });

        // Auto-close after 5 seconds
        notification.autoCloseTimeout = setTimeout(() => {
            this.closeNotification(notification);
        }, 5000);
    }

    closeNotification(notification) {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }

    announceToScreenReader(message) {
        const liveRegion = document.getElementById('live-region');
        if (liveRegion) {
            liveRegion.textContent = message;
            // Clear after announcement
            setTimeout(() => {
                liveRegion.textContent = '';
            }, 1000);
        }
    }

    // Helper function to escape HTML to prevent XSS
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Helper function to safely create product cards using DOM methods
    createProductCard(product) {
        const productCard = document.createElement('div');
        productCard.className = `product-card ${product.inventory === 0 ? 'out-of-stock' : ''} ${product.inventory <= product.lowStockThreshold ? 'low-stock' : ''}`;
        productCard.setAttribute('data-product-id', product.id);

        // Create image element (blank area when no photo — never set src="" which resolves to the page URL)
        if (product.image) {
            const img = document.createElement('img');
            img.src = product.image;
            img.alt = product.name || '';
            img.className = 'product-image';
            img.setAttribute('loading', 'lazy');
            productCard.appendChild(img);
        } else {
            const blankImage = document.createElement('div');
            blankImage.className = 'product-image product-image--empty';
            blankImage.setAttribute('aria-hidden', 'true');
            productCard.appendChild(blankImage);
        }

        // Create title element (make it clickable if URL is provided)
        const title = document.createElement('h3');
        title.className = 'product-title';

        if (product.url) {
            const titleLink = document.createElement('a');
            titleLink.href = product.url;
            titleLink.textContent = product.name || '';
            titleLink.target = '_blank';
            titleLink.rel = 'noopener noreferrer';
            titleLink.className = 'product-title-link';
            title.appendChild(titleLink);
        } else {
            title.textContent = product.name || '';
        }

        // Create description element (if available)
        let description = null;
        if (product.description) {
            description = document.createElement('p');
            description.className = 'product-description';
            description.textContent = product.description;
        }

        // Create price element
        const price = document.createElement('p');
        price.className = 'product-price';
        price.textContent = `$${(product.price || 0).toFixed(2)}`;

        // Create inventory status safely
        const inventoryStatus = this.createInventoryStatusElement(product);

        // Create actions container
        const actions = document.createElement('div');
        actions.className = 'product-actions';

        // Create add to cart button
        const addToCartBtn = document.createElement('button');
        addToCartBtn.className = 'btn btn-primary add-to-cart-btn';
        addToCartBtn.setAttribute('data-product-id', product.id);
        addToCartBtn.setAttribute('aria-label', `Add ${product.name || 'product'} to cart`);

        if (product.inventory === 0) {
            addToCartBtn.disabled = true;
        }

        // Create cart icon
        const cartIcon = document.createElement('i');
        cartIcon.className = 'fas fa-cart-plus';
        cartIcon.setAttribute('aria-hidden', 'true');

        // Add button text
        const buttonText = document.createTextNode(product.inventory === 0 ? ' Out of Stock' : ' Add to Cart');

        // Assemble button
        addToCartBtn.appendChild(cartIcon);
        addToCartBtn.appendChild(buttonText);

        // Assemble actions
        actions.appendChild(addToCartBtn);

        // Assemble product card
        productCard.appendChild(title);
        if (description) {
            productCard.appendChild(description);
        }
        productCard.appendChild(price);
        productCard.appendChild(inventoryStatus);
        productCard.appendChild(actions);

        return productCard;
    }
}

// Performance Optimization Functions

// Lazy Loading for Images
function initLazyLoading() {
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;

                    // Add error handling for failed image loads
                    img.addEventListener('load', () => {
                        img.classList.remove('lazy');
                        img.classList.add('loaded');
                    }, { once: true });

                    img.addEventListener('error', () => {
                        img.classList.remove('lazy');
                        img.classList.add('error');
                        Logger.warn('Failed to load image:', img.dataset.src);
                        // Set fallback image if available
                        if (img.dataset.fallback) {
                            img.src = img.dataset.fallback;
                        }
                    }, { once: true });

                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                    }
                    observer.unobserve(img);
                }
            });
        }, {
            rootMargin: '50px 0px',
            threshold: 0.01
        });

        document.querySelectorAll('img[data-src]').forEach(img => {
            imageObserver.observe(img);
        });
    } else {
        // Fallback for browsers without IntersectionObserver
        document.querySelectorAll('img[data-src]').forEach(img => {
            // Add error handling for fallback mode too
            this.addEventListenerWithCleanup(img, 'load', () => {
                img.classList.remove('lazy');
                img.classList.add('loaded');
            }, { once: true });

            this.addEventListenerWithCleanup(img, 'error', () => {
                img.classList.remove('lazy');
                img.classList.add('error');
                Logger.warn('Failed to load image:', img.dataset.src);
                if (img.dataset.fallback) {
                    img.src = img.dataset.fallback;
                }
            }, { once: true });

            if (img.dataset.src) {
                img.src = img.dataset.src;
            }
        });
    }
}

// Image Optimization
function initImageOptimization() {
    // Add loading="lazy" to images that don't have it
    document.querySelectorAll('img:not([loading])').forEach(img => {
        // Don't lazy load images that are above the fold
        const rect = img.getBoundingClientRect();
        if (rect.top > window.innerHeight) {
            img.loading = 'lazy';
        }
    });

    // Optimize images for different screen sizes
    if (window.devicePixelRatio > 1) {
        document.querySelectorAll('img').forEach(img => {
            if (img.src && !img.src.includes('w=')) {
                // Add high DPI optimization for Unsplash images
                img.src = img.src.replace('w=400', 'w=800&dpr=2');
            }
        });
    }
}

// Core Web Vitals Optimization
function optimizeCoreWebVitals() {
    // styles.css and script.js are already linked in <head> with cache-busting query
    // strings. Injecting preload here runs too late and uses different URLs, which
    // triggers "preloaded but not used" console warnings without improving load time.
}

// Service Worker Registration for PWA
function registerServiceWorker() {
    // Skip service worker registration in file:// protocol
    if (window.location.protocol === 'file:') {
        return;
    }

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' })
                .then(registration => {
                    // Service Worker registered successfully

                    // Check if service worker is actually controlling the page
                    // Service worker registered - no logging needed
                    if (!navigator.serviceWorker.controller) {
                        // Service worker registered but not yet controlling the page
                    }

                    // Listen for updates
                    registration.addEventListener('updatefound', () => {
                        // Service worker update found
                    });
                })
                .catch(registrationError => {
                    // Only log error if not a protocol issue
                    if (!registrationError.message.includes('URL protocol') &&
                        !registrationError.message.includes('not supported') &&
                        !registrationError.message.includes('null')) {
                        // Service Worker registration failed

                        // Provide more detailed error information
                        if (registrationError.name === 'SecurityError') {
                            // Service Worker registration failed due to security restrictions
                        } else if (registrationError.name === 'NetworkError') {
                            // Service Worker registration failed due to network issues - retrying
                            // Retry after network issues
                            setTimeout(() => {
                                registerServiceWorker();
                            }, 30000);
                        }
                    }

                    // Graceful degradation - app continues to work without SW
                    // App will continue to work without offline capabilities
                });
        });
    } else {
        // Service Workers not supported in this browser
    }
}

// Prevent automatic scroll restoration (but allow user scrolling)
if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}

// Only prevent automatic scroll restoration on page load, not user scrolling
(function () {
    let isInitialLoad = true;

    // Ensure page starts at top on initial load/refresh only
    const ensureTopOnLoad = () => {
        if (isInitialLoad && !window.location.hash) {
            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
        }
    };

    // Run once on load
    window.addEventListener('load', () => {
        ensureTopOnLoad();
        // Mark initial load as complete after a short delay
        setTimeout(() => {
            isInitialLoad = false;
        }, 500);
    }, { passive: true });

    // Also ensure top on DOM ready (before images load)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            ensureTopOnLoad();
        });
    } else {
        // DOM already loaded
        ensureTopOnLoad();
    }
})();

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const onCheckout = hmHerbsIsCheckoutPage();

    syncHmHeaderOffset();
    window.addEventListener('resize', syncHmHeaderOffset, { passive: true });

    // Checkout has its own manager; skip global image/perf passes that touch every <img>.
    if (!onCheckout) {
        initLazyLoading();
        initImageOptimization();
        optimizeCoreWebVitals();
    }

    // Initialize main application only if not on products or checkout page
    if (!window.location.pathname.includes('products.html') && !onCheckout) {
        window.hmHerbsApp = new HMHerbsApp();

        // Fallback: Ensure cart toggle works even if class-based setup fails
        // Only run if main listeners weren't attached
        setTimeout(() => {
            const fallbackCartToggle = document.querySelector('.cart-toggle');
            const fallbackCartSidebar = document.getElementById('cart-sidebar');
            const fallbackCartOverlay = document.getElementById('cart-overlay');
            const fallbackCartClose = document.querySelector('.cart-close');

            // Only use fallback if main listeners weren't attached
            if (fallbackCartToggle && !fallbackCartToggle.hasAttribute('data-main-listener')) {
                const handleCartToggle = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const isOpen = fallbackCartSidebar.classList.contains('show') || fallbackCartSidebar.classList.contains('open');
                    if (isOpen) {
                        // Accessibility: move focus out before hiding
                        const activeEl = document.activeElement;
                        if (activeEl && fallbackCartSidebar.contains(activeEl)) {
                            activeEl.blur();
                        }
                        fallbackCartToggle.blur();
                        fallbackCartToggle.setAttribute('aria-expanded', 'false');

                        fallbackCartSidebar.classList.remove('show', 'open');
                        fallbackCartSidebar.setAttribute('aria-hidden', 'true');
                        if (fallbackCartOverlay) fallbackCartOverlay.classList.remove('active');
                        document.body.classList.remove('cart-open');
                        document.body.style.overflow = '';
                        document.documentElement.style.overflow = '';
                    } else {
                        syncHmHeaderOffset();
                        fallbackCartSidebar.classList.add('show', 'open');
                        fallbackCartSidebar.setAttribute('aria-hidden', 'false');
                        fallbackCartToggle.setAttribute('aria-expanded', 'true');
                        if (fallbackCartOverlay) fallbackCartOverlay.classList.add('active');
                        document.body.classList.add('cart-open');
                        document.body.style.overflow = 'hidden';
                        document.documentElement.style.overflow = 'hidden';
                        if (window.hmHerbsApp) {
                            setTimeout(() => window.hmHerbsApp.updateCartDisplay(), 50);
                        }
                    }
                };

                fallbackCartToggle.setAttribute('data-fallback-listener', 'true');
                fallbackCartToggle.addEventListener('click', handleCartToggle);
            }

            // Fallback: Ensure cart close button works
            if (fallbackCartClose && fallbackCartSidebar && !fallbackCartClose.hasAttribute('data-main-listener')) {
                fallbackCartClose.setAttribute('data-listener-attached', 'true');
                fallbackCartClose.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    // Accessibility: move focus out before hiding
                    const activeEl = document.activeElement;
                    if (activeEl && fallbackCartSidebar.contains(activeEl)) {
                        activeEl.blur();
                        // Remove focus from any focused elements inside the cart
                        const focusedElements = fallbackCartSidebar.querySelectorAll(':focus');
                        focusedElements.forEach(el => el.blur());
                    }
                    if (fallbackCartToggle) {
                        fallbackCartToggle.blur();
                        fallbackCartToggle.setAttribute('aria-expanded', 'false');
                    }

                    // Use requestAnimationFrame to ensure focus change completes before setting aria-hidden
                    requestAnimationFrame(() => {
                        fallbackCartSidebar.classList.remove('show', 'open');
                        fallbackCartSidebar.setAttribute('aria-hidden', 'true');
                        if (fallbackCartOverlay) {
                            fallbackCartOverlay.classList.remove('active');
                        }
                        document.body.style.overflow = '';
                        document.documentElement.style.overflow = '';
                    });
                });
            }

            // Fallback: Ensure overlay click closes cart
            if (fallbackCartOverlay && fallbackCartSidebar && !fallbackCartOverlay.hasAttribute('data-main-listener')) {
                fallbackCartOverlay.setAttribute('data-listener-attached', 'true');
                fallbackCartOverlay.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    // Accessibility: move focus out before hiding
                    const activeEl = document.activeElement;
                    if (activeEl && fallbackCartSidebar.contains(activeEl)) {
                        activeEl.blur();
                    }
                    if (fallbackCartToggle) {
                        fallbackCartToggle.blur();
                        fallbackCartToggle.setAttribute('aria-expanded', 'false');
                    }

                    fallbackCartSidebar.classList.remove('show', 'open');
                    fallbackCartSidebar.setAttribute('aria-hidden', 'true');
                    fallbackCartOverlay.classList.remove('active');
                    document.body.style.overflow = '';
                    document.documentElement.style.overflow = '';
                });
            }
        }, 100);
    }

    // Register service worker for PWA features
    registerServiceWorker();

    // Setup cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (window.hmHerbsApp) {
            window.hmHerbsApp.cleanup();
        }
    });

    // Also cleanup on page hide (for mobile)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && window.hmHerbsApp) {
            window.hmHerbsApp.cleanup();
        }
    });
});

// Note: Mobile menu toggle is handled by inline script in index.html head
// This ensures it works immediately without waiting for script.js to load

// EDSA booking: `openEDSABooking` is defined in js/edsa-booking.js (loads after this script).

// Export for potential module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HMHerbsApp;
}
