/**

 * US address type-ahead for storefront forms.

 * Suggestions appear while typing; customers can always enter an address manually.

 */

(function (global) {

    'use strict';



    function storefrontApiBase() {

        if (typeof location === 'undefined') return '/api';

        if (location.protocol === 'file:') return 'http://localhost:3001/api';

        const h = location.hostname;

        if ((h === 'localhost' || h === '127.0.0.1') && location.port && location.port !== '3001') {

            return `http://${h === '127.0.0.1' ? '127.0.0.1' : 'localhost'}:3001/api`;

        }

        return '/api';

    }



    function ensureStyles() {

        if (document.querySelector('link[data-hm-address-ac-css]')) return;

        const link = document.createElement('link');

        link.rel = 'stylesheet';

        link.href = 'css/address-autocomplete.css';

        link.setAttribute('data-hm-address-ac-css', '1');

        document.head.appendChild(link);

    }



    function resolveEl(ref, root) {

        if (!ref) return null;

        if (typeof ref === 'string') return (root || document).querySelector(ref);

        return ref;

    }



    function attach(config) {

        const line1 = resolveEl(config.line1, config.root);

        if (!line1) return;

        if (line1.dataset.hmAddressAcBound === '1') return;



        line1.dataset.hmAddressAcBound = '1';

        ensureStyles();



        const line2 = resolveEl(config.line2, config.root);

        const city = resolveEl(config.city, config.root);

        const state = resolveEl(config.state, config.root);

        const zip = resolveEl(config.zip, config.root);

        const apiBase = config.apiBase || storefrontApiBase();



        let wrap = line1.closest('.hm-address-autocomplete-wrap');

        if (!wrap) {

            wrap = document.createElement('div');

            wrap.className = 'hm-address-autocomplete-wrap';

            line1.parentNode.insertBefore(wrap, line1);

            wrap.appendChild(line1);

        }



        let list = wrap.querySelector('.hm-address-suggest-list');

        if (!list) {

            list = document.createElement('ul');

            list.className = 'hm-address-suggest-list';

            list.setAttribute('role', 'listbox');

            list.hidden = true;

            wrap.appendChild(list);

        }



        line1.setAttribute('autocomplete', 'off');

        line1.setAttribute('aria-autocomplete', 'list');

        if (!list.id) list.id = 'hm-addr-ac-' + Math.random().toString(36).slice(2, 9);

        line1.setAttribute('aria-controls', list.id);



        let debounceTimer = null;

        let activeIndex = -1;

        let suggestions = [];

        let lastQuery = '';

        let fetchToken = 0;



        function showList() {

            list.hidden = false;

            wrap.classList.add('is-open');

            const formGroup = wrap.closest('.form-group');

            if (formGroup) formGroup.classList.add('hm-address-ac-active');

            line1.setAttribute('aria-expanded', 'true');

        }



        function hideList() {

            list.hidden = true;

            list.innerHTML = '';

            activeIndex = -1;

            suggestions = [];

            line1.removeAttribute('aria-expanded');

            wrap.classList.remove('is-open');

            const formGroup = wrap.closest('.form-group');

            if (formGroup) formGroup.classList.remove('hm-address-ac-active');

        }



        function showStatusMessage(message, className) {

            list.innerHTML = '';

            const li = document.createElement('li');

            li.className = className || 'hm-address-suggest-status';

            li.setAttribute('role', 'presentation');

            li.textContent = message;

            list.appendChild(li);

            showList();

        }



        function fillFields(item) {

            if (item.line1) line1.value = item.line1;

            if (line2 && item.line2) line2.value = item.line2;

            if (city && item.city) city.value = item.city;

            if (state && item.state) state.value = String(item.state).toUpperCase().slice(0, 2);

            if (zip && item.postalCode) zip.value = item.postalCode;

            hideList();

            line1.dispatchEvent(new Event('change', { bubbles: true }));

        }



        function renderList() {

            list.innerHTML = '';

            if (!suggestions.length) {

                showStatusMessage('No matching addresses found — keep typing or enter your address manually.');

                return;

            }



            suggestions.forEach((item, idx) => {

                const li = document.createElement('li');

                li.className = 'hm-address-suggest-item' + (idx === activeIndex ? ' is-active' : '');

                li.setAttribute('role', 'option');

                li.textContent = item.label || [item.line1, item.city, item.state, item.postalCode].filter(Boolean).join(', ');

                li.addEventListener('mousedown', (e) => {

                    e.preventDefault();

                    fillFields(item);

                });

                list.appendChild(li);

            });

            showList();

        }



        async function fetchSuggestions(query) {

            lastQuery = query;

            const token = ++fetchToken;

            showStatusMessage('Searching addresses…', 'hm-address-suggest-status is-loading');



            const stateHint = state && state.value ? state.value.trim() : '';

            const params = new URLSearchParams({ q: query });

            if (stateHint) params.set('state', stateHint);



            try {

                const res = await fetch(`${apiBase}/address-suggest?${params.toString()}`, {

                    headers: { Accept: 'application/json' },

                });

                if (token !== fetchToken || lastQuery !== query) return;



                if (!res.ok) {

                    showStatusMessage('Address lookup unavailable right now — you can still enter your address manually.');

                    return;

                }



                const data = await res.json();

                if (token !== fetchToken || lastQuery !== query) return;



                suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];

                activeIndex = suggestions.length ? 0 : -1;

                renderList();

            } catch (_) {

                if (token !== fetchToken || lastQuery !== query) return;

                showStatusMessage('Could not reach the address service — enter your address manually.');

            }

        }



        line1.addEventListener('input', () => {

            const q = line1.value.trim();

            clearTimeout(debounceTimer);

            if (q.length < 3) {

                hideList();

                return;

            }

            debounceTimer = setTimeout(() => fetchSuggestions(q), 280);

        });



        line1.addEventListener('keydown', (e) => {

            if (list.hidden) return;

            if (e.key === 'ArrowDown' && suggestions.length) {

                e.preventDefault();

                activeIndex = Math.min(activeIndex + 1, suggestions.length - 1);

                renderList();

            } else if (e.key === 'ArrowUp' && suggestions.length) {

                e.preventDefault();

                activeIndex = Math.max(activeIndex - 1, 0);

                renderList();

            } else if (e.key === 'Enter' && activeIndex >= 0 && suggestions.length) {

                e.preventDefault();

                fillFields(suggestions[activeIndex]);

            } else if (e.key === 'Escape') {

                hideList();

            }

        });



        line1.addEventListener('blur', () => {

            setTimeout(hideList, 180);

        });

        hideList();
    }



    function attachMany(configs) {

        (configs || []).forEach((cfg) => attach(cfg));

    }



    function attachStandardForms(root) {

        const scope = root && root.querySelectorAll ? root : document;

        attachMany([

            {

                root: scope,

                line1: '#register-address-line1',

                line2: '#register-address-line2',

                city: '#register-address-city',

                state: '#register-address-state',

                zip: '#register-address-zip',

            },

            {

                root: scope,

                line1: '#address-line1',

                line2: '#address-line2',

                city: '#address-city',

                state: '#address-state',

                zip: '#address-zip',

            },

            {

                root: scope,

                line1: '#shipping-address-1',

                line2: '#shipping-address-2',

                city: '#shipping-city',

                state: '#shipping-state',

                zip: '#shipping-zip',

            },

            {

                root: scope,

                line1: '#billing-address-1',

                line2: '#billing-address-2',

                city: '#billing-city',

                state: '#billing-state',

                zip: '#billing-zip',

            },

            {

                root: scope,

                line1: '#addr-line1',

                line2: '#addr-line2',

                city: '#addr-city',

                state: '#addr-state',

                zip: '#addr-postal',

            },

        ]);

    }



    const api = {

        attach,

        attachMany,

        attachStandardForms,

        storefrontApiBase,

    };



    global.HMHERBS_ADDRESS_AUTOCOMPLETE = api;



    function scheduleStandardForms() {

        setTimeout(() => attachStandardForms(), 0);

    }



    if (document.readyState === 'loading') {

        document.addEventListener('DOMContentLoaded', scheduleStandardForms);

    } else {

        scheduleStandardForms();

    }

})(typeof window !== 'undefined' ? window : globalThis);

