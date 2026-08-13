/**

 * Safe search input helpers — prevents stale async restores from eating keystrokes.

 */

(function (global) {

    'use strict';



    function normalizeDefault(value) {

        return String(value || '').trim().toLowerCase();

    }



    function isActivelyEditing(input) {

        return Boolean(input && document.activeElement === input);

    }



    /**

     * Bind a search field with debounce + IME composition support.

     * Never writes back to the input — onSearch receives (rawValue, normalizedValue).

     */

    function bindSearchInput(input, options) {

        if (!input || input.dataset.hmSearchBound === '1') return;

        input.dataset.hmSearchBound = '1';



        const debounceMs = options.debounceMs ?? 300;

        const normalize = options.normalize ?? normalizeDefault;

        let timer = null;

        let composing = false;



        input.setAttribute('autocomplete', 'off');

        input.setAttribute('autocorrect', 'off');

        input.setAttribute('spellcheck', 'false');

        input.setAttribute('enterkeyhint', 'search');



        function fire() {

            const raw = input.value;

            options.onSearch(raw, normalize(raw), input);

        }



        function schedule() {

            clearTimeout(timer);

            timer = setTimeout(fire, debounceMs);

        }



        input.addEventListener('compositionstart', () => {

            composing = true;

        });



        input.addEventListener('compositionend', () => {

            composing = false;

            schedule();

        });



        input.addEventListener('input', () => {

            if (composing) return;

            schedule();

        });



        if (options.clearButton) {

            options.clearButton.addEventListener('click', () => {

                input.value = '';

                if (typeof options.onClear === 'function') {

                    options.onClear(input);

                } else {

                    fire();

                }

            });

        }

    }



    /**

     * Restore a search value after async work — never stomps active typing.

     */

    function safeRestoreValue(input, preserved) {

        if (!input || preserved == null) return false;

        if (isActivelyEditing(input)) return false;



        const preservedStr = String(preserved);

        if (input.value !== preservedStr) {

            input.value = preservedStr;

            return true;

        }

        return false;

    }



    /** Prefer the live field value when the user is editing. */

    function liveValue(input, fallback) {

        if (!input) return fallback == null ? '' : String(fallback);

        return input.value;

    }



    function createDebounced(fn, wait) {

        let timer = null;

        return function debounced(...args) {

            clearTimeout(timer);

            timer = setTimeout(() => fn.apply(this, args), wait);

        };

    }



    global.hmBindSearchInput = bindSearchInput;

    global.hmSafeRestoreSearchValue = safeRestoreValue;

    global.hmSearchInputIsActive = isActivelyEditing;

    global.hmSearchLiveValue = liveValue;

    global.hmDebounce = createDebounced;

})(typeof window !== 'undefined' ? window : globalThis);

