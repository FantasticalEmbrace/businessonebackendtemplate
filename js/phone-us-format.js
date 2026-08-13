/**
 * US phone display mask: (555) 555-0100 — 10 digits, fixed punctuation.
 * Binds to input[type="tel"] and input[data-phone-us].
 */
(function (global) {
    'use strict';

    var DISPLAY_RE = /^\(\d{3}\) \d{3}-\d{4}$/;

    function digitsOnly(s) {
        return String(s == null ? '' : s).replace(/\D/g, '');
    }

    function formatDigitsToDisplay(digits) {
        var d = digitsOnly(digits).slice(0, 10);
        if (!d.length) return '';
        var a = d.slice(0, 3);
        var b = d.slice(3, 6);
        var c = d.slice(6, 10);
        if (d.length <= 3) return '(' + a;
        if (d.length <= 6) return '(' + a + ') ' + b;
        return '(' + a + ') ' + b + '-' + c;
    }

    function isValidDisplay(value, allowEmpty) {
        var t = String(value == null ? '' : value).trim();
        if (!t) return Boolean(allowEmpty);
        return DISPLAY_RE.test(t);
    }

    function isPhoneInput(el) {
        if (!el || el.nodeName !== 'INPUT') return false;
        if (el.type === 'tel' || el.getAttribute('type') === 'tel') return true;
        return el.hasAttribute('data-phone-us');
    }

    function syncFromDigits(input) {
        var oldVal = input.value;
        var start = typeof input.selectionStart === 'number' ? input.selectionStart : oldVal.length;
        var digitsBefore = oldVal.slice(0, start).replace(/\D/g, '').length;
        var d = oldVal.replace(/\D/g, '').slice(0, 10);
        var newVal = formatDigitsToDisplay(d);
        if (newVal === oldVal) return;
        input.value = newVal;
        var seen = 0;
        var pos = newVal.length;
        for (var i = 0; i < newVal.length; i++) {
            if (/\d/.test(newVal.charAt(i))) seen++;
            pos = i + 1;
            if (seen >= digitsBefore) break;
        }
        if (digitsBefore === 0) pos = 0;
        try {
            input.setSelectionRange(pos, pos);
        } catch (_) {
            /* IE / rare */
        }
    }

    function attach(input) {
        if (!isPhoneInput(input) || input.dataset.hmUsPhoneBound === '1') return;
        input.dataset.hmUsPhoneBound = '1';
        if (input.getAttribute('type') !== 'tel') {
            input.setAttribute('type', 'tel');
        }
        input.setAttribute('inputmode', 'numeric');
        input.setAttribute('maxlength', '14');
        if (!input.getAttribute('placeholder')) {
            input.setAttribute('placeholder', '(555) 555-0100');
        }

        input.addEventListener('blur', function () {
            var d = input.value.replace(/\D/g, '');
            if (!d.length) {
                if (!input.required) input.value = '';
                return;
            }
            input.value = formatDigitsToDisplay(d);
        });

        var d0 = input.value.replace(/\D/g, '').slice(0, 10);
        if (d0.length) input.value = formatDigitsToDisplay(d0);
    }

    function init(root) {
        var r = root && root.querySelectorAll ? root : document;
        var list = r.querySelectorAll
            ? r.querySelectorAll('input[type="tel"], input[data-phone-us]')
            : [];
        for (var i = 0; i < list.length; i++) attach(list[i]);
    }

    function ensureAttached(target) {
        if (isPhoneInput(target)) attach(target);
    }

    function onDelegatedInput(e) {
        if (!isPhoneInput(e.target)) return;
        ensureAttached(e.target);
        syncFromDigits(e.target);
    }

    function onDelegatedFocusIn(e) {
        ensureAttached(e.target);
    }

    function onDelegatedPaste(e) {
        if (!isPhoneInput(e.target)) return;
        ensureAttached(e.target);
        var input = e.target;
        setTimeout(function () {
            syncFromDigits(input);
        }, 0);
    }

    var debounceTimer;
    function scheduleInit(scope) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
            init(scope && scope.querySelectorAll ? scope : document);
        }, 50);
    }

    var api = {
        DISPLAY_RE: DISPLAY_RE,
        digitsOnly: digitsOnly,
        formatDigitsToDisplay: formatDigitsToDisplay,
        isValidDisplay: isValidDisplay,
        attach: attach,
        init: init,
        refresh: init,
    };

    global.HMHERBS_PHONE_US = api;

    document.addEventListener('input', onDelegatedInput, true);
    document.addEventListener('focusin', onDelegatedFocusIn, true);
    document.addEventListener('paste', onDelegatedPaste, true);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            scheduleInit(document);
        });
    } else {
        scheduleInit(document);
    }

    if (typeof MutationObserver !== 'undefined' && document.documentElement) {
        var mo = new MutationObserver(function (mutations) {
            var scope = null;
            for (var m = 0; m < mutations.length; m++) {
                var nodes = mutations[m].addedNodes;
                for (var n = 0; n < nodes.length; n++) {
                    var node = nodes[n];
                    if (node.nodeType === 1) {
                        scope = node;
                        break;
                    }
                }
                if (scope) break;
            }
            scheduleInit(scope || document);
        });
        mo.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
