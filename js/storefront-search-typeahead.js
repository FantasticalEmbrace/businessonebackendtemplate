/**
 * Shared storefront product typeahead (homepage dropdown).
 * Uses the same /api/products?search= path and keyword rules as the products page.
 */
(function (global) {
    'use strict';

    const MAX_SUGGESTIONS = 8;
    const DEBOUNCE_MS = 280;
    const MIN_CHARS = 2;

    function productsApiUrl(queryString) {
        if (typeof global.hmBuildStorefrontApiUrl === 'function') {
            return global.hmBuildStorefrontApiUrl(`/api/products?${queryString}`);
        }
        const base =
            typeof global.hmGetStorefrontApiBase === 'function' ? global.hmGetStorefrontApiBase() : '';
        return `${base}/api/products?${queryString}`;
    }

    function escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function dedupeById(products) {
        const seen = new Set();
        const out = [];
        for (const p of products || []) {
            const id = Number(p.id);
            if (!Number.isFinite(id) || seen.has(id)) continue;
            seen.add(id);
            out.push(p);
        }
        return out;
    }

    class HmStorefrontSearchTypeahead {
        /**
         * @param {object} options
         * @param {HTMLInputElement} options.input
         * @param {HTMLElement} [options.field]  visual wrapper (.hero-search-field)
         * @param {HTMLFormElement} [options.form]
         * @param {string} [options.listId]
         * @param {string} [options.listClass]
         * @param {(query: string) => void} [options.onSubmitAll]
         * @param {(open: boolean) => void} [options.onOpenChange]
         */
        constructor(options = {}) {
            this.input = options.input;
            this.field = options.field || (this.input && this.input.closest('.hero-search-field'));
            this.form = options.form || (this.input && this.input.closest('form'));
            this.listId = options.listId || 'hero-search-suggestions';
            this.listClass = options.listClass || 'hero-search-suggestions hero-search-suggestions--floating';
            this.onSubmitAll = typeof options.onSubmitAll === 'function' ? options.onSubmitAll : null;
            this.onOpenChange = typeof options.onOpenChange === 'function' ? options.onOpenChange : null;

            this.list = null;
            this.items = [];
            this.highlightIndex = -1;
            this.debounceTimer = null;
            this.abortController = null;
            this.lastQuery = '';
            this.open = false;
            this.pointerOverList = false;
            this.focusOutTimer = null;
            this.boundReposition = (e) => this.onScrollOrResize(e);
            this.boundDocPointer = (e) => this.onDocumentPointer(e);
            this.boundDocClick = (e) => this.onDocumentClick(e);
            this.boundFocusOut = (e) => this.onFocusOut(e);
        }

        init() {
            if (!this.input) return this;

            this.ensureList();
            this.input.setAttribute('autocomplete', 'off');
            this.input.setAttribute('aria-autocomplete', 'list');
            this.input.setAttribute('aria-controls', this.listId);
            this.input.setAttribute('aria-expanded', 'false');
            this.input.setAttribute('role', 'combobox');

            this.input.addEventListener('input', () => this.onInput());
            this.input.addEventListener('keydown', (e) => this.onKeyDown(e));
            this.input.addEventListener('focus', () => {
                if (this.focusOutTimer) {
                    clearTimeout(this.focusOutTimer);
                    this.focusOutTimer = null;
                }
                if (String(this.input.value || '').trim().length >= MIN_CHARS) {
                    this.onInput(true);
                }
            });
            this.input.addEventListener('focusout', this.boundFocusOut);

            if (this.form) {
                this.form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.submitQuery(this.input.value);
                });
            }

            // Mouse: close on pointerdown outside (not on touch — that is how page/list
            // scroll gestures start, and it was dismissing the dropdown).
            document.addEventListener('pointerdown', this.boundDocPointer, true);
            // Touch/pen + fallback: close on true tap/click outside (scroll does not click).
            document.addEventListener('click', this.boundDocClick, true);
            window.addEventListener('resize', this.boundReposition, { passive: true });
            window.addEventListener('scroll', this.boundReposition, { passive: true, capture: true });

            return this;
        }

        ensureList() {
            let list = document.getElementById(this.listId);
            if (!list) {
                list = document.createElement('div');
                list.id = this.listId;
                list.className = this.listClass;
                list.setAttribute('role', 'listbox');
                list.hidden = true;
                document.body.appendChild(list);
            } else {
                list.className = this.listClass;
                if (list.parentElement !== document.body) {
                    document.body.appendChild(list);
                }
            }
            this.list = list;
            if (list.dataset.hmTypeaheadBound !== '1') {
                list.dataset.hmTypeaheadBound = '1';
                // Keep input focused when interacting with the panel (incl. scrollbar).
                list.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                });
                list.addEventListener('pointerenter', () => {
                    this.pointerOverList = true;
                });
                list.addEventListener('pointerleave', () => {
                    this.pointerOverList = false;
                });
            }
        }

        isInsideSearchUi(target) {
            if (!target) return false;
            if (this.input && (target === this.input || this.input.contains(target))) return true;
            if (this.field && this.field.contains(target)) return true;
            if (this.list && this.list.contains(target)) return true;
            if (this.form && this.form.contains(target)) return true;
            return false;
        }

        onScrollOrResize(e) {
            // Never dismiss on scroll — only keep the fixed panel anchored.
            // List-internal scroll bubbles to window with capture:true; ignore close.
            if (!this.open) return;
            // If the scroll originated inside the suggestions list, skip work unless
            // the page also moved (reposition only needs viewport/field changes).
            if (e && e.type === 'scroll' && this.list && e.target === this.list) return;
            this.reposition();
        }

        onDocumentPointer(e) {
            if (!this.open) return;
            // Touch/pen pointerdown is the start of a scroll gesture on many devices.
            // Closing here made results vanish when users tried to scroll to see them.
            if (e.pointerType && e.pointerType !== 'mouse') return;
            if (this.isInsideSearchUi(e.target)) return;
            // Page scrollbar hits often target <html>/<body>; treat as scroll, not dismiss.
            if (e.target === document.documentElement || e.target === document.body) return;
            this.close();
        }

        onDocumentClick(e) {
            if (!this.open) return;
            if (this.isInsideSearchUi(e.target)) return;
            this.close();
        }

        onFocusOut(e) {
            if (!this.open) return;
            const next = e.relatedTarget;
            if (this.isInsideSearchUi(next)) return;
            // null relatedTarget is common when the soft keyboard dismisses or the user
            // scrolls — do not treat that as dismiss (click-outside / Escape handle it).
            if (!next) return;
            if (this.focusOutTimer) clearTimeout(this.focusOutTimer);
            this.focusOutTimer = setTimeout(() => {
                this.focusOutTimer = null;
                if (!this.open) return;
                if (this.pointerOverList) return;
                if (this.isInsideSearchUi(document.activeElement)) return;
                if (document.activeElement === this.input) return;
                this.close();
            }, 0);
        }

        onInput(force) {
            const query = String(this.input.value || '').trim();
            clearTimeout(this.debounceTimer);

            if (query.length < MIN_CHARS) {
                this.close();
                return;
            }

            this.debounceTimer = setTimeout(
                () => {
                    this.fetchSuggestions(query);
                },
                force ? 0 : DEBOUNCE_MS
            );
        }

        async fetchSuggestions(query) {
            this.lastQuery = query;
            if (this.abortController) this.abortController.abort();
            this.abortController = new AbortController();

            try {
                const url = productsApiUrl(
                    `search=${encodeURIComponent(query)}&limit=${MAX_SUGGESTIONS}&sortBy=name&sortOrder=ASC`
                );
                const res = await fetch(url, { signal: this.abortController.signal });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (String(this.input.value || '').trim() !== query) return;

                const apiBase =
                    typeof global.hmGetStorefrontApiBase === 'function'
                        ? global.hmGetStorefrontApiBase()
                        : '';
                let products = dedupeById(data.products || []);
                if (typeof global.hmTransformStorefrontProduct === 'function') {
                    products = products.map((p) => global.hmTransformStorefrontProduct(p, apiBase));
                }
                // Guard-rail: same client keyword match as products page grid
                if (typeof global.hmProductSearchMatch === 'function') {
                    products = global.hmProductSearchMatch(products, query);
                }
                this.render(products, query);
            } catch (err) {
                if (err && err.name === 'AbortError') return;
                this.render([], query, true);
            }
        }

        render(products, query, errored) {
            if (!this.list) return;
            this.items = Array.isArray(products) ? products.slice(0, MAX_SUGGESTIONS) : [];
            this.highlightIndex = this.items.length ? 0 : -1;

            if (!this.items.length) {
                const msg = errored
                    ? 'Unable to search right now.'
                    : `No products found for “${escapeHtml(query)}”`;
                this.list.innerHTML = `<p class="hero-search-suggestions-empty">${msg}</p>
                    <a class="hero-search-suggestion hero-search-suggestion-all" href="products?search=${encodeURIComponent(query)}" role="option" data-action="all">
                        View all results
                    </a>`;
            } else {
                const thumb =
                    typeof global.hmProductThumbPlaceholder === 'string'
                        ? global.hmProductThumbPlaceholder
                        : '';
                const rows = this.items
                    .map((p, index) => {
                        const href = p.url || `product?slug=${encodeURIComponent(p.slug || '')}`;
                        const name = escapeHtml(p.name || 'Product');
                        const brand = escapeHtml(p.brandName || p.brand || '');
                        const price =
                            typeof global.hmFormatProductPrice === 'function'
                                ? global.hmFormatProductPrice(p.price)
                                : '';
                        const meta = [brand, price].filter(Boolean).join(' · ');
                        const img = escapeHtml(p.image || thumb);
                        return `<a class="hero-search-suggestion${index === 0 ? ' is-highlighted' : ''}"
                            href="${escapeHtml(href)}"
                            role="option"
                            data-index="${index}"
                            id="${this.listId}-opt-${index}">
                            <img class="hero-search-suggestion-img" src="${img}" alt="" width="44" height="44" loading="lazy" decoding="async">
                            <span class="hero-search-suggestion-text">
                                <span class="hero-search-suggestion-name">${name}</span>
                                ${meta ? `<span class="hero-search-suggestion-meta">${escapeHtml(meta)}</span>` : ''}
                            </span>
                        </a>`;
                    })
                    .join('');
                const all = `<a class="hero-search-suggestion hero-search-suggestion-all" href="products?search=${encodeURIComponent(query)}" role="option" data-action="all">
                        View all results for “${escapeHtml(query)}”
                    </a>`;
                this.list.innerHTML = rows + all;
            }

            this.list.querySelectorAll('.hero-search-suggestion').forEach((el) => {
                el.addEventListener('click', (e) => {
                    const action = el.getAttribute('data-action');
                    if (action === 'all') {
                        e.preventDefault();
                        this.submitQuery(query);
                        return;
                    }
                    // Ensure navigation even if a parent mousedown.preventDefault
                    // interferes with the default <a> activation in some agents.
                    const href = el.getAttribute('href');
                    if (href) {
                        e.preventDefault();
                        this.close();
                        window.location.href = href;
                    }
                });
            });

            this.openList();
            this.syncHighlight();
        }

        openList() {
            if (!this.list) return;
            this.list.hidden = false;
            this.open = true;
            this.input.setAttribute('aria-expanded', 'true');
            if (this.field) this.field.classList.add('is-suggest-open');
            document.body.classList.add('hero-search-open');
            if (this.onOpenChange) this.onOpenChange(true);
            this.reposition();
        }

        close() {
            if (!this.list) return;
            if (this.focusOutTimer) {
                clearTimeout(this.focusOutTimer);
                this.focusOutTimer = null;
            }
            this.list.hidden = true;
            this.list.innerHTML = '';
            this.open = false;
            this.pointerOverList = false;
            this.items = [];
            this.highlightIndex = -1;
            this.input.setAttribute('aria-expanded', 'false');
            this.input.removeAttribute('aria-activedescendant');
            if (this.field) this.field.classList.remove('is-suggest-open');
            document.body.classList.remove('hero-search-open');
            if (this.onOpenChange) this.onOpenChange(false);
        }

        reposition() {
            if (!this.open || !this.list || !this.input) return;
            const anchor = this.field || this.input;
            const rect = anchor.getBoundingClientRect();
            const width = Math.max(rect.width, 240);
            // Fixed positioning + getBoundingClientRect are layout-viewport relative.
            // Avoid visualViewport offset math — it under-counted spaceBelow and
            // flipped the hero dropdown upward even when room existed below.
            const vh =
                window.innerHeight || document.documentElement.clientHeight || 600;
            const margin = 8;
            const spaceBelow = Math.floor(vh - rect.bottom - margin);
            const spaceAbove = Math.floor(rect.top - margin);
            const preferred = Math.min(Math.floor(vh * 0.52), 24 * 16);
            // Always prefer below (normal combobox UX). Hero search often sits
            // ~100px above the viewport bottom (Search btn + category row); that
            // is still usable with overflow scroll. Only flip when below is too
            // small for even one row AND above has more room.
            const MIN_BELOW = 72;
            const openBelow = spaceBelow >= MIN_BELOW || spaceBelow >= spaceAbove;
            let maxPanel;
            this.list.style.position = 'fixed';
            this.list.style.left = `${Math.round(rect.left)}px`;
            this.list.style.width = `${Math.round(width)}px`;
            this.list.style.zIndex = '12050';
            this.list.style.overflowY = 'auto';
            if (openBelow) {
                maxPanel = Math.max(1, Math.min(preferred, Math.max(spaceBelow, 1)));
                this.list.style.top = `${Math.round(rect.bottom)}px`;
                this.list.style.bottom = 'auto';
            } else {
                maxPanel = Math.max(1, Math.min(preferred, Math.max(spaceAbove, 1)));
                // Anchor the bottom edge to the field so short content doesn't leave
                // a gap above the input (top = rect.top - maxPanel caused that).
                this.list.style.top = 'auto';
                this.list.style.bottom = `${Math.round(vh - rect.top)}px`;
            }
            this.list.style.maxHeight = `${Math.round(maxPanel)}px`;
        }

        onKeyDown(e) {
            if (e.key === 'Escape') {
                if (this.open) {
                    e.preventDefault();
                    this.close();
                }
                return;
            }

            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const options = this.getOptionElements();
                if (!options.length) return;
                e.preventDefault();
                if (!this.open) {
                    this.onInput(true);
                    return;
                }
                const delta = e.key === 'ArrowDown' ? 1 : -1;
                this.highlightIndex =
                    (this.highlightIndex + delta + options.length) % options.length;
                this.syncHighlight();
                return;
            }

            if (e.key === 'Enter') {
                if (this.open && this.highlightIndex >= 0) {
                    const options = this.getOptionElements();
                    const el = options[this.highlightIndex];
                    if (el) {
                        e.preventDefault();
                        if (el.getAttribute('data-action') === 'all') {
                            this.submitQuery(this.input.value);
                        } else {
                            window.location.href = el.href;
                        }
                        return;
                    }
                }
                e.preventDefault();
                this.submitQuery(this.input.value);
            }
        }

        getOptionElements() {
            if (!this.list) return [];
            return Array.from(this.list.querySelectorAll('.hero-search-suggestion'));
        }

        syncHighlight() {
            const options = this.getOptionElements();
            options.forEach((el, i) => {
                const on = i === this.highlightIndex;
                el.classList.toggle('is-highlighted', on);
                if (on) {
                    this.input.setAttribute('aria-activedescendant', el.id || `${this.listId}-opt-${i}`);
                    // Scroll only within the panel — avoid document scrollIntoView.
                    if (this.list) {
                        const listRect = this.list.getBoundingClientRect();
                        const elRect = el.getBoundingClientRect();
                        if (elRect.bottom > listRect.bottom) {
                            this.list.scrollTop += elRect.bottom - listRect.bottom;
                        } else if (elRect.top < listRect.top) {
                            this.list.scrollTop -= listRect.top - elRect.top;
                        }
                    }
                }
            });
        }

        submitQuery(raw) {
            const query = String(raw || '').trim();
            this.close();
            if (this.onSubmitAll) {
                this.onSubmitAll(query);
                return;
            }
            window.location.href = query
                ? `products?search=${encodeURIComponent(query)}`
                : 'products';
        }
    }

    // Bo* is the merchant-platform name; Hm* kept as a compatibility alias.
    global.BoStorefrontSearchTypeahead = HmStorefrontSearchTypeahead;
    global.HmStorefrontSearchTypeahead = HmStorefrontSearchTypeahead;
})(typeof window !== 'undefined' ? window : globalThis);
