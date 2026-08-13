/**
 * Products Page JavaScript
 * Handles product catalog display, filtering, pagination, and cart functionality
 */

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

class ProductsPage {
    constructor() {
        this.products = [];
        this.filteredProducts = [];
        this.currentPage = 1;
        this.productsPerPage = 20;
        this.totalPages = 0;
        this.currentFilters = {
            search: '',
            category: '',
            brand: '',
            sort: 'name'
        };

        // Cart functionality (shared with main app)
        this.cart = [];

        // Track event listeners for cleanup
        this.eventListeners = [];

        // Debouncing for cart operations to prevent race conditions
        this.cartOperationTimeouts = new Map();
        this.cartOperationDelay = 300; // 300ms debounce

        this.init();
    }

    async init() {
        try {
            // Load cart from storage
            this.loadCartFromStorage();

            // Load products
            await this.loadProducts();

            // Setup event listeners
            this.setupEventListeners();

            // Apply URL parameters
            this.applyUrlParameters();

            // Initial render
            this.applyFilters();
            this.updateCartDisplay();
        } catch (error) {
            console.error('Failed to initialize Products Page:', error);
            this.showError('Failed to load products. Please refresh the page.');
        }
    }

    async loadProducts() {
        const loadingState = document.getElementById('loading-state');
        const productsGrid = document.getElementById('products-grid');

        try {
            if (loadingState) loadingState.style.display = 'block';
            if (productsGrid) productsGrid.style.display = 'none';

            // Get API base URL — use shared loopback helper when static files are on another port
            const apiBaseUrl =
                typeof window.hmHerbsStorefrontApiBase === 'function'
                    ? window.hmHerbsStorefrontApiBase()
                    : (() => {
                          if (window.location.protocol === 'file:') return 'http://localhost:3001';
                          const h = window.location.hostname;
                          if ((h === 'localhost' || h === '127.0.0.1') && window.location.port !== '3001') {
                              return 'http://localhost:3001';
                          }
                          return '';
                      })();

            // Check URL parameters for brand/category to pass to API
            const urlParams = new URLSearchParams(window.location.search);
            const brandParam = urlParams.get('brand');
            const categoryParam = urlParams.get('category');
            const healthCategoryParam = urlParams.get('healthCategory');
            const searchParam = urlParams.get('search');

            // Clean brand (remove hyphens/spaces/specials) for consistent API queries
            const cleanBrandParam = brandParam
                ? brandParam.toLowerCase().replace(/[^a-z0-9]/g, '')
                : null;

            // Build API URL with filters
            let apiUrl = `${apiBaseUrl}/api/products?limit=1000`;
            if (brandParam) {
                // Prefer cleaned brand when present to maximize server matches
                apiUrl += `&brand=${encodeURIComponent(cleanBrandParam || brandParam)}`;
            }
            if (categoryParam) {
                apiUrl += `&category=${encodeURIComponent(categoryParam)}`;
                if (!healthCategoryParam) {
                    apiUrl += `&healthCategory=${encodeURIComponent(categoryParam)}`;
                }
            }
            if (healthCategoryParam) {
                apiUrl += `&healthCategory=${encodeURIComponent(healthCategoryParam)}`;
                if (!categoryParam) {
                    apiUrl += `&category=${encodeURIComponent(healthCategoryParam)}`;
                }
            }
            if (searchParam) {
                apiUrl += `&search=${encodeURIComponent(searchParam)}`;
            }

            console.log('Fetching products from:', apiUrl);

            // Load from API only - no demo products fallback
            const response = await fetch(apiUrl).catch(err => {
                console.error('Fetch error:', err);
                return null;
            });

            if (response && response.ok) {
                const data = await response.json();
                console.log('API Response:', data);
                let productsFromApi = data.products || [];

                // Retry with a "clean" brand if brand filter returned nothing (double safety)
                if (brandParam && productsFromApi.length === 0 && cleanBrandParam && cleanBrandParam !== brandParam.toLowerCase()) {
                    const retryUrl = `${apiBaseUrl}/api/products?limit=1000&brand=${encodeURIComponent(cleanBrandParam)}`;
                    console.log('Retrying with cleaned brand:', retryUrl);
                    const retryResp = await fetch(retryUrl).catch(err => {
                        console.error('Retry fetch error:', err);
                        return null;
                    });
                    if (retryResp && retryResp.ok) {
                        const retryData = await retryResp.json();
                        productsFromApi = retryData.products || [];
                        console.log('Retry API Response:', retryData);
                    }
                }

                // Retry with healthCategory if category was provided and no products returned
                if (productsFromApi.length === 0 && categoryParam && !healthCategoryParam) {
                    const retryUrl = `${apiBaseUrl}/api/products?limit=1000&healthCategory=${encodeURIComponent(categoryParam)}`;
                    console.log('Retrying with healthCategory fallback:', retryUrl);
                    const retryResp = await fetch(retryUrl).catch(err => {
                        console.error('Retry fetch error (healthCategory):', err);
                        return null;
                    });
                    if (retryResp && retryResp.ok) {
                        const retryData = await retryResp.json();
                        productsFromApi = retryData.products || [];
                        console.log('Retry API Response (healthCategory):', retryData);
                    }
                }

                if (productsFromApi.length > 0) {
                    // Transform API products to match expected format
                    this.products = productsFromApi.map(product => ({
                        id: product.id,
                        name: product.name,
                        price: parseFloat(product.price) || 0,
                        image: product.image_url || product.image || '',
                        category: product.category_slug || product.category_name || '',
                        brand: product.brand_slug || product.brand_name || '',
                        brandName: product.brand_name || '',
                        description: product.short_description || product.long_description || '',
                        inventory: product.inventory_quantity || 0,
                        featured: product.is_featured || false,
                        inStock: (product.inventory_quantity || 0) > 0 || product.inventory_quantity === null,
                        lowStockThreshold: 5,
                        slug: product.slug || ''
                    }));
                    console.log(`Successfully loaded ${this.products.length} products`);
                } else {
                    console.warn('API returned no products');
                    if (
                        !brandParam &&
                        !categoryParam &&
                        !healthCategoryParam &&
                        !searchParam &&
                        data.pagination &&
                        Number(data.pagination.totalProducts) === 0
                    ) {
                        console.warn(
                            'Empty catalog with no URL filters. Open /api/health/ready — if activeProducts is 0, import or seed the database (or set is_active=1 on products). If database is "unavailable", start MySQL and check backend/.env.'
                        );
                    }
                    this.products = [];
                }
            } else {
                let detail = response ? String(response.status) : 'No response';
                if (response) {
                    try {
                        const errBody = await response.json();
                        if (errBody && errBody.error) {
                            detail = `${response.status}: ${errBody.error}`;
                        }
                        if (response.status === 503) {
                            this.showError(
                                'The catalog cannot load because the database is not reachable. Start MySQL, confirm backend/.env, then refresh the page.'
                            );
                        }
                    } catch (_) {
                        /* ignore non-JSON error bodies */
                    }
                }
                console.error('API failed with status:', detail);
                this.products = [];
            }

        } catch (error) {
            console.error('Error loading products:', error);
            this.products = [];
        } finally {
            if (loadingState) loadingState.style.display = 'none';
            if (productsGrid) productsGrid.style.display = 'grid';
        }
    }

    createProductPlaceholder(_productName) {
        // Create a simple, reliable placeholder image
        const canvas = document.createElement('canvas');
        canvas.width = 300;
        canvas.height = 300;
        const ctx = canvas.getContext('2d');

        // Create gradient background
        const gradient = ctx.createLinearGradient(0, 0, 300, 300);
        gradient.addColorStop(0, '#4a7c59');
        gradient.addColorStop(1, '#5a8c69');

        // Fill background
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 300, 300);

        // Add text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Natural Health', 150, 140);
        ctx.font = '14px Arial, sans-serif';
        ctx.fillText('Product', 150, 170);

        // Convert to data URL
        return canvas.toDataURL('image/png');
    }

    setupEventListeners() {
        // Search input — same debounce + matching as homepage hero search
        const searchInput = document.getElementById('product-search');
        if (searchInput) {
            const runSearch = (raw) => {
                this.currentFilters.search = String(raw || '').trim().toLowerCase();
                this.currentPage = 1;
                this.applyFilters();
            };
            if (typeof window.hmBindSearchInput === 'function') {
                window.hmBindSearchInput(searchInput, {
                    debounceMs: 300,
                    onSearch: (raw) => runSearch(raw)
                });
            } else {
                searchInput.addEventListener('input', this.debounce((e) => {
                    runSearch(e.target.value);
                }, 300));
            }
        }

        // Sort filter
        const sortFilter = document.getElementById('sort-filter');
        if (sortFilter) {
            sortFilter.addEventListener('change', (e) => {
                this.currentFilters.sort = e.target.value;
                this.currentPage = 1;
                this.applyFilters();
            });
        }

        // Reset filters
        const resetButton = document.getElementById('reset-filters');
        if (resetButton) {
            resetButton.addEventListener('click', () => {
                this.resetFilters();
            });
        }

        // Cart functionality
        this.setupCartEventListeners();

        // Pagination (will be set up dynamically)
        this.setupPaginationEventListeners();
    }

    setupCartEventListeners() {
        // Cart toggle
        const cartToggle = document.querySelector('.cart-toggle');
        const cartOverlay = document.getElementById('cart-overlay');
        const cartClose = document.querySelector('.cart-close');
        const checkoutBtn = document.getElementById('checkout-btn');

        if (cartToggle) {
            cartToggle.addEventListener('click', () => {
                this.toggleCart();
            });
        }

        if (cartClose) {
            cartClose.addEventListener('click', () => {
                this.closeCart();
            });
        }

        if (cartOverlay) {
            cartOverlay.addEventListener('click', () => {
                this.closeCart();
            });
        }

        // Checkout button
        if (checkoutBtn) {
            checkoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Use arrow function to preserve 'this' context, with fallback
                if (this && this.proceedToCheckout) {
                    this.proceedToCheckout();
                } else if (window.productsPage && window.productsPage.proceedToCheckout) {
                    window.productsPage.proceedToCheckout();
                } else {
                    console.error('proceedToCheckout method not found in ProductsPage');
                }
            });
        }

        // Products grid event delegation for add to cart
        const productsGrid = document.getElementById('products-grid');
        if (productsGrid) {
            productsGrid.addEventListener('click', (e) => {
                if (e.target.closest('.add-to-cart-btn')) {
                    const productElement = e.target.closest('[data-product-id]');
                    if (productElement) {
                        const productId = productElement.dataset.productId;
                        this.addToCart(productId);
                    }
                }
            });
        }
    }

    setupPaginationEventListeners() {
        const pagination = document.getElementById('pagination');
        if (pagination) {
            pagination.addEventListener('click', (e) => {
                e.preventDefault();
                const link = e.target.closest('a[data-page]');
                if (link) {
                    const page = parseInt(link.dataset.page);
                    if (page !== this.currentPage) {
                        this.currentPage = page;
                        this.applyFilters();
                        this.scrollToTop();
                    }
                }
            });
        }
    }

    applyUrlParameters() {
        const urlParams = new URLSearchParams(window.location.search);

        // Apply brand from URL
        const brand = urlParams.get('brand');
        if (brand) {
            this.currentFilters.brand = brand;
        }

        // Apply health category or product category from URL
        const healthCategory = urlParams.get('healthCategory');
        const category = urlParams.get('category');
        if (healthCategory) {
            this.currentFilters.category = healthCategory;
        } else if (category) {
            this.currentFilters.category = category;
        }

        // Apply search from URL
        const search = urlParams.get('search');
        if (search) {
            this.currentFilters.search = search.toLowerCase();
            const searchInput = document.getElementById('product-search');
            if (searchInput) {
                searchInput.value = search;
            }
        }

        // Apply page from URL
        const page = urlParams.get('page');
        if (page) {
            const pageNum = parseInt(page) || 1;
            // Validate page is positive and not beyond reasonable bounds
            this.currentPage = Math.max(1, Math.min(pageNum, this.totalPages || 1));
        }
    }

    applyFilters() {
        const hasActiveFilter = !!(this.currentFilters.brand || this.currentFilters.category || this.currentFilters.search);
        const browseBySection = document.querySelector('.browse-by-section');

        // Hide browse-by section if a filter is active
        if (browseBySection) {
            browseBySection.style.display = hasActiveFilter ? 'none' : 'block';
        }

        // Start with all products
        this.filteredProducts = [...this.products];

        // Only apply client-side filtering if we didn't filter via API
        // or if we want to support combining search with brand/category

        // Apply search filter with keyword matching
        if (this.currentFilters.search) {
            if (typeof window.hmProductSearchMatch === 'function') {
                this.filteredProducts = window.hmProductSearchMatch(this.filteredProducts, this.currentFilters.search);
            } else {
                const searchKeywords = this.currentFilters.search.toLowerCase().trim().split(/\s+/).filter(word => word.length > 0);
                if (searchKeywords.length > 0) {
                    this.filteredProducts = this.filteredProducts.filter(product => {
                        const name = (product.name || '').toLowerCase();
                        const description = (product.description || '').toLowerCase();
                        const category = (product.category || '').toLowerCase();
                        const brandSlug = (product.brand || '').toLowerCase();
                        const brandName = (product.brandName || '').toLowerCase();
                        const brandNameClean = brandName.replace(/[^a-z0-9]/g, '');
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
                }
            }
        }

        // Apply brand filter ONLY if we haven't already filtered by brand via API
        // (If products list is large, we might have skipped API filtering)
        const isAlreadyApiFilteredByBrand = new URLSearchParams(window.location.search).has('brand');

        if (this.currentFilters.brand && !isAlreadyApiFilteredByBrand) {
            const filterBrand = (this.currentFilters.brand || '').toLowerCase().trim();
            const filterBrandClean = filterBrand.replace(/[^a-z0-9]/g, '');

            this.filteredProducts = this.filteredProducts.filter(product => {
                const productBrandSlug = (product.brand || '').toLowerCase().trim();
                const productBrandName = (product.brandName || '').toLowerCase().trim();
                const productBrandSlugClean = productBrandSlug.replace(/[^a-z0-9]/g, '');
                const productBrandNameClean = productBrandName.replace(/[^a-z0-9]/g, '');

                return productBrandSlug === filterBrand ||
                    productBrandSlugClean === filterBrandClean ||
                    productBrandNameClean === filterBrandClean ||
                    productBrandSlug.includes(filterBrand) ||
                    filterBrand.includes(productBrandSlug) ||
                    productBrandName.includes(filterBrand) ||
                    productBrandSlugClean.includes(filterBrandClean) ||
                    filterBrandClean.includes(productBrandSlugClean);
            });
        }

        // Apply category filter (if not already API filtered)
        const urlParams = new URLSearchParams(window.location.search);
        const isAlreadyApiFilteredByCategory = urlParams.has('category') || urlParams.has('healthCategory');
        if (this.currentFilters.category && !isAlreadyApiFilteredByCategory) {
            const filterCat = this.currentFilters.category.toLowerCase();
            this.filteredProducts = this.filteredProducts.filter(product =>
                product.category === filterCat || product.category.includes(filterCat)
            );
        }

        // Apply sorting
        this.sortProducts();

        // Calculate pagination
        this.totalPages = Math.ceil(this.filteredProducts.length / this.productsPerPage);

        // Ensure current page is valid
        if (this.currentPage > this.totalPages) {
            this.currentPage = Math.max(1, this.totalPages);
        }

        // Render results
        this.renderProducts();
        this.renderPagination();
        this.updatePageTitle();
        this.updateUrl();
    }

    updatePageTitle() {
        const titleEl = document.querySelector('.page-title');
        const subtitleEl = document.querySelector('.page-subtitle');
        if (!titleEl) return;

        if (this.currentFilters.brand) {
            const brandName = this.filteredProducts.length > 0 && this.filteredProducts[0].brandName
                ? this.filteredProducts[0].brandName
                : this.currentFilters.brand.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            titleEl.textContent = `${brandName} Products`;
            if (subtitleEl) subtitleEl.textContent = `Browsing all products from ${brandName}`;
        } else if (this.currentFilters.category) {
            const catName = this.currentFilters.category.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            titleEl.textContent = `${catName} Products`;
            if (subtitleEl) subtitleEl.textContent = `Browsing all products in ${catName}`;
        } else if (this.currentFilters.search) {
            titleEl.textContent = `Search Results: ${this.currentFilters.search}`;
            if (subtitleEl) subtitleEl.textContent = `Found ${this.filteredProducts.length} products matching your search`;
        } else {
            titleEl.textContent = 'Natural Health Products';
            if (subtitleEl) subtitleEl.textContent = 'Discover our complete collection of premium herbs, vitamins, and natural supplements';
        }
    }

    sortProducts() {
        switch (this.currentFilters.sort) {
            case 'name':
                this.filteredProducts.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case 'name-desc':
                this.filteredProducts.sort((a, b) => b.name.localeCompare(a.name));
                break;
            case 'price':
                this.filteredProducts.sort((a, b) => a.price - b.price);
                break;
            case 'price-desc':
                this.filteredProducts.sort((a, b) => b.price - a.price);
                break;
            case 'featured':
                this.filteredProducts.sort((a, b) => {
                    if (a.featured && !b.featured) return -1;
                    if (!a.featured && b.featured) return 1;
                    return a.name.localeCompare(b.name);
                });
                break;
        }
    }

    renderProducts() {
        const productsGrid = document.getElementById('products-grid');
        const noResults = document.getElementById('no-results');

        if (!productsGrid) {
            console.error('Products grid element not found!');
            return;
        }

        // Calculate products for current page
        const startIndex = (this.currentPage - 1) * this.productsPerPage;
        const endIndex = startIndex + this.productsPerPage;
        const pageProducts = this.filteredProducts.slice(startIndex, endIndex);

        // Clear existing content
        productsGrid.innerHTML = '';

        if (pageProducts.length === 0) {
            productsGrid.style.display = 'none';
            if (noResults) noResults.style.display = 'block';
            return;
        }

        productsGrid.style.display = 'grid';
        if (noResults) noResults.style.display = 'none';

        // Create product cards
        pageProducts.forEach((product) => {
            const productCard = this.createProductCard(product);
            productsGrid.appendChild(productCard);
        });
    }

    createProductCard(product) {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.setAttribute('data-product-id', product.id);

        // Product link wrapper for image and title
        const productLink = document.createElement('a');
        productLink.href = `product.html?slug=${encodeURIComponent(product.slug || product.name.toLowerCase().replace(/\s+/g, '-'))}`;
        productLink.className = 'product-link';
        productLink.setAttribute('aria-label', `View ${product.name} details`);

        // Product image
        if (product.image) {
            const image = document.createElement('img');
            image.className = 'product-image';
            image.src = product.image;
            image.alt = product.name;
            image.loading = 'lazy';
            productLink.appendChild(image);
        } else {
            const blankImage = document.createElement('div');
            blankImage.className = 'product-image product-image--empty';
            blankImage.setAttribute('aria-hidden', 'true');
            productLink.appendChild(blankImage);
        }

        // Product title
        const title = document.createElement('h3');
        title.className = 'product-title';
        title.textContent = product.name;

        // Add image and title to link
        productLink.appendChild(title);

        // Product price
        const price = document.createElement('div');
        price.className = 'product-price';
        // Handle both string and number prices
        const priceValue = typeof product.price === 'string' ? parseFloat(product.price) : product.price;
        price.textContent = `$${priceValue.toFixed(2)}`;

        // Product brand (if available)
        const brand = document.createElement('div');
        brand.className = 'product-brand';
        if (product.brand) {
            const brandLink = document.createElement('a');
            brandLink.href = `products.html?brand=${encodeURIComponent(product.brand)}`;
            brandLink.textContent = product.brand.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            brandLink.className = 'brand-link';
            brand.appendChild(brandLink);
        }

        // Product description (if available)
        const description = document.createElement('p');
        description.className = 'product-description';
        description.textContent = product.description || '';

        // Inventory status
        const inventoryStatus = this.createInventoryStatusElement(product);

        // Add to cart button
        const addToCartBtn = document.createElement('button');
        addToCartBtn.className = 'btn btn-primary add-to-cart-btn';

        // Create button content safely
        const cartIcon = document.createElement('i');
        cartIcon.className = 'fas fa-cart-plus';
        cartIcon.setAttribute('aria-hidden', 'true');
        const buttonText = document.createTextNode(' Add to Cart');

        addToCartBtn.appendChild(cartIcon);
        addToCartBtn.appendChild(buttonText);

        // Disable button if out of stock
        if (product.inventory === 0 || !product.inStock) {
            addToCartBtn.disabled = true;
            addToCartBtn.textContent = 'Out of Stock';
            addToCartBtn.className = 'btn btn-secondary add-to-cart-btn';
        }

        // Prevent link navigation when clicking add to cart
        addToCartBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.addToCart(product.id);
        });

        // Assemble card
        card.appendChild(productLink);
        card.appendChild(brand);
        card.appendChild(price);
        if (product.description) {
            card.appendChild(description);
        }
        card.appendChild(inventoryStatus);
        card.appendChild(addToCartBtn);

        return card;
    }

    createInventoryStatusElement(product) {
        const statusDiv = document.createElement('div');
        statusDiv.className = 'inventory-status';

        const icon = document.createElement('i');
        const text = document.createElement('span');

        if (typeof product.inventory === 'undefined') {
            if (product.inStock) {
                statusDiv.classList.add('in-stock');
                icon.className = 'fas fa-check-circle';
                text.textContent = ' In Stock';
            } else {
                statusDiv.classList.add('out-of-stock');
                icon.className = 'fas fa-times-circle';
                text.textContent = ' Out of Stock';
            }
        } else {
            const inventoryCount = parseInt(product.inventory, 10);
            if (inventoryCount === 0) {
                statusDiv.classList.add('out-of-stock');
                icon.className = 'fas fa-times-circle';
                text.textContent = ' Out of Stock';
            } else if (inventoryCount <= (product.lowStockThreshold || 5)) {
                statusDiv.classList.add('low-stock');
                icon.className = 'fas fa-exclamation-triangle';
                text.textContent = ` Only ${inventoryCount} left`;
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

    // Legacy method for backward compatibility
    getInventoryStatusHTML(product) {
        const element = this.createInventoryStatusElement(product);
        return element.outerHTML;
    }

    renderPagination() {
        const pagination = document.getElementById('pagination');
        const paginationInfo = document.getElementById('pagination-info');

        if (!pagination) return;

        // Update pagination info
        const startItem = this.filteredProducts.length === 0 ? 0 : (this.currentPage - 1) * this.productsPerPage + 1;
        const endItem = Math.min(this.currentPage * this.productsPerPage, this.filteredProducts.length);

        if (paginationInfo) {
            paginationInfo.textContent = `Showing ${startItem}-${endItem} of ${this.filteredProducts.length} products`;
        }

        // Clear existing pagination
        pagination.innerHTML = '';

        if (this.totalPages <= 1) return;

        // Previous button
        const prevLi = document.createElement('li');
        if (this.currentPage === 1) {
            const prevSpan = document.createElement('span');
            prevSpan.className = 'disabled';
            prevSpan.textContent = 'Previous';
            prevLi.appendChild(prevSpan);
            prevLi.className = 'disabled';
        } else {
            const prevLink = document.createElement('a');
            prevLink.href = '#';
            prevLink.setAttribute('data-page', this.currentPage - 1);
            prevLink.textContent = 'Previous';
            prevLi.appendChild(prevLink);
        }
        pagination.appendChild(prevLi);

        // Page numbers
        const startPage = Math.max(1, this.currentPage - 2);
        const endPage = Math.min(this.totalPages, this.currentPage + 2);

        if (startPage > 1) {
            const firstLi = document.createElement('li');
            const firstLink = document.createElement('a');
            firstLink.href = '#';
            firstLink.setAttribute('data-page', '1');
            firstLink.textContent = '1';
            firstLi.appendChild(firstLink);
            pagination.appendChild(firstLi);

            if (startPage > 2) {
                const ellipsisLi = document.createElement('li');
                const ellipsisSpan = document.createElement('span');
                ellipsisSpan.textContent = '...';
                ellipsisLi.appendChild(ellipsisSpan);
                pagination.appendChild(ellipsisLi);
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            const pageLi = document.createElement('li');
            if (i === this.currentPage) {
                const activeSpan = document.createElement('span');
                activeSpan.className = 'active';
                activeSpan.textContent = i.toString();
                pageLi.appendChild(activeSpan);
                pageLi.className = 'active';
            } else {
                const pageLink = document.createElement('a');
                pageLink.href = '#';
                pageLink.setAttribute('data-page', i.toString());
                pageLink.textContent = i.toString();
                pageLi.appendChild(pageLink);
            }
            pagination.appendChild(pageLi);
        }

        if (endPage < this.totalPages) {
            if (endPage < this.totalPages - 1) {
                const ellipsisLi = document.createElement('li');
                const ellipsisSpan = document.createElement('span');
                ellipsisSpan.textContent = '...';
                ellipsisLi.appendChild(ellipsisSpan);
                pagination.appendChild(ellipsisLi);
            }

            const lastLi = document.createElement('li');
            const lastLink = document.createElement('a');
            lastLink.href = '#';
            lastLink.setAttribute('data-page', this.totalPages.toString());
            lastLink.textContent = this.totalPages.toString();
            lastLi.appendChild(lastLink);
            pagination.appendChild(lastLi);
        }

        // Next button
        const nextLi = document.createElement('li');
        if (this.currentPage === this.totalPages) {
            const nextSpan = document.createElement('span');
            nextSpan.className = 'disabled';
            nextSpan.textContent = 'Next';
            nextLi.appendChild(nextSpan);
            nextLi.className = 'disabled';
        } else {
            const nextLink = document.createElement('a');
            nextLink.href = '#';
            nextLink.setAttribute('data-page', (this.currentPage + 1).toString());
            nextLink.textContent = 'Next';
            nextLi.appendChild(nextLink);
        }
        pagination.appendChild(nextLi);
    }

    resetFilters() {
        this.currentFilters = {
            search: '',
            category: '',
            brand: '',
            sort: 'name'
        };
        this.currentPage = 1;

        // Reset form elements
        const searchInput = document.getElementById('product-search');
        const sortFilter = document.getElementById('sort-filter');

        if (searchInput) searchInput.value = '';
        if (sortFilter) sortFilter.value = 'name';

        // Clear brand from URL
        const urlParams = new URLSearchParams(window.location.search);
        urlParams.delete('brand');
        const newUrl = urlParams.toString()
            ? `${window.location.pathname}?${urlParams.toString()}`
            : window.location.pathname;
        window.history.replaceState({}, '', newUrl);

        // Reload products without brand filter
        this.loadProducts().then(() => {
            this.applyFilters();
        });
    }

    updateUrl() {
        const params = new URLSearchParams();

        if (this.currentFilters.search) {
            params.set('search', this.currentFilters.search);
        }


        if (this.currentFilters.brand) {
            params.set('brand', this.currentFilters.brand);
        }

        if (this.currentPage > 1) {
            params.set('page', this.currentPage.toString());
        }

        const newUrl = params.toString()
            ? `${window.location.pathname}?${params.toString()}`
            : window.location.pathname;

        window.history.replaceState({}, '', newUrl);
    }

    scrollToTop() {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    }

    // Cart functionality (shared with main app)
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

        // Check inventory availability
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
            // Ensure price is a number
            let priceValue = typeof product.price === 'string' ? parseFloat(product.price) : (product.price || 0);
            // Ensure priceValue is a valid number
            if (isNaN(priceValue) || priceValue === null || priceValue === undefined) {
                priceValue = 0;
            }

            this.cart.push({
                id: productId,
                name: product.name,
                price: priceValue,
                image: product.image,
                quantity: quantity
            });
        }

        this.updateCartDisplay();
        this.saveCartToStorage();
        this.showNotification(`${product.name} added to cart`, 'success');
    }

    removeFromCart(productId) {
        this.cart = this.cart.filter(item => String(item.id) !== String(productId));
        this.updateCartDisplay();
        this.saveCartToStorage();
        this.showNotification('Item removed from cart', 'success');
    }

    proceedToCheckout() {
        console.log('ProductsPage proceedToCheckout called', { cartLength: this.cart?.length, cart: this.cart });

        // Check if cart is empty
        if (!this.cart || this.cart.length === 0) {
            console.log('Cart is empty, showing error');
            this.showNotification('Your cart is empty', 'error');
            return false;
        }

        // Save cart to sessionStorage for checkout page
        try {
            const cartData = JSON.stringify(this.cart);
            sessionStorage.setItem('checkout_cart', cartData);
            console.log('Cart saved to sessionStorage:', cartData);
        } catch (error) {
            console.error('Error saving cart to sessionStorage:', error);
            this.showNotification('Error saving cart. Please try again.', 'error');
            return false;
        }

        if (window.customerAuth && typeof window.customerAuth.stashCheckoutCustomerSnapshot === 'function') {
            window.customerAuth.stashCheckoutCustomerSnapshot();
        }

        // Navigate to checkout page
        const checkoutUrl = 'checkout.html';
        console.log('Navigating to:', checkoutUrl);

        try {
            // Force navigation
            if (window.location && window.location.href) {
                window.location.href = checkoutUrl;
                console.log('Navigation initiated via window.location.href');
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

    updateCartQuantity(productId, newQuantity) {
        // Debounce cart quantity updates to prevent race conditions
        const operationKey = `update-${productId}`;

        // Clear existing timeout for this operation
        if (this.cartOperationTimeouts.has(operationKey)) {
            clearTimeout(this.cartOperationTimeouts.get(operationKey));
        }

        // Set new timeout
        const timeoutId = setTimeout(() => {
            this._performUpdateCartQuantity(productId, newQuantity);
            this.cartOperationTimeouts.delete(operationKey);
        }, this.cartOperationDelay);

        this.cartOperationTimeouts.set(operationKey, timeoutId);
    }

    _performUpdateCartQuantity(productId, newQuantity) {
        const item = this.cart.find(item => String(item.id) === String(productId));

        if (item) {
            if (newQuantity <= 0) {
                this.removeFromCart(productId);
            } else {
                // Validate inventory before updating quantity
                const product = this.products.find(p => String(p.id) === String(productId));
                if (product && typeof product.inventory !== 'undefined') {
                    if (newQuantity > product.inventory) {
                        this.showNotification(`Only ${product.inventory} items available in stock`, 'error');
                        return;
                    }
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
    }

    createCartItem(item) {
        const cartItem = document.createElement('div');
        cartItem.className = 'cart-item';
        cartItem.setAttribute('data-product-id', item.id);

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
            this.updateCartQuantity(item.id, item.quantity - 1);
        });

        increaseBtn.addEventListener('click', () => {
            // Check inventory before increasing
            const product = this.products.find(p => String(p.id) === String(item.id));
            if (product && typeof product.inventory !== 'undefined') {
                if (item.quantity >= product.inventory) {
                    this.showNotification(`Only ${product.inventory} items available in stock`, 'error');
                    return;
                }
            }
            this.updateCartQuantity(item.id, item.quantity + 1);
        });

        removeBtn.addEventListener('click', () => {
            this.removeFromCart(item.id);
        });

        return cartItem;
    }

    toggleCart() {
        const cartSidebar = document.getElementById('cart-sidebar');
        const cartOverlay = document.getElementById('cart-overlay');

        if (cartSidebar && cartOverlay) {
            const isOpen = cartSidebar.classList.contains('open') || cartSidebar.classList.contains('show');

            if (isOpen) {
                this.closeCart();
            } else {
                if (typeof syncHmHeaderOffset === 'function') {
                    syncHmHeaderOffset();
                }
                // Set aria-hidden to false BEFORE showing and focusing
                cartSidebar.setAttribute('aria-hidden', 'false');
                cartSidebar.classList.add('show', 'open');
                cartOverlay.classList.add('active');
                document.body.classList.add('cart-open');
                document.body.style.overflow = 'hidden';
                const cartToggle = document.querySelector('.cart-toggle');
                if (cartToggle) cartToggle.setAttribute('aria-expanded', 'true');
                setTimeout(() => this.updateCartDisplay(), 50);
            }
        }
    }

    closeCart() {
        const cartSidebar = document.getElementById('cart-sidebar');
        const cartOverlay = document.getElementById('cart-overlay');
        const cartToggle = document.querySelector('.cart-toggle');

        if (cartSidebar && cartOverlay) {
            // Accessibility: Return focus to the toggle button BEFORE hiding the sidebar
            // and setting aria-hidden="true"
            const activeEl = document.activeElement;
            if (activeEl && cartSidebar.contains(activeEl)) {
                activeEl.blur();
                // Remove focus from any focused elements inside the cart
                const focusedElements = cartSidebar.querySelectorAll(':focus');
                focusedElements.forEach(el => el.blur());
            }

            if (cartToggle) {
                cartToggle.focus();
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

    saveCartToStorage() {
        try {
            localStorage.setItem('hmherbs_cart', JSON.stringify(this.cart));
        } catch (error) {
            console.error('Failed to save cart to localStorage:', error);
        }
    }

    loadCartFromStorage() {
        try {
            const savedCart = localStorage.getItem('hmherbs_cart');
            if (savedCart) {
                this.cart = JSON.parse(savedCart);
            }
        } catch (error) {
            console.error('Failed to load cart from localStorage:', error);
            this.cart = [];
        }
    }

    showNotification(message, type = 'info') {
        const container = document.getElementById('notification-container');
        if (!container) return;

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;

        // Create elements safely to prevent XSS
        const messageSpan = document.createElement('span');
        messageSpan.className = 'notification-message';
        messageSpan.textContent = message; // Use textContent instead of innerHTML

        const closeBtn = document.createElement('button');
        closeBtn.className = 'notification-close';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close notification');
        closeBtn.innerHTML =
            '<svg class="cart-close-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/></svg>';

        notification.appendChild(messageSpan);
        notification.appendChild(closeBtn);
        container.appendChild(notification);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);

        // Manual close
        closeBtn.addEventListener('click', () => {
            notification.remove();
        });
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    // Utility function for debouncing
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const context = this;
            const later = () => {
                clearTimeout(timeout);
                func.apply(context, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Helper method to add event listeners with tracking
    addEventListenerWithCleanup(element, event, handler, options = false) {
        if (element) {
            element.addEventListener(event, handler, options);
            this.eventListeners.push({ element, event, handler, options });
        }
    }

    // Cleanup method to remove all event listeners
    destroy() {
        this.eventListeners.forEach(({ element, event, handler, options }) => {
            element.removeEventListener(event, handler, options);
        });
        this.eventListeners = [];
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.productsPage = new ProductsPage();

    // Setup mobile menu toggle for products page
    setupProductsMobileMenu();
});

// Setup mobile menu toggle for products page navigation
// Note: This is a fallback - mobile-menu.js should handle this, but this ensures it works
function setupProductsMobileMenu() {
    // The mobile-menu.js should handle this, but we ensure it's set up
    // Just verify the menu toggle exists and is functional
    const navbarToggle = document.querySelector('.mobile-menu-toggle');
    const navbarMenu = document.getElementById('nav-menu') || document.getElementById('navbar-menu');

    if (navbarToggle && navbarMenu) {
        // Ensure body scroll is managed when menu opens/closes
        const observer = new MutationObserver(() => {
            if (navbarMenu.classList.contains('show')) {
                document.body.style.overflow = 'hidden';
            } else {
                document.body.style.overflow = '';
            }
        });

        observer.observe(navbarMenu, {
            attributes: true,
            attributeFilter: ['class']
        });

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            observer.disconnect();
            document.body.style.overflow = '';
        });
    }
}

// Exposed for products.html onclick="resetFilters()"
window.resetFilters = function resetFilters() {
    if (window.productsPage) {
        window.productsPage.resetFilters();
    }
};
