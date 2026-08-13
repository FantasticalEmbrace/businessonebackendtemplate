// Page Initialization
// Force cart closed immediately and prevent scroll restoration
// CRITICAL: Must run early to prevent scroll issues

(function () {
    'use strict';

    /** Keep cart drawer below sticky header (index has taller top bar). */
    function syncHmHeaderOffset() {
        const header = document.querySelector('.header');
        if (!header) return;
        document.documentElement.style.setProperty(
            '--hm-header-offset',
            `${header.offsetHeight}px`
        );
    }

    function isAgeGateOpen() {
        if (typeof window.hmIsAgeGateOpen === 'function') {
            return window.hmIsAgeGateOpen();
        }
        return !!document.querySelector('.hm-age-gate');
    }

    function resetCartAndScrollLocks() {
        const cartSidebar = document.getElementById('cart-sidebar');
        const cartOverlay = document.getElementById('cart-overlay');
        if (cartSidebar) {
            cartSidebar.classList.remove('show', 'open');
            cartSidebar.setAttribute('aria-hidden', 'true');
        }
        if (cartOverlay) {
            cartOverlay.classList.remove('active');
        }
        if (!isAgeGateOpen()) {
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
        }
        document.documentElement.classList.remove(
            'hm-age-gate-open',
            'hm-await-edsa-scroll',
            'hm-section-scroll-ready',
            'hm-edsa-scroll-ready',
            'edsa-ui-scroll-locked'
        );
        document.body.classList.remove(
            'hm-age-gate-open',
            'auth-modal-open',
            'edsa-modal-open',
            'edsa-ui-scroll-locked',
            'modal-open',
            'no-scroll',
            'cart-open',
            'checkout-nmi-active',
            'hm-mobile-nav-open'
        );
    }

    function isSectionCrossPagePending() {
        if (typeof window.hmIsSectionCrossPagePending === 'function') {
            return window.hmIsSectionCrossPagePending();
        }
        if (typeof window.hmIsEdsaCrossPagePending === 'function') {
            return window.hmIsEdsaCrossPagePending();
        }
        try {
            const stored = sessionStorage.getItem('hmPendingSectionNav');
            if (stored && stored.startsWith('#')) return true;
            return sessionStorage.getItem('hmPendingEdsaNav') === '1';
        } catch (_) {
            return false;
        }
    }

    function isPageReloadNavigation() {
        if (typeof window.hmIsPageReloadNavigation === 'function') {
            return window.hmIsPageReloadNavigation();
        }
        try {
            const nav = performance.getEntriesByType('navigation')[0];
            return nav && nav.type === 'reload';
        } catch (_) {
            return false;
        }
    }

    function scrollToTopIfNoHash() {
        if (isAgeGateOpen()) return;
        if (isPageReloadNavigation()) {
            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
            return;
        }
        if (isSectionCrossPagePending()) return;
        if (!window.location.hash) {
            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
        }
    }

    // Prevent automatic scroll restoration
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }

    // Force scroll to top immediately (before any content loads)
    scrollToTopIfNoHash();

    function releaseAllScrollLocks() {
        if (typeof window.hmReleaseScrollLocks === 'function') {
            window.hmReleaseScrollLocks();
        } else {
            resetCartAndScrollLocks();
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        scrollToTopIfNoHash();
        releaseAllScrollLocks();
        syncHmHeaderOffset();
    });

    if (document.readyState !== 'loading') {
        scrollToTopIfNoHash();
        releaseAllScrollLocks();
        syncHmHeaderOffset();
    }

    window.addEventListener('resize', syncHmHeaderOffset, { passive: true });
    window.addEventListener('load', syncHmHeaderOffset, { passive: true });

    window.addEventListener('pageshow', function () {
        releaseAllScrollLocks();
        syncHmHeaderOffset();
        if (!isAgeGateOpen() && isPageReloadNavigation()) {
            scrollToTopIfNoHash();
        }
    }, { passive: true });

    // Only prevent scroll restoration on initial load, not after real scrolling.
    // Do NOT use { once: true } on scroll: the first event may still be
    // scrollY <= 10 (inertia / tiny move), which would detach the listener
    // before we ever set hasUserScrolled — then `load` could yank scroll back.
    let hasUserScrolled = false;

    function onScroll() {
        if (window.scrollY > 10) {
            hasUserScrolled = true;
            window.removeEventListener('scroll', onScroll);
        }
    }

    window.addEventListener('scroll', onScroll, { passive: true });

    window.addEventListener('load', function () {
        if (isAgeGateOpen()) return;
        if (isPageReloadNavigation()) {
            window.scrollTo(0, 0);
            return;
        }
        if (isSectionCrossPagePending()) return;
        if (!window.location.hash && !hasUserScrolled) {
            window.scrollTo(0, 0);
        }
    }, { passive: true });
})();
