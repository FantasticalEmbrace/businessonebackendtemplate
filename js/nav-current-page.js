/**
 * Marks the matching header nav link with aria-current="page" on every page.
 * Section scrolling is handled by js/section-nav.js (do not add hash scroll logic here).
 */
(function () {
    'use strict';

    function currentPageFile() {
        const name = window.location.pathname.split('/').pop() || '';
        if (!name) return 'index.html';
        return name;
    }

    function isIndexPage() {
        const f = currentPageFile();
        return f === 'index.html' || f === '';
    }

    function linkTarget(href) {
        try {
            const url = new URL(href, window.location.href);
            let file = url.pathname.split('/').pop() || 'index.html';
            if (!file) file = 'index.html';
            return { file, hash: url.hash };
        } catch {
            return null;
        }
    }

    function isHomeLink(href) {
        if (!href) return false;
        if (href === '#home') return true;
        const target = linkTarget(href);
        if (!target) return false;
        return target.file === 'index.html' && target.hash === '#home';
    }

    function isNavLinkActive(href, curFile, curHash) {
        if (!href || href === '#') return false;

        const target = linkTarget(href);
        if (!target) return false;

        if (
            target.file === 'products.html' &&
            (curFile === 'products.html' || curFile === 'product.html') &&
            !target.hash
        ) {
            return true;
        }

        if (target.file !== curFile) return false;

        if (target.hash) {
            return curHash === target.hash;
        }

        if (curHash) return false;

        return true;
    }

    function applyNavCurrentPage(overrideHash) {
        const links = document.querySelectorAll(
            '.nav-menu a[href], #nav-menu a[href], #navbar-menu a[href]'
        );
        if (!links.length) return;

        const curFile = currentPageFile();
        const curHash =
            typeof overrideHash === 'string' ? overrideHash : window.location.hash;
        const onIndex = isIndexPage();

        links.forEach((link) => {
            const href = link.getAttribute('href');
            let active = href ? isNavLinkActive(href, curFile, curHash) : false;

            if (onIndex && isHomeLink(href) && (curHash === '' || curHash === '#home')) {
                active = true;
            }

            if (active) {
                link.setAttribute('aria-current', 'page');
            } else {
                link.removeAttribute('aria-current');
            }
        });
    }

    function syncUrlHash(hashHref) {
        if (!hashHref || !hashHref.startsWith('#')) return;
        const next = window.location.pathname + window.location.search + hashHref;
        const current =
            window.location.pathname + window.location.search + window.location.hash;
        if (current !== next) {
            history.replaceState(null, '', next);
        }
    }

    function init() {
        applyNavCurrentPage();

        window.addEventListener('hashchange', () => {
            applyNavCurrentPage();
        });

        document.addEventListener(
            'click',
            (e) => {
                const link = e.target.closest(
                    '.nav-menu a[href], #nav-menu a[href], #navbar-menu a[href]'
                );
                if (!link) return;

                const href = link.getAttribute('href');
                if (!href || !href.startsWith('#') || href.length <= 1) return;
                if (!isIndexPage()) return;

                syncUrlHash(href);
                applyNavCurrentPage(href);
            },
            true
        );
    }

    window.hmApplyNavCurrentPage = applyNavCurrentPage;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
