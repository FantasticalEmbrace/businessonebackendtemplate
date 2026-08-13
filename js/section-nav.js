/**
 * Section navigation — EDSA, Contact, About, etc.
 * Bottom-aligned sections (EDSA, Contact) scroll so CTAs sit above the viewport bottom.
 * Cross-page index.html#section links defer scroll until the homepage layout is ready.
 */
(function () {
    'use strict';

    const INDEX_FILES = new Set(['', 'index.html']);
    const EDSA_PENDING_FLAG = 'hmPendingEdsaNav';
    const PENDING_SECTION_KEY = 'hmPendingSectionNav';
    const EDSA_HASH = '#edsa-service';
    const CONTACT_HASH = '#contact';
    const EDSA_FOCUS_ID = 'edsa-nav-target';
    /** Extra space below the contact section when bottom-aligning (px). */
    const CONTACT_BOTTOM_PADDING = 56;

    /** Sections whose bottom edge should align near the viewport bottom. */
    const BOTTOM_ALIGNED = new Set([EDSA_HASH, CONTACT_HASH]);

    function currentPageFile() {
        const name = window.location.pathname.split('/').pop() || '';
        return name || 'index.html';
    }

    function isIndexPage() {
        return INDEX_FILES.has(currentPageFile());
    }

    function parseLink(href) {
        try {
            const url = new URL(href, window.location.href);
            let file = url.pathname.split('/').pop() || 'index.html';
            if (!file) file = 'index.html';
            return { file, hash: url.hash };
        } catch {
            return null;
        }
    }

    function isIndexSectionHref(href) {
        const parsed = parseLink(href);
        if (!parsed || !parsed.hash || parsed.hash.length <= 1) return false;
        return INDEX_FILES.has(parsed.file);
    }

    function isEdsaHash(hash) {
        return hash === EDSA_HASH;
    }

    /** Homepage sections below the spotlight grid — wait for layout before scrolling. */
    function sectionNeedsSpotlightReady(hash) {
        return hash === EDSA_HASH || hash === CONTACT_HASH;
    }

    function getPendingSectionHash() {
        try {
            const stored = sessionStorage.getItem(PENDING_SECTION_KEY);
            if (stored && stored.startsWith('#')) return stored;
            if (sessionStorage.getItem(EDSA_PENDING_FLAG) === '1') return EDSA_HASH;
        } catch (_) {
            /* ignore */
        }
        return '';
    }

    function getTargetSectionHash() {
        const pending = getPendingSectionHash();
        if (pending) return pending;
        const hash = window.location.hash;
        if (hash && hash.length > 1 && resolveSectionTarget(hash)) return hash;
        return '';
    }

    function isSectionCrossPagePending() {
        return getTargetSectionHash().length > 1;
    }

    /** @deprecated Use hmIsSectionCrossPagePending */
    function isEdsaCrossPagePending() {
        return isSectionCrossPagePending();
    }

    function markPendingSection(hash) {
        try {
            sessionStorage.setItem(PENDING_SECTION_KEY, hash);
            if (hash === EDSA_HASH) {
                sessionStorage.setItem(EDSA_PENDING_FLAG, '1');
            }
        } catch (_) {
            /* ignore */
        }
    }

    function clearPendingSection() {
        try {
            sessionStorage.removeItem(PENDING_SECTION_KEY);
            sessionStorage.removeItem(EDSA_PENDING_FLAG);
        } catch (_) {
            /* ignore */
        }
    }

    function isAgeGateOpen() {
        if (typeof window.hmIsAgeGateOpen === 'function') {
            return window.hmIsAgeGateOpen();
        }
        return !!document.querySelector('.hm-age-gate');
    }

    function isPageReloadNavigation() {
        try {
            const nav = performance.getEntriesByType('navigation')[0];
            if (nav && nav.type === 'reload') return true;
        } catch (_) {
            /* ignore */
        }
        return false;
    }

    function whenSafeToAutoScroll(fn) {
        if (isPageReloadNavigation()) return;

        function runAfterAge() {
            if (window.__hmNewsletterPopupDone) {
                fn();
                return;
            }
            let ran = false;
            const runOnce = () => {
                if (ran) return;
                ran = true;
                fn();
            };
            window.addEventListener('hmherbs:newsletter-popup-done', runOnce, { once: true });
            window.setTimeout(runOnce, 12000);
        }

        if (isAgeGateOpen()) {
            window.addEventListener('hmherbs:age-verified', runAfterAge, { once: true });
            return;
        }
        runAfterAge();
    }

    function whenAgeGateAllowsScroll(fn) {
        whenSafeToAutoScroll(fn);
    }

    function releaseScrollLocks() {
        if (!document.body) return;

        if (typeof window.hmCloseMobileMenus === 'function') {
            window.hmCloseMobileMenus();
        } else {
            document
                .querySelectorAll('.nav-menu.show, #nav-menu.show, #navbar-menu.show')
                .forEach((menu) => {
                    menu.classList.remove('show');
                    menu.style.cssText = '';
                    menu.querySelectorAll('li, a').forEach((el) => {
                        el.style.cssText = '';
                    });
                });
            document.querySelectorAll('.mobile-menu-toggle').forEach((toggle) => {
                toggle.setAttribute('aria-expanded', 'false');
            });
        }

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

    function headerOffset() {
        const v = getComputedStyle(document.documentElement).getPropertyValue(
            '--hm-header-offset'
        );
        const parsed = parseFloat(v);
        if (!Number.isNaN(parsed) && parsed > 0) return parsed;
        const header = document.querySelector('.header');
        return header ? header.offsetHeight : 76;
    }

    function resolveEdsaScrollTarget() {
        return (
            document.getElementById(EDSA_FOCUS_ID) ||
            document.getElementById('edsa-book-btn') ||
            document.querySelector('#edsa-service .edsa-text') ||
            document.getElementById('edsa-service')
        );
    }

    function resolveSectionTarget(hash) {
        switch (hash) {
            case EDSA_HASH:
                return resolveEdsaScrollTarget();
            case CONTACT_HASH:
                return (
                    document.getElementById('contact') ||
                    document.querySelector('.contact-cta')
                );
            case '#about':
                return document.getElementById('about');
            case '#home':
                return document.getElementById('home') || document.querySelector('.hero');
            default:
                return document.getElementById(hash.slice(1));
        }
    }

    function scrollElementBottomIntoView(el, bottomPadding) {
        const rect = el.getBoundingClientRect();
        const elTop = rect.top + window.scrollY;
        const elHeight = rect.height || el.offsetHeight;
        const viewport = window.innerHeight;
        const maxScroll = Math.max(
            0,
            document.documentElement.scrollHeight - viewport
        );
        const top = Math.min(
            Math.max(0, elTop + elHeight - viewport + bottomPadding),
            maxScroll
        );
        window.scrollTo({ top, left: 0, behavior: 'auto' });
        return true;
    }

    function scrollToSection(hash) {
        const el = resolveSectionTarget(hash);
        if (!el) return false;

        if (BOTTOM_ALIGNED.has(hash)) {
            const padding = hash === CONTACT_HASH ? CONTACT_BOTTOM_PADDING : 20;
            return scrollElementBottomIntoView(el, padding);
        }

        const top =
            el.getBoundingClientRect().top + window.scrollY - headerOffset() - 12;
        window.scrollTo({ top: Math.max(0, top), left: 0, behavior: 'auto' });
        return true;
    }

    /** @deprecated Use hmScrollToSection */
    function scrollToEdsaSection() {
        return scrollToSection(EDSA_HASH);
    }

    function syncSectionHash(hash) {
        const next = window.location.pathname + window.location.search + hash;
        const current =
            window.location.pathname + window.location.search + window.location.hash;
        if (current !== next) {
            history.replaceState(null, '', next);
        }
    }

    function handleIndexSectionClick(e, href) {
        const parsed = parseLink(href);
        if (!parsed || !parsed.hash || parsed.hash.length <= 1) return;
        if (!resolveSectionTarget(parsed.hash)) return;

        e.preventDefault();
        releaseScrollLocks();
        syncSectionHash(parsed.hash);
        if (typeof window.hmApplyNavCurrentPage === 'function') {
            window.hmApplyNavCurrentPage(parsed.hash);
        }
        scrollToSection(parsed.hash);
    }

    function handleCrossPageSectionClick(e, parsed) {
        e.preventDefault();
        markPendingSection(parsed.hash);
        releaseScrollLocks();
        document.documentElement.classList.add('hm-await-edsa-scroll');
        window.location.assign(parsed.file + parsed.hash);
    }

    function initClickDelegation() {
        document.addEventListener(
            'click',
            (e) => {
                const link = e.target.closest('a[href]');
                if (!link) return;
                const href = link.getAttribute('href');
                if (!href || href === '#') return;
                const parsed = parseLink(href);
                if (!parsed) return;

                if (!isIndexPage() && isIndexSectionHref(href)) {
                    handleCrossPageSectionClick(e, parsed);
                    return;
                }

                if (isIndexPage() && isIndexSectionHref(href)) {
                    handleIndexSectionClick(e, href);
                }
            },
            true
        );
    }

    let sectionScrollStarted = false;

    function scheduleSectionScroll(hash) {
        if (sectionScrollStarted || !isIndexPage()) return;
        if (!hash || !resolveSectionTarget(hash)) return;
        sectionScrollStarted = true;

        const doScroll = () => {
            clearPendingSection();
            releaseScrollLocks();
            syncSectionHash(hash);
            if (typeof window.hmApplyNavCurrentPage === 'function') {
                window.hmApplyNavCurrentPage(hash);
            }
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    scrollToSection(hash);
                    document.documentElement.classList.remove('hm-await-edsa-scroll');
                    document.documentElement.classList.add('hm-section-scroll-ready');
                });
            });
        };

        const runAfterPopups = () => whenSafeToAutoScroll(doScroll);

        if (sectionNeedsSpotlightReady(hash)) {
            let done = false;
            const runOnce = () => {
                if (done) return;
                done = true;
                runAfterPopups();
            };
            window.addEventListener('hmSpotlightReady', runOnce, { once: true });
            if (document.readyState === 'complete') {
                window.setTimeout(runOnce, 200);
            } else {
                window.addEventListener('load', () => window.setTimeout(runOnce, 200), { once: true });
            }
            window.setTimeout(runOnce, 1200);
            return;
        }

        if (document.readyState === 'complete') {
            runAfterPopups();
        } else {
            window.addEventListener('load', runAfterPopups, { once: true });
        }
    }

    function completeCrossPageSectionNav() {
        scheduleSectionScroll(getTargetSectionHash());
    }

    /** @deprecated Use hmCompleteCrossPageSectionNav */
    function completeEdsaCrossPageNav() {
        completeCrossPageSectionNav();
    }

    function initCrossPageSectionLanding() {
        if (!isIndexPage()) return;
        if (isPageReloadNavigation()) return;

        const hash = getTargetSectionHash();
        if (!hash) return;

        document.documentElement.classList.add('hm-await-edsa-scroll');
        scheduleSectionScroll(hash);
    }

    function initHashLanding() {
        if (!isIndexPage() || isPageReloadNavigation()) return;
        if (sectionScrollStarted) return;

        const hash = window.location.hash;
        if (!hash || hash.length <= 1) return;
        if (!resolveSectionTarget(hash)) return;

        document.documentElement.classList.add('hm-await-edsa-scroll');
        scheduleSectionScroll(hash);
    }

    function init() {
        if ('scrollRestoration' in history) {
            history.scrollRestoration = 'manual';
        }

        if (isPageReloadNavigation() && isIndexPage()) {
            clearPendingSection();
            document.documentElement.classList.remove(
                'hm-await-edsa-scroll',
                'hm-section-scroll-ready',
                'hm-edsa-scroll-ready'
            );
            try {
                if (window.location.hash) {
                    history.replaceState(
                        null,
                        '',
                        window.location.pathname + window.location.search
                    );
                }
            } catch (_) {
                /* ignore */
            }
        }

        window.hmReleaseScrollLocks = releaseScrollLocks;
        window.hmScrollToSection = scrollToSection;
        window.hmScrollToEdsaSection = scrollToEdsaSection;
        window.hmIsSectionCrossPagePending = isSectionCrossPagePending;
        window.hmIsEdsaCrossPagePending = isEdsaCrossPagePending;
        window.hmCompleteCrossPageSectionNav = completeCrossPageSectionNav;
        window.hmCompleteEdsaCrossPageNav = completeEdsaCrossPageNav;
        window.hmIsPageReloadNavigation = isPageReloadNavigation;

        initClickDelegation();

        const runOnReady = () => {
            releaseScrollLocks();
            initCrossPageSectionLanding();
            initHashLanding();
        };
        if (document.body) {
            runOnReady();
        } else {
            document.addEventListener('DOMContentLoaded', runOnReady, { once: true });
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                initCrossPageSectionLanding();
                initHashLanding();
            }, { once: true });
        }

        window.addEventListener('load', initHashLanding, { once: true });
    }

    init();
})();
