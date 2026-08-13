'use strict';

/**
 * Replaces default checkbox/radio appearance with red-off / green-on controls.
 * Re-scans when admin modals and dynamic forms inject new inputs.
 */
const HmChoiceToggles = {
    skipSelector:
        '.payment-processor-option, .toggle-switch, .hm-choice-skip, [data-hm-choice-skip], .hm-choice-row, .hm-choice-segment, .hm-choice-toggle, .checkout-shipping-option, .checkout-shipping-options',

    inferSize(input) {
        const key = `${input.name || ''} ${input.id || ''}`.toLowerCase();
        if (/canauthorize|canprocessrefunds|allowmanualdiscounts|canviewcost|canopendrawer|tax.exempt|tax_exempt/.test(key)) return 'lg';
        if (
            /pos_receipt_|pos_payment_|pos_scan_|pos_show_|pos_display_|pos_large_|pos_sign_|pos_require_|pos_eod_|pos_daily_|promo-form-|inventory-|compactview|showdescriptions/.test(
                key
            )
        ) {
            return 'sm';
        }
        if (input.closest('[data-hm-choice-compact]')) return 'sm';
        if (input.closest('[data-hm-choice-large]')) return 'lg';
        return 'md';
    },

    shouldSkip(input) {
        if (!input || input.dataset.hmChoiceEnhanced) return true;
        if (input.type !== 'checkbox' && input.type !== 'radio') return true;
        return Boolean(input.closest(this.skipSelector));
    },

    buildPill(size) {
        const pill = document.createElement('span');
        pill.className = 'hm-choice-pill';
        pill.setAttribute('aria-hidden', 'true');
        pill.innerHTML =
            '<span class="hm-choice-state hm-choice-state-on">On</span>' +
            '<span class="hm-choice-knob"></span>' +
            '<span class="hm-choice-state hm-choice-state-off">Off</span>';
        if (size !== 'lg') {
            pill.querySelectorAll('.hm-choice-state').forEach((el) => el.remove());
        }
        return pill;
    },

    wrapInputAndPill(input, pill) {
        const toggle = document.createElement('span');
        toggle.className = 'hm-choice-toggle';
        input.parentNode.insertBefore(toggle, input);
        toggle.appendChild(input);
        toggle.appendChild(pill);
        return toggle;
    },

    wrapLabelText(label, afterNode) {
        const textWrap = document.createElement('span');
        textWrap.className = 'hm-choice-text';
        while (afterNode.nextSibling) {
            textWrap.appendChild(afterNode.nextSibling);
        }
        if (textWrap.childNodes.length) {
            label.appendChild(textWrap);
        }
    },

    markEnhanced(input) {
        input.classList.add('hm-choice-input');
        input.dataset.hmChoiceEnhanced = '1';
    },

    wrapStandalone(input) {
        const size = this.inferSize(input);
        this.markEnhanced(input);
        const pill = this.buildPill(size);
        const parent = input.parentElement;
        const forLabel = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;

        if (forLabel && forLabel.parentElement === parent) {
            const row = document.createElement('label');
            row.className = `hm-choice-row hm-choice-row--${size}`;
            parent.insertBefore(row, input);
            row.appendChild(input);
            this.wrapInputAndPill(input, pill);
            const textWrap = document.createElement('span');
            textWrap.className = 'hm-choice-text';
            textWrap.appendChild(forLabel);
            row.appendChild(textWrap);
            forLabel.removeAttribute('for');
            return;
        }

        const row = document.createElement('label');
        row.className = `hm-choice-row hm-choice-row--${size}`;
        parent.insertBefore(row, input);
        row.appendChild(input);
        this.wrapInputAndPill(input, pill);
    },

    enhanceCheckbox(input) {
        if (this.shouldSkip(input)) return;

        const size = this.inferSize(input);
        this.markEnhanced(input);
        const pill = this.buildPill(size);
        const parent = input.parentElement;

        if (parent && parent.tagName === 'LABEL') {
            parent.classList.add('hm-choice-row', `hm-choice-row--${size}`);
            if (parent.firstElementChild !== input) {
                parent.insertBefore(input, parent.firstChild);
            }
            const toggle = this.wrapInputAndPill(input, pill);
            this.wrapLabelText(parent, toggle);
            return;
        }

        if (input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) {
            this.wrapStandalone(input);
            return;
        }

        this.wrapStandalone(input);
    },

    enhanceRadioGroup(radios) {
        const labels = radios.map((r) => r.closest('label')).filter(Boolean);
        if (labels.length !== radios.length || labels.length < 2) {
            radios.forEach((r) => {
                if (r.type === 'radio') this.enhanceCheckbox(r);
            });
            return;
        }

        const parent = labels[0].parentElement;
        if (!parent || !labels.every((l) => l.parentElement === parent)) {
            radios.forEach((r) => this.enhanceCheckbox(r));
            return;
        }

        parent.classList.add('hm-choice-segmented');
        radios.forEach((input, index) => {
            const label = labels[index];
            const size = this.inferSize(input);
            this.markEnhanced(input);
            label.classList.add('hm-choice-segment', `hm-choice-segment--${size}`);
            if (label.firstElementChild !== input) {
                label.insertBefore(input, label.firstChild);
            }
        });
    },

    scan(root) {
        const scope = root && root.querySelectorAll ? root : document;
        const inputs = [...scope.querySelectorAll('input[type="checkbox"], input[type="radio"]')].filter(
            (i) => !this.shouldSkip(i)
        );
        if (!inputs.length) return;

        const radios = inputs.filter((i) => i.type === 'radio');
        const checkboxes = inputs.filter((i) => i.type === 'checkbox');

        checkboxes.forEach((i) => this.enhanceCheckbox(i));

        const groups = new Map();
        for (const radio of radios) {
            const name = radio.name || `__solo_${radio.id || Math.random()}`;
            if (!groups.has(name)) groups.set(name, []);
            groups.get(name).push(radio);
        }

        for (const group of groups.values()) {
            if (group.some((r) => r.closest('.payment-processor-option'))) continue;
            if (group.length === 1) {
                this.enhanceCheckbox(group[0]);
            } else {
                this.enhanceRadioGroup(group);
            }
        }
    },

    nodeNeedsScan(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node.matches?.('input[type="checkbox"]:not([data-hm-choice-enhanced]), input[type="radio"]:not([data-hm-choice-enhanced])')) {
            return true;
        }
        return Boolean(
            node.querySelector?.(
                'input[type="checkbox"]:not([data-hm-choice-enhanced]), input[type="radio"]:not([data-hm-choice-enhanced])'
            )
        );
    },

    scheduleScan(node) {
        if (!this.nodeNeedsScan(node)) return;
        if (this._scanTimer) clearTimeout(this._scanTimer);
        this._scanTimer = setTimeout(() => {
            this._scanTimer = null;
            this.scan(node);
        }, 30);
    },

    preventFocusScroll() {
        document.addEventListener(
            'focusin',
            (event) => {
                const target = event.target;
                if (!target?.classList?.contains('hm-choice-input')) return;
                const scrollEl = target.closest('.main-content') || document.scrollingElement;
                const top = scrollEl?.scrollTop ?? window.scrollY;
                requestAnimationFrame(() => {
                    if (scrollEl && scrollEl !== document.documentElement) {
                        scrollEl.scrollTop = top;
                    } else {
                        window.scrollTo(window.scrollX, top);
                    }
                });
            },
            true
        );
    },

    init() {
        this.preventFocusScroll();
        this.scan(document);
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) {
                        this.scheduleScan(node);
                    }
                }
            }
        });
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => HmChoiceToggles.init());
} else {
    HmChoiceToggles.init();
}

window.HmChoiceToggles = HmChoiceToggles;
