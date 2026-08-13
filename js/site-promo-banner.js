/**
 * Loads admin-configured site promo banner from /api/promo-banner
 * and injects a bar below the skip link.
 */
(function () {
    const STORAGE_KEY = 'hmherbs_promo_dismissed';

    function getApiOrigin() {
        if (window.location.protocol === 'file:') return 'http://localhost:3001';
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            if (window.location.port === '3001') return '';
            return 'http://localhost:3001';
        }
        return '';
    }

    function resolveAssetUrl(assetPath) {
        if (!assetPath || typeof assetPath !== 'string') return null;
        if (!assetPath.startsWith('/')) return null;
        const origin = getApiOrigin();
        return origin ? `${origin}${assetPath}` : assetPath;
    }

    function safeUrl(href) {
        if (!href) return null;
        try {
            const u = new URL(href, window.location.origin);
            if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
        } catch (_) {}
        return null;
    }

    function renderBanner(data) {
        if (!data || !data.enabled || !data.headline) return;
        if (sessionStorage.getItem(STORAGE_KEY) === '1') return;

        const bar = document.createElement('div');
        bar.className = 'site-promo-banner';
        bar.setAttribute('data-preset', data.preset || 'sale');
        bar.setAttribute('role', 'region');
        bar.setAttribute('aria-label', 'Store promotion');

        if (data.preset === 'custom') {
            bar.style.setProperty('--promo-bg', data.customBg || '#047857');
            bar.style.setProperty('--promo-text', data.customText || '#ffffff');
            bar.style.setProperty('--promo-accent', data.customAccent || '#d4af37');
        }

        const inner = document.createElement('div');
        inner.className = 'site-promo-banner__inner';

        const iconSrc = resolveAssetUrl(data.iconUrl);
        if (iconSrc) {
            const iconImg = document.createElement('img');
            iconImg.className = 'site-promo-banner__icon-img';
            iconImg.src = iconSrc;
            iconImg.alt = '';
            iconImg.setAttribute('loading', 'lazy');
            iconImg.decoding = 'async';
            inner.appendChild(iconImg);
        } else if (data.icon) {
            const icon = document.createElement('span');
            icon.className = 'site-promo-banner__icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = data.icon;
            inner.appendChild(icon);
        }

        const textWrap = document.createElement('div');
        textWrap.className = 'site-promo-banner__text';

        const head = document.createElement('strong');
        head.className = 'site-promo-banner__headline';
        head.textContent = data.headline;
        textWrap.appendChild(head);

        if (data.subline) {
            const sub = document.createElement('span');
            sub.className = 'site-promo-banner__subline';
            sub.textContent = data.subline;
            textWrap.appendChild(sub);
        }

        inner.appendChild(textWrap);

        const linkHref = safeUrl(data.linkUrl);
        if (linkHref) {
            const a = document.createElement('a');
            a.className = 'site-promo-banner__cta';
            a.href = linkHref;
            const lbl = String(data.linkLabel || '').trim();
            a.textContent = lbl || 'Learn more';
            a.rel = 'noopener noreferrer';
            if (/^https?:/i.test(linkHref) && !linkHref.startsWith(window.location.origin)) {
                a.target = '_blank';
            }
            inner.appendChild(a);
        }

        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'site-promo-banner__dismiss';
        dismiss.setAttribute('aria-label', 'Dismiss promotion');
        dismiss.textContent = '\u00d7';
        dismiss.addEventListener('click', () => {
            sessionStorage.setItem(STORAGE_KEY, '1');
            bar.remove();
        });
        inner.appendChild(dismiss);

        bar.appendChild(inner);

        const skip = document.querySelector('a.skip-link');
        if (skip && skip.parentNode) {
            skip.parentNode.insertBefore(bar, skip.nextSibling);
        } else {
            document.body.insertBefore(bar, document.body.firstChild);
        }
    }

    async function init() {
        const origin = getApiOrigin();
        const url = origin ? `${origin}/api/promo-banner` : '/api/promo-banner';
        try {
            const res = await fetch(url, { credentials: 'same-origin' });
            if (!res.ok) return;
            const json = await res.json();
            if (json && json.banner) renderBanner(json.banner);
        } catch (_) {
            /* non-fatal */
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
