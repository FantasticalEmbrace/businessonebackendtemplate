/**
 * Adds show/hide toggle to password inputs site-wide.
 */
(function (global) {
    'use strict';

    const WRAP_CLASS = 'hm-password-field';
    const SKIP_SELECTOR = '.input-with-toggle, .hm-password-field, .password-field';

    const ICON_SHOW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const ICON_HIDE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M1 1l22 22"/><path d="M14.12 14.12a3 3 0 0 1-4.24-4.24"/></svg>';

    function shouldSkip(input) {
        if (!input || input.type !== 'password') return true;
        if (input.dataset.hmPasswordToggle === 'off') return true;
        if (input.closest(SKIP_SELECTOR)) return true;
        return false;
    }

    function setToggleState(input, btn, visible) {
        input.type = visible ? 'text' : 'password';
        btn.innerHTML = visible ? ICON_HIDE : ICON_SHOW;
        btn.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
        btn.setAttribute('aria-pressed', visible ? 'true' : 'false');
        btn.title = visible ? 'Hide password' : 'Show password';
    }

    function enhanceInput(input) {
        if (shouldSkip(input)) return;

        const wrap = document.createElement('div');
        wrap.className = WRAP_CLASS;
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hm-password-toggle-btn';
        setToggleState(input, btn, false);
        btn.addEventListener('click', () => {
            const visible = input.type === 'password';
            setToggleState(input, btn, visible);
            input.focus({ preventScroll: true });
        });
        wrap.appendChild(btn);
    }

    function scan(root) {
        const scope = root && root.querySelectorAll ? root : document;
        scope.querySelectorAll('input[type="password"]').forEach((input) => {
            if (!shouldSkip(input)) enhanceInput(input);
        });
    }

    let observerStarted = false;

    function init() {
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', init, { once: true });
            return;
        }
        scan(document);
        if (observerStarted) return;
        observerStarted = true;
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType !== 1) return;
                    if (node.matches?.('input[type="password"]')) {
                        if (!shouldSkip(node)) enhanceInput(node);
                    } else if (node.querySelectorAll) {
                        scan(node);
                    }
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    global.HMPasswordToggle = { init, scan, enhanceInput };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.addEventListener('load', () => {
        scan(document);
    }, { once: true });
})(window);
