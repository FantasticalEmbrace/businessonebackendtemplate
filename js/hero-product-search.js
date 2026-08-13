/**
 * Homepage hero live product search — server-side API (scales to any catalog size).
 */
(function () {
    'use strict';

    const MAX_SUGGESTIONS = 8;
    const DEBOUNCE_MS = 300;

    class HeroProductSearch {
        constructor() {
            this.input = document.getElementById('hero-product-search');
            this.field = this.input ? this.input.closest('.hero-search-field') : null;
            this.form = document.querySelector('.hero-search-combo');
            this.hero = document.querySelector('.hero');
            this.eyebrow = document.getElementById('hero-catalog-eyebrow');
            this.list = null;
            this.highlightIndex = -1;
            this.isOpen = false;
            this.searchRequestId = 0;
            this.boundReposition = () => this.repositionDropdown();
            this.outsideClickHandler = null;
        }

        async init() {
            if (!this.input || !this.field || !this.form) return;

            this.buildListbox();
            this.bindFormEvents();
            this.bindInputEvents();
            await this.loadCatalogCount();
        }

        buildListbox() {
            this.list = document.createElement('div');
            this.list.id = 'hero-search-suggestions';
            this.list.className = 'hero-search-suggestions hero-search-suggestions--floating';
            this.list.setAttribute('role', 'listbox');
            this.list.setAttribute('aria-label', 'Product search suggestions');
            this.list.hidden = true;
            document.body.appendChild(this.list);

            this.input.setAttribute('aria-autocomplete', 'list');
            this.input.setAttribute('aria-controls', 'hero-search-suggestions');
            this.input.setAttribute('aria-expanded', 'false');
        }

        getApiBase() {
            return typeof window.hmGetStorefrontApiBase === 'function' ? window.hmGetStorefrontApiBase() : '';
        }

        productsApiUrl(queryString) {
            if (typeof window.hmBuildStorefrontApiUrl === 'function') {
                return window.hmBuildStorefrontApiUrl(`/api/products?${queryString}`);
            }
            const base = this.getApiBase();
            return `${base}/api/products?${queryString}`;
        }

        async loadCatalogCount() {
            if (!this.eyebrow || window.location.protocol === 'file:') return;

            try {
                const response = await fetch(this.productsApiUrl('limit=1'));
                if (!response.ok) return;
                const data = await response.json();
                const total = Number(data.pagination?.totalProducts);
                if (Number.isFinite(total) && total > 0) {
                    this.eyebrow.textContent = `${total.toLocaleString()} products online`;
                }
            } catch {
                /* keep default eyebrow */
            }
        }

        async fetchSearchResults(query) {
            const apiBaseUrl = this.getApiBase();
            const response = await fetch(
                this.productsApiUrl(
                    `search=${encodeURIComponent(query)}&limit=${MAX_SUGGESTIONS}`
                )
            );
            if (!response.ok) return { products: [], total: 0 };

            const data = await response.json();
            const transform =
                typeof window.hmTransformStorefrontProduct === 'function'
                    ? window.hmTransformStorefrontProduct
                    : (p) => p;

            return {
                products: (data.products || []).map((product) => transform(product, apiBaseUrl)),
                total: Number(data.pagination?.totalProducts) || (data.products || []).length
            };
        }

        bindFormEvents() {
            this.form.addEventListener('submit', (e) => {
                e.preventDefault();
                const query = this.input.value.trim();
                this.closeSuggestions();
                window.location.href = query
                    ? `products.html?search=${encodeURIComponent(query)}`
                    : 'products.html';
            });
        }

        bindInputEvents() {
            const onSearch = (raw) => {
                this.queueSearch(raw);
            };

            if (typeof window.hmBindSearchInput === 'function') {
                window.hmBindSearchInput(this.input, {
                    debounceMs: DEBOUNCE_MS,
                    onSearch
                });
            } else {
                let timer = null;
                this.input.addEventListener('input', () => {
                    clearTimeout(timer);
                    timer = setTimeout(() => onSearch(this.input.value), DEBOUNCE_MS);
                });
            }

            this.input.addEventListener('keydown', (e) => this.onKeyDown(e));
            this.input.addEventListener('focus', () => {
                if (this.input.value.trim()) {
                    this.queueSearch(this.input.value);
                }
            });

            this.outsideClickHandler = (e) => {
                if (
                    !this.field.contains(e.target) &&
                    !this.list.contains(e.target)
                ) {
                    this.closeSuggestions();
                }
            };
            document.addEventListener('click', this.outsideClickHandler, true);
            window.addEventListener('resize', this.boundReposition);
            window.addEventListener('scroll', this.boundReposition, true);
        }

        async queueSearch(rawQuery) {
            const query = String(rawQuery || '').trim();
            if (!query) {
                this.closeSuggestions();
                return;
            }

            const requestId = ++this.searchRequestId;
            try {
                const { products, total } = await this.fetchSearchResults(query);
                if (requestId !== this.searchRequestId) return;
                this.renderSuggestions(query, products, total);
            } catch {
                if (requestId !== this.searchRequestId) return;
                this.renderSuggestions(query, [], 0);
            }
        }

        onKeyDown(e) {
            const options = this.getOptions();
            if (!this.isOpen || options.length === 0) {
                if (e.key === 'Escape') this.closeSuggestions();
                return;
            }

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.highlightIndex = Math.min(this.highlightIndex + 1, options.length - 1);
                this.updateHighlight();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.highlightIndex = Math.max(this.highlightIndex - 1, 0);
                this.updateHighlight();
            } else if (e.key === 'Enter' && this.highlightIndex >= 0) {
                e.preventDefault();
                options[this.highlightIndex].click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.closeSuggestions();
            }
        }

        getOptions() {
            return this.list ? Array.from(this.list.querySelectorAll('[role="option"]')) : [];
        }

        updateHighlight() {
            const options = this.getOptions();
            options.forEach((el, i) => {
                el.classList.toggle('is-highlighted', i === this.highlightIndex);
                el.setAttribute('aria-selected', i === this.highlightIndex ? 'true' : 'false');
            });
            if (options[this.highlightIndex]) {
                options[this.highlightIndex].scrollIntoView({ block: 'nearest' });
            }
        }

        renderSuggestions(query, products, total) {
            this.list.textContent = '';
            this.highlightIndex = -1;

            if (total === 0) {
                const empty = document.createElement('p');
                empty.className = 'hero-search-suggestions-empty';
                empty.textContent = `No products found for “${query}”`;
                this.list.appendChild(empty);
                this.openSuggestions();
                return;
            }

            products.forEach((product) => {
                this.list.appendChild(this.createSuggestionItem(product));
            });

            if (total > products.length) {
                const viewAll = document.createElement('a');
                viewAll.className = 'hero-search-suggestion hero-search-suggestion-all';
                viewAll.setAttribute('role', 'option');
                viewAll.href = `products.html?search=${encodeURIComponent(query)}`;
                viewAll.textContent = `View all ${total.toLocaleString()} results for “${query}”`;
                viewAll.addEventListener('click', () => this.closeSuggestions());
                this.list.appendChild(viewAll);
            }

            this.openSuggestions();
        }

        createSuggestionItem(product) {
            const link = document.createElement('a');
            link.className = 'hero-search-suggestion';
            link.setAttribute('role', 'option');
            link.href = product.url || `products.html?search=${encodeURIComponent(product.name || '')}`;

            const img = document.createElement('img');
            img.className = 'hero-search-suggestion-img';
            img.alt = '';
            img.loading = 'lazy';
            img.width = 44;
            img.height = 44;
            const placeholder =
                typeof window.hmProductThumbPlaceholder === 'string'
                    ? window.hmProductThumbPlaceholder
                    : '';
            img.src = product.image || placeholder;
            img.onerror = () => {
                img.onerror = null;
                if (placeholder) img.src = placeholder;
            };

            const textWrap = document.createElement('span');
            textWrap.className = 'hero-search-suggestion-text';

            const name = document.createElement('span');
            name.className = 'hero-search-suggestion-name';
            name.textContent = product.name || 'Product';

            const meta = document.createElement('span');
            meta.className = 'hero-search-suggestion-meta';
            const price =
                typeof window.hmFormatProductPrice === 'function'
                    ? window.hmFormatProductPrice(product.price)
                    : `$${Number(product.price || 0).toFixed(2)}`;
            const brand = product.brandName || product.brand || '';
            meta.textContent = brand ? `${brand} · ${price}` : price;

            textWrap.appendChild(name);
            textWrap.appendChild(meta);
            link.appendChild(img);
            link.appendChild(textWrap);
            link.addEventListener('click', () => this.closeSuggestions());

            return link;
        }

        repositionDropdown() {
            if (!this.isOpen || !this.field || !this.list) return;

            const anchor = this.field;
            const rect = anchor.getBoundingClientRect();
            const borderColor = getComputedStyle(anchor).borderColor;
            this.list.style.top = `${Math.round(rect.bottom - 2)}px`;
            this.list.style.left = `${Math.round(rect.left)}px`;
            this.list.style.width = `${Math.round(rect.width)}px`;
            this.list.style.borderColor = borderColor;
        }

        openSuggestions() {
            this.list.hidden = false;
            this.isOpen = true;
            this.input.setAttribute('aria-expanded', 'true');
            this.field.classList.add('is-suggest-open');
            document.body.classList.add('hero-search-open');
            if (this.hero) this.hero.classList.add('is-search-open');
            this.repositionDropdown();
        }

        closeSuggestions() {
            if (!this.list) return;
            this.list.hidden = true;
            this.isOpen = false;
            this.highlightIndex = -1;
            this.input.setAttribute('aria-expanded', 'false');
            this.field.classList.remove('is-suggest-open');
            document.body.classList.remove('hero-search-open');
            if (this.hero) this.hero.classList.remove('is-search-open');
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        new HeroProductSearch().init();
    });
})();
