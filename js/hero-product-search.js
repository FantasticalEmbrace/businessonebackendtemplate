/**
 * Homepage hero search — same product matching/API as the products page,
 * with a live suggestion dropdown (only visual + presentation difference).
 */
(function () {
    'use strict';

    class HeroProductSearch {
        constructor() {
            this.input = document.getElementById('hero-product-search');
            this.field = this.input ? this.input.closest('.hero-search-field') : null;
            this.form = document.querySelector('.hero-search-combo');
            this.eyebrow = document.getElementById('hero-catalog-eyebrow');
            this.typeahead = null;
        }

        async init() {
            if (!this.input || !this.form) return;

            const Typeahead =
                typeof window.BoStorefrontSearchTypeahead === 'function'
                    ? window.BoStorefrontSearchTypeahead
                    : typeof window.HmStorefrontSearchTypeahead === 'function'
                      ? window.HmStorefrontSearchTypeahead
                      : null;

            if (Typeahead) {
                this.typeahead = new Typeahead({
                    input: this.input,
                    field: this.field,
                    form: this.form,
                    listId: 'hero-search-suggestions',
                    listClass: 'hero-search-suggestions hero-search-suggestions--floating',
                    onSubmitAll: (query) => this.goToProductsSearch(query)
                }).init();
            } else {
                // Fallback if typeahead script failed to load
                this.form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.goToProductsSearch(this.input.value);
                });
            }

            await this.loadCatalogCount();
        }

        goToProductsSearch(rawQuery) {
            const query = String(rawQuery || '').trim();
            window.location.href = query
                ? `products?search=${encodeURIComponent(query)}`
                : 'products';
        }

        productsApiUrl(queryString) {
            if (typeof window.hmBuildStorefrontApiUrl === 'function') {
                return window.hmBuildStorefrontApiUrl(`/api/products?${queryString}`);
            }
            const base =
                typeof window.hmGetStorefrontApiBase === 'function' ? window.hmGetStorefrontApiBase() : '';
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
    }

    document.addEventListener('DOMContentLoaded', () => {
        new HeroProductSearch().init();
    });
})();
