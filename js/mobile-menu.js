// Mobile navigation — hamburger toggle (storefront breakpoints ≤1100px)
(function () {
    'use strict';

    const MOBILE_NAV_MAX_WIDTH = 1100;
    const MOBILE_NAV_MQ = window.matchMedia(`(max-width: ${MOBILE_NAV_MAX_WIDTH}px)`);
    const MENU_SELECTOR = '.nav-menu, #nav-menu, #navbar-menu';
    const MENU_PORTAL_CLASS = 'hm-mobile-nav-portal';
    let suppressOutsideCloseUntil = 0;
    const menuHomes = new WeakMap();

    window.HM_MOBILE_NAV_MAX_WIDTH = MOBILE_NAV_MAX_WIDTH;

    function isMobileNavViewport() {
        return MOBILE_NAV_MQ.matches;
    }

    function findMenuForToggle(toggle) {
        if (!toggle) return null;
        const menuId = String(toggle.getAttribute('aria-controls') || '').trim();
        if (menuId) {
            const byId = document.getElementById(menuId);
            if (byId) return byId;
        }
        const scope = toggle.closest('.navbar, .header-content, .main-header, .header, header') || document;
        return scope.querySelector(MENU_SELECTOR);
    }

    function findToggleForMenu(menu) {
        if (!menu) return null;
        if (menu.id) {
            const linked = document.querySelector(`.mobile-menu-toggle[aria-controls="${menu.id}"]`);
            if (linked) return linked;
        }
        return document.querySelector('.mobile-menu-toggle');
    }

    function ensureToggleControls(toggle) {
        if (!toggle) return;
        if (!toggle.getAttribute('type')) {
            toggle.setAttribute('type', 'button');
        }
        if (toggle.getAttribute('aria-controls')) return;
        const menu = findMenuForToggle(toggle);
        if (menu?.id) {
            toggle.setAttribute('aria-controls', menu.id);
        }
    }

    function rememberMenuHome(menu) {
        if (!menu || menuHomes.has(menu) || !menu.parentNode) return;
        menuHomes.set(menu, {
            parent: menu.parentNode,
            nextSibling: menu.nextSibling
        });
    }

    function restoreMenuHome(menu) {
        if (!menu) return;
        const home = menuHomes.get(menu);
        menu.classList.remove(MENU_PORTAL_CLASS);
        if (!home?.parent || menu.parentNode !== document.body) return;
        if (home.nextSibling && home.nextSibling.parentNode === home.parent) {
            home.parent.insertBefore(menu, home.nextSibling);
        } else {
            home.parent.appendChild(menu);
        }
    }

    function portalMenuToBody(menu, open) {
        if (!menu) return;
        rememberMenuHome(menu);
        if (open && isMobileNavViewport()) {
            if (menu.parentNode !== document.body) {
                document.body.appendChild(menu);
            }
            menu.classList.add(MENU_PORTAL_CLASS);
            return;
        }
        restoreMenuHome(menu);
    }

    function clearMenuInlineStyles(menu) {
        if (!menu) return;
        menu.style.cssText = '';
        menu.querySelectorAll('li, a').forEach((el) => {
            el.style.cssText = '';
        });
    }

    function moveFocusOutOfMenu(menu, toggle) {
        const active = document.activeElement;
        if (!active || !menu.contains(active)) return;
        if (toggle && typeof toggle.focus === 'function') {
            try {
                toggle.focus({ preventScroll: true });
            } catch {
                toggle.focus();
            }
        } else if (typeof active.blur === 'function') {
            active.blur();
        }
    }

    function setMenuOpen(menu, toggle, open) {
        if (!menu || !toggle) return;
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        menu.classList.toggle('show', open);

        if (open) {
            menu.setAttribute('aria-hidden', 'false');
        }

        if (open && isMobileNavViewport()) {
            portalMenuToBody(menu, true);
            document.body.classList.add('hm-mobile-nav-open');
            document.body.style.overflow = 'hidden';
            return;
        }

        portalMenuToBody(menu, false);
        document.body.classList.remove('hm-mobile-nav-open');
        document.body.style.overflow = '';
        if (!open || !isMobileNavViewport()) {
            clearMenuInlineStyles(menu);
        }

        if (!open) {
            moveFocusOutOfMenu(menu, toggle);
            requestAnimationFrame(() => {
                menu.setAttribute('aria-hidden', 'true');
            });
        }
    }

    function toggleMobileMenu(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        const toggle =
            (e && e.currentTarget) ||
            (e && e.target && e.target.closest && e.target.closest('.mobile-menu-toggle')) ||
            document.querySelector('.mobile-menu-toggle');
        const menu = findMenuForToggle(toggle);

        if (!toggle || !menu) {
            console.error('Mobile menu: toggle or menu not found', {
                toggle: Boolean(toggle),
                menu: Boolean(menu),
                controls: toggle?.getAttribute('aria-controls')
            });
            return;
        }

        ensureToggleControls(toggle);
        const open = !menu.classList.contains('show');
        setMenuOpen(menu, toggle, open);
        suppressOutsideCloseUntil = Date.now() + 500;
    }

    function closeAllMenus() {
        document.querySelectorAll(MENU_SELECTOR).forEach((menu) => {
            if (!menu.classList.contains('show')) {
                restoreMenuHome(menu);
                return;
            }
            setMenuOpen(menu, findToggleForMenu(menu), false);
        });
        document.body.classList.remove('hm-mobile-nav-open');
        document.body.style.overflow = '';
    }

    function bindToggle(toggle) {
        ensureToggleControls(toggle);
        toggle.removeAttribute('onclick');
        if (toggle.dataset.hmMenuBound === '1') return;
        toggle.dataset.hmMenuBound = '1';
        toggle.addEventListener('click', toggleMobileMenu);
    }

    function navIconForLink(anchor) {
        const href = String(anchor.getAttribute('href') || '').toLowerCase();
        if (href.includes('products.html') || href.includes('/products')) return 'fa-box-open';
        if (href.includes('edsa')) return 'fa-hand-holding-medical';
        if (href.includes('about')) return 'fa-seedling';
        if (href.includes('contact') || href.includes('#contact')) return 'fa-envelope';
        if (href.includes('index.html') || href === '/' || href.endsWith('#home') || href === '#home' || href === 'index.html') {
            return 'fa-house';
        }
        return 'fa-leaf';
    }

    function decorateMobileMenu(menu) {
        if (!menu || !isMobileNavViewport()) return;
        if (menu.dataset.hmNavDecorated === '1') return;
        menu.dataset.hmNavDecorated = '1';
        menu.classList.add('hm-mobile-nav-branded');

        if (!menu.querySelector('.hm-mobile-nav-brand')) {
            const brand = document.createElement('li');
            brand.className = 'hm-mobile-nav-brand';
            brand.setAttribute('aria-hidden', 'true');
            brand.innerHTML = [
                '<div class="hm-mobile-nav-brand-inner">',
                '  <span class="hm-mobile-nav-brand-icon" aria-hidden="true"><i class="fas fa-leaf"></i></span>',
                '  <div class="hm-mobile-nav-brand-text">',
                '    <span class="hm-mobile-nav-brand-name">H&amp;M Herbs</span>',
                '    <span class="hm-mobile-nav-brand-tag">&amp; Vitamins</span>',
                '  </div>',
                '</div>',
                '<p class="hm-mobile-nav-brand-lead">Natural health &amp; wellness since 1994</p>'
            ].join('');
            menu.insertBefore(brand, menu.firstChild);
        }

        menu.querySelectorAll(':scope > li:not(.hm-mobile-nav-brand):not(.hm-mobile-nav-footer) > a[href]').forEach((anchor) => {
            if (anchor.classList.contains('hm-mobile-nav-link')) return;
            anchor.classList.add('hm-mobile-nav-link');
            const labelText = anchor.textContent.trim();
            const iconClass = navIconForLink(anchor);
            anchor.textContent = '';
            const icon = document.createElement('span');
            icon.className = 'hm-mobile-nav-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.innerHTML = `<i class="fas ${iconClass}"></i>`;
            const label = document.createElement('span');
            label.className = 'hm-mobile-nav-label';
            label.textContent = labelText;
            const arrow = document.createElement('span');
            arrow.className = 'hm-mobile-nav-arrow';
            arrow.setAttribute('aria-hidden', 'true');
            arrow.innerHTML = '<i class="fas fa-chevron-right"></i>';
            anchor.appendChild(icon);
            anchor.appendChild(label);
            anchor.appendChild(arrow);
        });

        if (!menu.querySelector('.hm-mobile-nav-footer')) {
            const footer = document.createElement('li');
            footer.className = 'hm-mobile-nav-footer';
            footer.setAttribute('aria-hidden', 'true');
            footer.innerHTML = [
                '<a href="tel:+17068619454" class="hm-mobile-nav-phone">',
                '  <i class="fas fa-phone" aria-hidden="true"></i>',
                '  <span>706-861-9454</span>',
                '</a>',
                '<a href="products.html" class="hm-mobile-nav-cta-btn">Shop All Products</a>'
            ].join('');
            menu.appendChild(footer);
        }
    }

    function syncHeaderOffset() {
        const header = document.querySelector('.header');
        if (!header) return;
        document.documentElement.style.setProperty(
            '--hm-header-offset',
            `${header.offsetHeight}px`
        );
    }

    function setupMobileMenuToggles() {
        syncHeaderOffset();
        document.querySelectorAll('.mobile-menu-toggle').forEach(bindToggle);
        document.querySelectorAll(MENU_SELECTOR).forEach((menu) => {
            rememberMenuHome(menu);
            if (isMobileNavViewport()) {
                decorateMobileMenu(menu);
            }
            if (!menu.hasAttribute('aria-hidden')) {
                menu.setAttribute('aria-hidden', menu.classList.contains('show') ? 'false' : 'true');
            }
        });
    }

    window.toggleMobileMenu = toggleMobileMenu;
    window.hmCloseMobileMenus = closeAllMenus;
    window.hmIsMobileNavViewport = isMobileNavViewport;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupMobileMenuToggles);
    } else {
        setupMobileMenuToggles();
    }

    MOBILE_NAV_MQ.addEventListener('change', () => {
        if (!isMobileNavViewport()) {
            closeAllMenus();
        } else {
            document.querySelectorAll(MENU_SELECTOR).forEach(decorateMobileMenu);
        }
    });

    window.addEventListener('resize', () => {
        syncHeaderOffset();
        if (!isMobileNavViewport()) closeAllMenus();
    });

    document.addEventListener('click', (e) => {
        if (!isMobileNavViewport()) return;
        if (Date.now() < suppressOutsideCloseUntil) return;
        if (e.target.closest('.mobile-menu-toggle')) return;

        document.querySelectorAll(`${MENU_SELECTOR}.show`).forEach((menu) => {
            if (!menu.contains(e.target)) {
                setMenuOpen(menu, findToggleForMenu(menu), false);
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' && e.keyCode !== 27) return;
        if (document.querySelector(`${MENU_SELECTOR}.show`)) {
            closeAllMenus();
        }
    });

    document.addEventListener(
        'click',
        (e) => {
            const link = e.target.closest(`${MENU_SELECTOR} a[href]`);
            if (!link) return;
            const menu = link.closest(MENU_SELECTOR);
            if (!menu || !menu.classList.contains('show')) return;

            setMenuOpen(menu, findToggleForMenu(menu), false);
            if (typeof window.hmReleaseScrollLocks === 'function') {
                window.hmReleaseScrollLocks();
            }
        },
        true
    );
})();
