// Saves Google Ads click IDs from the landing URL in a first-party cookie
// so a later paid confirmation page can attach them for attribution.
// Merchant-neutral: no store branding. Does not enable remarketing.
(function () {
    'use strict';

    var COOKIE = 'bo_ad_click';
    var MAX_AGE = 60 * 60 * 24 * 90;
    var KEYS = ['gclid', 'wbraid', 'gbraid'];

    function valid(value) {
        return typeof value === 'string' && /^[A-Za-z0-9._-]{8,300}$/.test(value);
    }

    function conversionBase() {
        var meta = document.querySelector('meta[name="ad-conversion-page"]');
        var fromMeta = meta && meta.getAttribute('content');
        if (fromMeta) return String(fromMeta).replace(/\/+$/, '');
        return location.origin.replace(/\/+$/, '') + '/order-confirmation';
    }

    function read() {
        var match = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
        if (!match) return null;
        var out = {};
        var raw;
        try {
            raw = decodeURIComponent(match[1]);
        } catch (err) {
            return null;
        }
        raw.split('&').forEach(function (part) {
            var eq = part.indexOf('=');
            if (eq < 1) return;
            var key = part.slice(0, eq);
            var value = part.slice(eq + 1);
            if (KEYS.indexOf(key) !== -1 && valid(value)) out[key] = value;
        });
        if (!out.gclid && !out.wbraid && !out.gbraid) return null;
        return out;
    }

    function write(click) {
        var parts = [];
        KEYS.forEach(function (key) {
            if (click[key]) parts.push(key + '=' + click[key]);
        });
        if (!parts.length) return;
        var secure = location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = COOKIE + '=' + encodeURIComponent(parts.join('&'))
            + '; Path=/; Max-Age=' + MAX_AGE + '; SameSite=Lax' + secure;
    }

    function capture() {
        var params;
        try {
            params = new URLSearchParams(window.location.search);
        } catch (err) {
            return;
        }
        var incoming = {};
        var found = false;
        KEYS.forEach(function (key) {
            var value = params.get(key);
            if (valid(value)) {
                incoming[key] = value;
                found = true;
            }
        });
        if (!found) return;
        if (incoming.gclid) {
            write(incoming);
            return;
        }
        var existing = read() || {};
        KEYS.forEach(function (key) {
            if (!existing[key] && incoming[key]) existing[key] = incoming[key];
        });
        write(existing);
    }

    function pageLocationWithClick() {
        var click = read();
        var base = conversionBase();
        if (!click) return base;
        if (click.gclid) return base + '?gclid=' + encodeURIComponent(click.gclid);
        if (click.wbraid) return base + '?wbraid=' + encodeURIComponent(click.wbraid);
        if (click.gbraid) return base + '?gbraid=' + encodeURIComponent(click.gbraid);
        return base;
    }

    window.storeReadAdClick = read;
    window.storeAdClickPageLocation = pageLocationWithClick;
    // Compatibility aliases used by storefront confirmation helpers
    window.hmReadAdClick = read;
    window.hmAdClickPageLocation = pageLocationWithClick;
    capture();
})();
