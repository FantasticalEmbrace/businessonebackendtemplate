/**
 * H&M Herbs accessibility preferences toolbar.
 * Options: text size, high contrast, underlined links, reduce motion.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'hmherbs-a11y-prefs';

    function readPrefs() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
        } catch {
            return {};
        }
    }

    function writePrefs(prefs) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    }

    function systemReduceMotion() {
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch {
            return false;
        }
    }

    function systemHighContrast() {
        try {
            return window.matchMedia('(prefers-contrast: more), (prefers-contrast: high)').matches;
        } catch {
            return false;
        }
    }

    function applyPrefs(prefs) {
        const root = document.documentElement;
        root.classList.remove(
            'a11y-text-lg',
            'a11y-text-xl',
            'a11y-high-contrast',
            'a11y-underline-links',
            'a11y-reduce-motion'
        );

        if (prefs.textSize === 'lg') root.classList.add('a11y-text-lg');
        if (prefs.textSize === 'xl') root.classList.add('a11y-text-xl');
        if (prefs.highContrast || systemHighContrast()) root.classList.add('a11y-high-contrast');
        if (prefs.underlineLinks) root.classList.add('a11y-underline-links');
        if (prefs.reduceMotion || systemReduceMotion()) root.classList.add('a11y-reduce-motion');

        syncPressedStates(prefs);
        if (applyPrefs._userInitiated) {
            announce(describePrefs(prefs));
        }
    }

    function describePrefs(prefs) {
        const parts = [];
        if (prefs.textSize === 'lg') parts.push('larger text');
        if (prefs.textSize === 'xl') parts.push('largest text');
        if (prefs.highContrast) parts.push('high contrast');
        if (prefs.underlineLinks) parts.push('underlined links');
        if (prefs.reduceMotion) parts.push('reduced motion');
        return parts.length ? `Accessibility: ${parts.join(', ')}` : 'Accessibility preferences reset';
    }

    function announce(message) {
        let live = document.getElementById('hm-a11y-live');
        if (!live) {
            live = document.createElement('div');
            live.id = 'hm-a11y-live';
            live.className = 'sr-only';
            live.setAttribute('aria-live', 'polite');
            live.setAttribute('aria-atomic', 'true');
            document.body.appendChild(live);
        }
        live.textContent = '';
        window.setTimeout(() => {
            live.textContent = message;
        }, 40);
    }

    function syncPressedStates(prefs) {
        const panel = document.getElementById('hmA11yPanel');
        if (!panel) return;
        panel.querySelectorAll('[data-a11y]').forEach((btn) => {
            const action = btn.getAttribute('data-a11y');
            let pressed = false;
            if (action === 'text-lg') pressed = prefs.textSize === 'lg';
            else if (action === 'text-xl') pressed = prefs.textSize === 'xl';
            else if (action === 'contrast') pressed = Boolean(prefs.highContrast);
            else if (action === 'underline') pressed = Boolean(prefs.underlineLinks);
            else if (action === 'motion') pressed = Boolean(prefs.reduceMotion);
            else {
                btn.removeAttribute('aria-pressed');
                btn.classList.remove('is-active');
                return;
            }
            btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
            btn.classList.toggle('is-active', pressed);
        });
    }

    function ensureSkipLink() {
        if (document.querySelector('.skip-link, .skip-to-main')) return;
        const main = document.querySelector('main#main-content, #main-content, main');
        if (!main) return;
        if (!main.id) main.id = 'main-content';
        const link = document.createElement('a');
        link.href = `#${main.id}`;
        link.className = 'skip-link';
        link.textContent = 'Skip to main content';
        document.body.insertBefore(link, document.body.firstChild);
    }

    function mountToolbar() {
        if (document.querySelector('.hm-a11y-toolbar')) return;
        if (document.body.classList.contains('admin-body') || document.getElementById('admin-app')) return;

        const toolbar = document.createElement('div');
        toolbar.className = 'hm-a11y-toolbar';
        toolbar.innerHTML = `
            <button type="button" class="hm-a11y-toolbar-toggle" id="hmA11yToggle" aria-expanded="false" aria-controls="hmA11yPanel">
                <i class="fas fa-universal-access" aria-hidden="true"></i>
                <span>Accessibility</span>
            </button>
            <div class="hm-a11y-toolbar-panel" id="hmA11yPanel" role="region" aria-label="Accessibility options" hidden>
                <p class="hm-a11y-toolbar-title">Display options</p>
                <button type="button" data-a11y="text-lg" aria-pressed="false">Increase text size</button>
                <button type="button" data-a11y="text-xl" aria-pressed="false">Largest text size</button>
                <button type="button" data-a11y="text-reset">Reset text size</button>
                <button type="button" data-a11y="contrast" aria-pressed="false">High contrast</button>
                <button type="button" data-a11y="underline" aria-pressed="false">Underline links</button>
                <button type="button" data-a11y="motion" aria-pressed="false">Reduce motion</button>
                <button type="button" data-a11y="reset" class="hm-a11y-reset">Reset all</button>
            </div>
        `;
        document.body.appendChild(toolbar);

        const toggle = toolbar.querySelector('#hmA11yToggle');
        const panel = toolbar.querySelector('#hmA11yPanel');
        let prefs = readPrefs();

        function setOpen(open) {
            panel.hidden = !open;
            panel.classList.toggle('is-open', open);
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        }

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            setOpen(panel.hidden);
        });

        panel.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-a11y]');
            if (!btn) return;
            const action = btn.getAttribute('data-a11y');
            if (action === 'text-lg') prefs.textSize = 'lg';
            else if (action === 'text-xl') prefs.textSize = 'xl';
            else if (action === 'text-reset') delete prefs.textSize;
            else if (action === 'contrast') prefs.highContrast = !prefs.highContrast;
            else if (action === 'underline') prefs.underlineLinks = !prefs.underlineLinks;
            else if (action === 'motion') prefs.reduceMotion = !prefs.reduceMotion;
            else if (action === 'reset') prefs = {};
            writePrefs(prefs);
            applyPrefs._userInitiated = true;
            applyPrefs(prefs);
            applyPrefs._userInitiated = false;
        });

        document.addEventListener('click', (e) => {
            if (!toolbar.contains(e.target)) setOpen(false);
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !panel.hidden) {
                setOpen(false);
                toggle.focus();
            }
        });

        syncPressedStates(prefs);
    }

    function init() {
        const prefs = readPrefs();
        applyPrefs(prefs);
        ensureSkipLink();
        mountToolbar();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
