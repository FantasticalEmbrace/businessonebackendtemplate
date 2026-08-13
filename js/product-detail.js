/**
 * Product Detail Page JavaScript
 * Handles loading and displaying individual product information
 */

function hmHerbsBackendOrigin() {
    if (typeof window === 'undefined') return '';
    if (window.location.protocol === 'file:') {
        return 'http://localhost:3001';
    }
    const h = window.location.hostname;
    const isLoopback = h === 'localhost' || h === '127.0.0.1';
    if (isLoopback && window.location.port !== '3001') {
        return 'http://localhost:3001';
    }
    return '';
}

function resolveHmHerbsMediaUrl(url, backendOrigin) {
    if (!url || typeof url !== 'string') return url;
    const t = url.trim();
    if (!t) return t;
    if (t.startsWith('http') || t.startsWith('//') || t.startsWith('data:')) return t;
    const path = t.startsWith('/') ? t : `/${t}`;
    if (!backendOrigin) return path;
    return `${backendOrigin}${path}`;
}

class ProductDetailPage {
    constructor() {
        this.product = null;
        this.selectedVariant = null;
        this.quantity = 1;
        this.backendOrigin = hmHerbsBackendOrigin();
        this.apiBaseUrl = `${this.backendOrigin}/api`;
        this.imageZoom = null;

        this.init();
    }

    resolveProductImageUrl(url) {
        return resolveHmHerbsMediaUrl(url, this.backendOrigin);
    }

    async init() {
        try {
            // Slug from query/path/hash, or legacy ?id=123 (wishlist / old links)
            const urlParams = new URLSearchParams(window.location.search);
            let slug = this.getProductSlugFromUrl();
            if (!slug) {
                const idParam = (urlParams.get('id') || '').trim();
                if (/^\d+$/.test(idParam)) {
                    slug = idParam;
                }
            }
            if (!slug) {
                this.showError('Invalid product URL');
                return;
            }

            // Load product data
            await this.loadProduct(slug);

            // Setup event listeners
            this.setupEventListeners();

            // Load cart count
            this.updateCartDisplay();
        } catch (error) {
            console.error('Failed to initialize Product Detail Page:', error);
            this.showError('Failed to load product. Please try again.');
        }
    }

    getProductSlugFromUrl() {
        // Get slug from URL path or query parameter
        const path = window.location.pathname;
        const urlParams = new URLSearchParams(window.location.search);

        // Try query parameter first
        if (urlParams.has('slug')) {
            return urlParams.get('slug');
        }

        // Try pathname (e.g., /product.html?slug=product-name or /product/product-name)
        const pathMatch = path.match(/\/product[s]?\/([^\/]+)/);
        if (pathMatch) {
            return pathMatch[1];
        }

        // Try hash
        const hash = window.location.hash.replace('#', '');
        if (hash) {
            return hash;
        }

        return null;
    }

    async loadProduct(slug) {
        try {
            // Backend serves both frontend and API on the same port (3001)
            // Use relative path which works when on same origin
            const response = await fetch(`${this.apiBaseUrl}/products/${slug}`);

            if (!response.ok) {
                if (response.status === 404) {
                    this.showError('Product not found');
                } else {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return;
            }

            this.product = await response.json();
            this.renderProduct();
        } catch (error) {
            console.error('Error loading product:', error);

            // Check if it's a connection refused error (backend not running)
            if (error.message.includes('Failed to fetch') || error.message.includes('ERR_CONNECTION_REFUSED')) {
                this.showError('Unable to connect to server. Please make sure the backend server is running on port 3001.');
            } else {
                this.showError('Failed to load product. Please try again.');
            }
        }
    }

    renderProduct() {
        if (!this.product) return;

        // Hide loading, show content
        document.getElementById('product-loading').style.display = 'none';
        document.getElementById('product-content').style.display = 'block';

        const metaTitle =
            (this.product.meta_title && String(this.product.meta_title).trim()) ||
            `${this.product.name} - H&M Herbs & Vitamins`;
        const metaDescription =
            (this.product.meta_description && String(this.product.meta_description).trim()) ||
            (this.product.short_description && String(this.product.short_description).trim()) ||
            `Shop ${this.product.name} at H&M Herbs & Vitamins.`;

        document.title = metaTitle;

        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
            metaDesc.setAttribute('content', metaDescription);
        }

        const slug = this.product.slug || new URLSearchParams(window.location.search).get('slug');
        if (slug) {
            const canonicalHref = `${window.location.origin}${window.location.pathname}?slug=${encodeURIComponent(slug)}`;
            let canonical = document.querySelector('link[rel="canonical"]');
            if (!canonical) {
                canonical = document.createElement('link');
                canonical.setAttribute('rel', 'canonical');
                document.head.appendChild(canonical);
            }
            canonical.setAttribute('href', canonicalHref);
        }

        // Breadcrumb
        const breadcrumbProduct = document.getElementById('breadcrumb-product');
        if (breadcrumbProduct) {
            breadcrumbProduct.textContent = this.product.name;
        }

        // Product Title
        const titleEl = document.getElementById('product-title');
        if (titleEl) {
            titleEl.textContent = this.product.name;
        }

        // SKU
        const skuValueEl = document.getElementById('product-sku-value');
        if (skuValueEl && this.product.sku) {
            skuValueEl.textContent = this.product.sku;
        } else {
            document.getElementById('product-sku').style.display = 'none';
        }

        // Price
        const priceEl = document.getElementById('product-price');
        if (priceEl) {
            const price = this.selectedVariant?.price || this.product.price || 0;
            priceEl.textContent = this.formatPrice(price);
        }

        // Compare Price
        const comparePriceEl = document.getElementById('product-compare-price');
        if (comparePriceEl) {
            const comparePrice = this.selectedVariant?.compare_price || this.product.compare_price;
            if (comparePrice && comparePrice > (this.selectedVariant?.price || this.product.price)) {
                comparePriceEl.textContent = this.formatPrice(comparePrice);
                comparePriceEl.style.display = 'block';
            } else {
                comparePriceEl.style.display = 'none';
            }
        }

        // Short Description
        const shortDescEl = document.getElementById('product-short-description');
        if (shortDescEl) {
            if (this.product.short_description && this.product.short_description.trim()) {
                // Use the short_description field
                shortDescEl.innerHTML = `<p>${this.escapeHtml(this.product.short_description.trim())}</p>`;
                shortDescEl.style.display = 'block';
            } else if (this.product.description && this.product.description.trim()) {
                // Fallback: Use first paragraph or first 200 characters of description
                const description = this.product.description.trim();
                const firstPara = description.split('\n')[0].trim();
                const shortText = firstPara.length > 0 && firstPara.length <= 300
                    ? firstPara
                    : description.substring(0, 200).trim();
                shortDescEl.innerHTML = `<p>${this.escapeHtml(shortText)}${description.length > 200 && firstPara.length > 300 ? '...' : ''}</p>`;
                shortDescEl.style.display = 'block';
            } else {
                // Hide if no description available
                shortDescEl.style.display = 'none';
            }
        }

        // Full Description — render HTML from source site (never show raw tags as text)
        const descEl = document.getElementById('product-description');
        if (descEl) {
            const fmt = typeof HMDescriptionHtml !== 'undefined' ? HMDescriptionHtml : null;
            if (this.product.description && this.product.description.trim()) {
                descEl.innerHTML = fmt
                    ? fmt.formatLongDescriptionForDisplay(this.product.description)
                    : this.escapeHtml(this.product.description);
            } else {
                descEl.innerHTML = '<p>No description available.</p>';
            }
        }

        // Images after variants so the first selected option drives the hero photo + thumbnails.
        this.renderVariants();
        this.renderImages();
        if (this.selectedVariant) {
            this.updateVariantImage();
        }

        // Brand
        const brandRow = document.getElementById('product-brand');
        const brandVal = document.getElementById('product-brand-value');
        if (this.product.brand_name && brandRow && brandVal) {
            brandVal.textContent = this.product.brand_name;
            brandRow.style.display = 'flex';
        }

        // Category
        const catRow = document.getElementById('product-category');
        const catVal = document.getElementById('product-category-value');
        if (this.product.category_name && catRow && catVal) {
            catVal.textContent = this.product.category_name;
            catRow.style.display = 'flex';
        }

        this.renderCoaSection();

        // Stock Status
        this.updateStockStatus();
    }

    resolveCoaUrl(url) {
        if (!url || typeof url !== 'string') return '#';
        const u = url.trim();
        if (/^https?:\/\//i.test(u)) return u;
        const path = u.startsWith('/') ? u : `/${u}`;
        return path
            .split('/')
            .map((segment, index) => (index === 0 || !segment ? segment : encodeURIComponent(segment)))
            .join('/');
    }

    renderCoaSection() {
        const section = document.getElementById('product-coa-section');
        if (!section) return;

        const isCannabis = this.product.is_cannabis === true ||
            this.product.is_cannabis === 1 ||
            this.product.is_cannabis === '1' ||
            this.product.is_cannabis === 'true';

        if (!isCannabis) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';

        const link = document.getElementById('product-coa-link');
        const missing = document.getElementById('product-coa-missing');
        const dateEl = document.getElementById('product-coa-date');
        const url = (this.product.coa_url || '').trim();

        if (link && missing) {
            if (url) {
                link.href = this.resolveCoaUrl(url);
                link.style.display = 'inline-flex';
                missing.style.display = 'none';
            } else {
                link.style.display = 'none';
                missing.style.display = 'block';
            }
        }

        if (dateEl) {
            const raw = this.product.coa_updated_at;
            if (raw) {
                const ymd = typeof raw === 'string' ? raw.slice(0, 10) : '';
                dateEl.textContent = /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `COA as of: ${ymd}` : '';
            } else {
                dateEl.textContent = '';
            }
        }
    }

    renderImages() {
        const images = this.getDisplayImages();
        const gallery = document.getElementById('product-image-gallery');
        const mainImage = document.getElementById('product-main-image');

        if (images.length === 0) {
            if (mainImage) {
                mainImage.src = this.createPlaceholderImage();
                mainImage.alt = this.product.name || 'Product image';
            }
            if (gallery) {
                gallery.innerHTML = '';
                gallery.style.display = 'none';
                gallery.hidden = true;
            }
            return;
        }

        const preferredUrl = this.getVariantImageUrl(this.selectedVariant);
        let activeIndex = images.findIndex((img) => String(img.image_url) === String(preferredUrl));
        if (activeIndex < 0) {
            activeIndex = images.findIndex((img) => img.is_primary);
        }
        if (activeIndex < 0) activeIndex = 0;

        const activeImage = images[activeIndex];
        if (mainImage && activeImage) {
            mainImage.removeAttribute('data-skip-error-handling');
            mainImage.src = this.resolveProductImageUrl(activeImage.image_url);
            mainImage.alt = activeImage.alt_text || this.product.name || 'Product image';

            if (window.visualBugFixer && window.visualBugFixer.processedImages && !window.visualBugFixer.processedImages.has(mainImage)) {
                window.visualBugFixer.handleNewImage(mainImage);
            }
            if (this.imageZoom?.refresh) {
                if (mainImage.complete) this.imageZoom.refresh();
                else mainImage.addEventListener('load', () => this.imageZoom?.refresh(), { once: true });
            }
        }

        if (!gallery) return;

        if (images.length > 1) {
            gallery.hidden = false;
            gallery.style.display = 'flex';
            gallery.innerHTML = images.map((img, index) => `
                <button type="button" class="gallery-thumbnail ${index === activeIndex ? 'active' : ''}" 
                        data-image-index="${index}" 
                        aria-label="View image ${index + 1}"
                        aria-current="${index === activeIndex ? 'true' : 'false'}">
                    <img src="${this.resolveProductImageUrl(img.image_url)}" 
                         alt="${this.escapeHtml(img.alt_text || '')}" 
                         loading="lazy">
                </button>
            `).join('');

            gallery.querySelectorAll('.gallery-thumbnail').forEach((thumb) => {
                thumb.addEventListener('click', () => {
                    const index = parseInt(thumb.dataset.imageIndex, 10);
                    if (!Number.isFinite(index) || !images[index]) return;
                    this.switchMainImage(images[index]);
                    gallery.querySelectorAll('.gallery-thumbnail').forEach((t) => {
                        const isActive = t === thumb;
                        t.classList.toggle('active', isActive);
                        t.setAttribute('aria-current', isActive ? 'true' : 'false');
                    });
                });
                thumb.addEventListener('dblclick', (e) => {
                    e.preventDefault();
                    const index = parseInt(thumb.dataset.imageIndex, 10);
                    if (!Number.isFinite(index)) return;
                    this.ensureImageZoom().open(index);
                });
            });
        } else {
            gallery.innerHTML = '';
            gallery.style.display = 'none';
            gallery.hidden = true;
        }

        this.ensureImageZoom().bindMainImage(mainImage);
    }

    getActiveImageIndex() {
        const images = this.getDisplayImages();
        if (!images.length) return 0;
        const mainImage = document.getElementById('product-main-image');
        const currentUrl = mainImage?.src || '';
        const activeIndex = images.findIndex((img) => {
            const resolved = this.resolveProductImageUrl(img.image_url);
            return resolved === currentUrl || String(img.image_url) === String(currentUrl);
        });
        if (activeIndex >= 0) return activeIndex;
        const preferredUrl = this.getVariantImageUrl(this.selectedVariant);
        const variantIndex = images.findIndex((img) => String(img.image_url) === String(preferredUrl));
        return variantIndex >= 0 ? variantIndex : 0;
    }

    ensureImageZoom() {
        if (!this.imageZoom && typeof window.HMProductImageZoom === 'function') {
            this.imageZoom = new window.HMProductImageZoom({
                getImages: () => this.getDisplayImages(),
                resolveUrl: (url) => this.resolveProductImageUrl(url),
                getActiveIndex: () => this.getActiveImageIndex(),
            });
        }
        return this.imageZoom;
    }

    switchMainImage(image) {
        const mainImage = document.getElementById('product-main-image');
        if (mainImage && image) {
            mainImage.src = this.resolveProductImageUrl(image.image_url);
            mainImage.alt = image.alt_text || this.product.name || 'Product image';
        }
    }

    getDisplayImages() {
        const baseImages = (this.product.images || []).map((img) => ({
            image_url: img.image_url,
            alt_text: img.alt_text || this.product.name,
            is_primary: img.is_primary,
        }));
        const variantImages = (this.product.variants || [])
            .filter((v) => v.image_url)
            .map((v) => ({
                image_url: v.image_url,
                alt_text: v.name || this.product.name,
                is_primary: false,
                variant_id: v.id,
            }));

        const seen = new Set();
        const merged = [];
        for (const img of [...variantImages, ...baseImages]) {
            const key = String(img.image_url || '').trim();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push(img);
        }
        return merged;
    }

    getVariantImageUrl(variant) {
        if (!variant) {
            return this.product.images?.[0]?.image_url || '';
        }
        if (variant.image_url) return variant.image_url;
        const galleryMatch = (this.product.images || []).find((img) => {
            const url = String(img.image_url || '').toUpperCase();
            const sku = String(variant.sku || '').toUpperCase();
            if (sku && url.includes(sku)) return true;
            const hint = String(variant.name || '').match(/#([A-Za-z0-9-]+)/);
            return hint && url.includes(hint[1].toUpperCase());
        });
        return galleryMatch?.image_url || this.product.images?.[0]?.image_url || '';
    }

    updateVariantImage() {
        const url = this.getVariantImageUrl(this.selectedVariant);
        if (!url) return;
        this.switchMainImage({
            image_url: url,
            alt_text: this.selectedVariant?.name || this.product.name,
        });

        const gallery = document.getElementById('product-image-gallery');
        if (!gallery || gallery.hidden) return;
        const images = this.getDisplayImages();
        const activeIndex = images.findIndex((img) => String(img.image_url) === String(url));
        gallery.querySelectorAll('.gallery-thumbnail').forEach((thumb, idx) => {
            const isActive = activeIndex >= 0 && idx === activeIndex;
            thumb.classList.toggle('active', isActive);
            thumb.setAttribute('aria-current', isActive ? 'true' : 'false');
        });
        if (activeIndex >= 0) {
            const activeThumb = gallery.querySelector(`[data-image-index="${activeIndex}"]`);
            if (activeThumb && typeof activeThumb.scrollIntoView === 'function') {
                activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            }
        }
    }

    renderVariants() {
        const variants = (this.product.variants || []).map((v) => ({
            ...v,
            attributes: this.parseJsonField(v.attributes),
        }));
        const container = document.getElementById('product-variants');
        const selectorsEl = document.getElementById('variant-selectors');

        if (!container || !selectorsEl || variants.length === 0) {
            if (container) container.style.display = 'none';
            return;
        }

        const groups = this.parseOptionGroups(this.product.variant_option_groups);
        const matrixKeys = this.getMatrixDimensionKeys(variants, groups);
        selectorsEl.innerHTML = '';
        this._variantSelectMode = null;
        this._matrixSelections = {};

        if (matrixKeys.length > 1 && this.variantsSupportMatrix(variants, matrixKeys)) {
            this._variantSelectMode = 'matrix';
            matrixKeys.forEach((key) => {
                const values = this.getUniqueAttributeValues(variants, key, groups);
                if (!values.length) return;

                const groupWrap = document.createElement('div');
                groupWrap.className = 'variant-option-group';

                const label = document.createElement('label');
                label.className = 'variant-label variant-group-label';
                label.textContent = key.toUpperCase();
                label.setAttribute('for', `variant-matrix-${key}`);

                const select = document.createElement('select');
                select.id = `variant-matrix-${key}`;
                select.className = 'variant-select';
                select.dataset.matrixKey = key;
                select.innerHTML = values.map((val) => `<option value="${this.escapeAttr(val)}">${this.escapeHtml(val)}</option>`).join('');

                this._matrixSelections[key] = values[0];
                select.addEventListener('change', (e) => {
                    this._matrixSelections[key] = e.target.value;
                    this.applyMatrixSelection(variants, matrixKeys);
                });

                groupWrap.appendChild(label);
                groupWrap.appendChild(select);
                selectorsEl.appendChild(groupWrap);
            });

            this.applyMatrixSelection(variants, matrixKeys);
        } else {
            this._variantSelectMode = 'single';
            const groupName = groups[0]?.name || 'Select Option';
            const groupWrap = document.createElement('div');
            groupWrap.className = 'variant-option-group';

            const label = document.createElement('label');
            label.className = 'variant-label variant-group-label';
            label.textContent = groupName.toUpperCase();
            label.setAttribute('for', 'variant-select');

            const select = document.createElement('select');
            select.id = 'variant-select';
            select.className = 'variant-select';
            select.innerHTML = variants.map((variant) => {
                const labelText = this.formatVariantOptionLabel(variant);
                return `<option value="${variant.id}" data-price="${variant.price}" data-compare-price="${variant.compare_price || ''}">${this.escapeHtml(labelText)}</option>`;
            }).join('');

            select.addEventListener('change', (e) => {
                const variant = variants.find((v) => String(v.id) === String(e.target.value));
                if (variant) {
                    this.selectedVariant = variant;
                    this.updatePrice();
                    this.updateStockStatus();
                    this.updateVariantImage();
                }
            });

            groupWrap.appendChild(label);
            groupWrap.appendChild(select);
            selectorsEl.appendChild(groupWrap);

            this.selectedVariant = variants[0];
            this.updatePrice();
            this.updateStockStatus();
        }

        container.style.display = 'flex';
    }

    parseJsonField(value) {
        if (value == null || value === '') return null;
        if (typeof value === 'object') return value;
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }

    parseOptionGroups(raw) {
        const parsed = this.parseJsonField(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((g) => g && g.name && Array.isArray(g.values) && g.values.length);
    }

    getMatrixDimensionKeys(variants, groups) {
        if (groups.length > 1) {
            return groups.map((g) => g.name);
        }

        const keys = new Set();
        variants.forEach((v) => {
            if (v.attributes && typeof v.attributes === 'object') {
                Object.keys(v.attributes).forEach((k) => keys.add(k));
            }
        });

        const keyList = [...keys];
        const structural = keyList.filter((k) => {
            const vals = new Set(variants.map((v) => v.attributes?.[k]).filter(Boolean));
            return vals.size > 1;
        });

        return structural.length > 1 ? structural : [];
    }

    getUniqueAttributeValues(variants, key, groups) {
        const vals = new Set();
        const fromGroup = groups.find((g) => g.name === key);
        if (fromGroup && fromGroup.values.length) {
            fromGroup.values.forEach((value) => vals.add(String(value)));
        }
        variants.forEach((v) => {
            const val = v.attributes?.[key];
            if (val) vals.add(String(val));
        });
        return [...vals];
    }

    variantsSupportMatrix(variants, matrixKeys) {
        if (!matrixKeys.length || !variants.length) return false;
        return variants.every((variant) =>
            matrixKeys.every((key) => {
                const val = variant.attributes?.[key];
                return val != null && String(val).trim() !== '';
            })
        );
    }

    applyMatrixSelection(variants, matrixKeys) {
        const match = variants.find((v) => {
            if (!v.attributes) return false;
            return matrixKeys.every((key) => {
                const selected = this._matrixSelections[key];
                return selected == null || String(v.attributes[key]) === String(selected);
            });
        });

        if (match) {
            this.selectedVariant = match;
            this.updatePrice();
            this.updateStockStatus();
            this.updateVariantImage();
        }
    }

    formatVariantOptionLabel(variant) {
        const name = variant.name || '';
        if (/\$\s*[\d,.]+\s*$/.test(name)) return name;
        return `${name} - ${this.formatPrice(variant.price)}`;
    }

    escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    escapeAttr(str) {
        return String(str || '').replace(/"/g, '&quot;');
    }

    updateStockStatus() {
        const stockEl = document.getElementById('product-stock');
        if (!stockEl) return;

        const tracked = this.product.track_inventory !== false && this.product.track_inventory !== 0;
        const variant = this.selectedVariant;
        const inventory = variant?.inventory_quantity ?? this.product.inventory_quantity ?? 0;
        const canPurchase = variant?.can_purchase ?? this.product.can_purchase;
        const isLow = variant?.is_low_stock ?? this.product.is_low_stock;
        const threshold = Number(this.product.low_stock_threshold) || 5;
        const inStock = !tracked || inventory > 0;
        const purchasable = canPurchase !== false && (tracked ? inventory > 0 || canPurchase === true : true);

        const addToCartBtn = document.getElementById('add-to-cart-btn');
        const wlBtn = document.getElementById('add-to-wishlist-btn');

        if (!tracked) {
            stockEl.innerHTML = `
                <span class="stock-status in-stock">
                    <i class="fas fa-check-circle" aria-hidden="true"></i>
                    In Stock
                </span>
            `;
            if (addToCartBtn) {
                addToCartBtn.disabled = false;
                addToCartBtn.classList.remove('disabled');
            }
            if (wlBtn) {
                wlBtn.disabled = false;
                wlBtn.classList.remove('disabled');
            }
            return;
        }

        if (!inStock || !purchasable) {
            stockEl.innerHTML = `
                <span class="stock-status out-of-stock">
                    <i class="fas fa-times-circle" aria-hidden="true"></i>
                    Out of Stock
                </span>
            `;
            if (addToCartBtn) {
                addToCartBtn.disabled = true;
                addToCartBtn.classList.add('disabled');
            }
            if (wlBtn) {
                wlBtn.disabled = true;
                wlBtn.classList.add('disabled');
            }
            return;
        }

        if (isLow || inventory <= threshold) {
            stockEl.innerHTML = `
                <span class="stock-status low-stock">
                    <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
                    Only ${inventory} left in stock
                </span>
            `;
        } else {
            stockEl.innerHTML = `
                <span class="stock-status in-stock">
                    <i class="fas fa-check-circle" aria-hidden="true"></i>
                    In Stock (${inventory} available)
                </span>
            `;
        }

        if (addToCartBtn) {
            addToCartBtn.disabled = false;
            addToCartBtn.classList.remove('disabled');
        }
        if (wlBtn) {
            wlBtn.disabled = false;
            wlBtn.classList.remove('disabled');
        }
    }

    setupEventListeners() {
        // Quantity controls
        const decreaseBtn = document.getElementById('quantity-decrease');
        const increaseBtn = document.getElementById('quantity-increase');
        const quantityInput = document.getElementById('product-quantity');

        if (decreaseBtn) {
            decreaseBtn.addEventListener('click', () => {
                const current = parseInt(quantityInput.value) || 1;
                if (current > 1) {
                    quantityInput.value = current - 1;
                    this.quantity = current - 1;
                }
            });
        }

        if (increaseBtn) {
            increaseBtn.addEventListener('click', () => {
                const current = parseInt(quantityInput.value) || 1;
                quantityInput.value = current + 1;
                this.quantity = current + 1;
            });
        }

        if (quantityInput) {
            quantityInput.addEventListener('change', (e) => {
                const value = parseInt(e.target.value) || 1;
                if (value < 1) {
                    e.target.value = 1;
                    this.quantity = 1;
                } else {
                    this.quantity = value;
                }
            });
        }

        // Variant selection is bound in renderVariants() (single dropdown or matrix)
        const addToCartBtn = document.getElementById('add-to-cart-btn');
        if (addToCartBtn) {
            addToCartBtn.addEventListener('click', () => {
                this.addToCart();
            });
        }

        const wishlistBtn = document.getElementById('add-to-wishlist-btn');
        if (wishlistBtn) {
            wishlistBtn.addEventListener('click', () => {
                this.addToWishlist();
            });
        }
    }

    updatePrice() {
        if (!this.product) return;

        const price = this.selectedVariant?.price || this.product.price || 0;
        const priceEl = document.getElementById('product-price');
        if (priceEl) {
            priceEl.textContent = this.formatPrice(price);
        }

        const comparePrice = this.selectedVariant?.compare_price || this.product.compare_price;
        const comparePriceEl = document.getElementById('product-compare-price');
        if (comparePriceEl) {
            if (comparePrice && comparePrice > price) {
                comparePriceEl.textContent = this.formatPrice(comparePrice);
                comparePriceEl.style.display = 'block';
            } else {
                comparePriceEl.style.display = 'none';
            }
        }
    }

    async addToCart() {
        if (!this.product) {
            console.error('Product detail: Cannot add to cart - product not loaded');
            return;
        }
        if (this._addToCartInFlight) return;
        this._addToCartInFlight = true;

        try {
            const inventory = this.selectedVariant?.inventory_quantity ?? this.product.inventory_quantity ?? undefined;
            const canPurchase = this.selectedVariant?.can_purchase ?? this.product.can_purchase;
            const cartItem = {
                id: this.product.id,
                product_id: this.product.id,
                variant_id: this.selectedVariant?.id || null,
                variant_name: this.selectedVariant?.name || null,
                name: this.product.name,
                price: this.selectedVariant?.price || this.product.price,
                quantity: this.quantity,
                image: this.resolveProductImageUrl(this.getVariantImageUrl(this.selectedVariant)),
                inventory_quantity: inventory,
                inventory: inventory,
                trackInventory: this.product.track_inventory !== false && this.product.track_inventory !== 0,
                inStock: inventory !== undefined ? inventory > 0 : this.product.in_stock !== false,
                can_purchase: canPurchase,
                canPurchase: canPurchase
            };

            const app = await this.waitForCartApp(1500);
            if (app?.addProductToCart) {
                app.addProductToCart(cartItem, this.quantity);
                setTimeout(() => this.updateCartDisplay(), 50);
                return;
            }

            let cart = JSON.parse(localStorage.getItem('hmherbs_cart') || '[]');
            const existingIndex = cart.findIndex(item => {
                const itemId = item.id || item.product_id;
                const cartItemId = cartItem.id || cartItem.product_id;
                return String(itemId) === String(cartItemId) &&
                    (item.variant_id || null) === (cartItem.variant_id || null);
            });

            if (existingIndex >= 0) {
                cart[existingIndex].quantity += cartItem.quantity;
            } else {
                cart.push({
                    id: cartItem.id || cartItem.product_id,
                    product_id: cartItem.product_id,
                    variant_id: cartItem.variant_id || null,
                    variant_name: cartItem.variant_name || null,
                    name: cartItem.variant_name
                        ? `${cartItem.name} — ${cartItem.variant_name}`
                        : cartItem.name,
                    price: cartItem.price,
                    image: cartItem.image,
                    quantity: cartItem.quantity,
                    inventory_quantity: cartItem.inventory_quantity,
                });
            }

            localStorage.setItem('hmherbs_cart', JSON.stringify(cart));
            this.updateCartDisplay();
            this.showNotification('Added to cart', 'success');

            setTimeout(() => {
                if (window.hmHerbsApp?.loadCartFromStorage) {
                    window.hmHerbsApp.loadCartFromStorage();
                    window.hmHerbsApp.updateCartDisplay();
                }
            }, 300);
        } catch (error) {
            console.error('Error adding to cart:', error);
            this.showNotification('Failed to add product to cart', 'error');
        } finally {
            this._addToCartInFlight = false;
        }
    }

    waitForCartApp(maxMs = 1500) {
        return new Promise((resolve) => {
            const started = Date.now();
            const tick = () => {
                const app = window.hmHerbsApp;
                if (app && (app.addProductToCart || app.addToCart)) {
                    resolve(app);
                    return;
                }
                if (Date.now() - started >= maxMs) {
                    resolve(null);
                    return;
                }
                setTimeout(tick, 50);
            };
            tick();
        });
    }

    async addToWishlist() {
        if (!this.product?.id) {
            this.showNotification('Product is still loading. Try again in a moment.', 'error');
            return;
        }
        const btn = document.getElementById('add-to-wishlist-btn');
        const icon = document.getElementById('add-to-wishlist-icon');
        if (btn && btn.dataset.loading === '1') return;
        if (btn) {
            btn.dataset.loading = '1';
            btn.disabled = true;
        }
        try {
            const fn = window.hmHerbsPickWishlistAndAddProduct;
            if (typeof fn !== 'function') {
                this.showNotification('Wishlist helper not loaded. Refresh the page.', 'error');
                return;
            }
            const r = await fn(this.product.id, this.product.name);
            if (r && r.ok && icon) {
                icon.classList.remove('far');
                icon.classList.add('fas');
            }
        } catch (e) {
            console.error(e);
            this.showNotification('Could not add to list', 'error');
        } finally {
            if (btn) {
                delete btn.dataset.loading;
                btn.disabled = false;
            }
        }
    }

    updateCartDisplay() {
        // Try to use main app's cart display if available, otherwise use localStorage
        if (window.hmHerbsApp && window.hmHerbsApp.updateCartDisplay) {
            // Sync localStorage with main app's cart
            try {
                const localStorageCart = JSON.parse(localStorage.getItem('hmherbs_cart') || '[]');
                // If main app cart is empty but localStorage has items, load them
                if (window.hmHerbsApp.cart.length === 0 && localStorageCart.length > 0) {
                    window.hmHerbsApp.cart = localStorageCart.map(item => ({
                        id: item.id || item.product_id,
                        name: item.name,
                        price: item.price,
                        image: item.image,
                        quantity: item.quantity || 1
                    }));
                }
            } catch (error) {
                console.error('Error syncing cart:', error);
            }
            // Use main app's updateCartDisplay which handles full cart display
            window.hmHerbsApp.updateCartDisplay();
        } else {
            // Fallback: Update cart count from localStorage
            try {
                let cart = JSON.parse(localStorage.getItem('hmherbs_cart') || '[]');
                const totalItems = cart.reduce((sum, item) => sum + (item.quantity || 0), 0);
                const cartCount = document.getElementById('cart-count');
                if (cartCount) {
                    cartCount.textContent = totalItems;
                    cartCount.style.display = totalItems > 0 ? 'block' : 'none';
                }
            } catch (error) {
                console.error('Error updating cart display:', error);
            }
        }
    }

    showError(message) {
        document.getElementById('product-loading').style.display = 'none';
        document.getElementById('product-content').style.display = 'none';
        const errorEl = document.getElementById('product-error');
        if (errorEl) {
            errorEl.style.display = 'block';
            const errorMsg = errorEl.querySelector('p');
            if (errorMsg) {
                errorMsg.textContent = message;
            }
        }
    }

    showNotification(message, type = 'success') {
        if (typeof window.hmShowToast === 'function') {
            window.hmShowToast(message, type);
            return;
        }
        console.info('[Product detail]', type, message);
    }

    formatPrice(price) {
        if (!price && price !== 0) return '$0.00';
        return `$${parseFloat(price).toFixed(2)}`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    createPlaceholderImage() {
        // Create an SVG placeholder image as data URI
        const svgContent = `
            <svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#4a7c59;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#5a8c69;stop-opacity:1" />
                    </linearGradient>
                </defs>
                <rect width="400" height="400" fill="url(#grad)"/>
                <circle cx="200" cy="150" r="40" fill="rgba(255,255,255,0.3)"/>
                <rect x="160" y="200" width="80" height="60" rx="5" fill="rgba(255,255,255,0.2)"/>
                <text x="200" y="290" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="white" text-anchor="middle">Product Image</text>
                <text x="200" y="315" font-family="Arial, sans-serif" font-size="14" fill="rgba(255,255,255,0.9)" text-anchor="middle">Unavailable</text>
            </svg>
        `.trim();
        return `data:image/svg+xml;base64,${btoa(svgContent)}`;
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.productDetailPage = new ProductDetailPage();
    });
} else {
    window.productDetailPage = new ProductDetailPage();
}

