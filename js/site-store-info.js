/**
 * Loads store hours from /api/store-info (same admin settings pushed to Google).
 * Footers show regular Mon-Fri / Sat hours only — never holiday lines.
 */
(function () {
    const DEFAULT_LINES = ['Mon-Fri: 10am-5pm', 'Sat: 10am-1pm'];

    function getApiOrigin() {
        if (window.location.protocol === 'file:') return 'http://localhost:3001';
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            if (window.location.port === '3001') return '';
            return 'http://localhost:3001';
        }
        return '';
    }

    function linesFromPayload(data) {
        const weekdays = String(data?.hours?.weekdays || '').trim();
        const saturday = String(data?.hours?.saturday || '').trim();
        if (weekdays || saturday) {
            return [weekdays, saturday].filter(Boolean);
        }

        if (Array.isArray(data?.footerLines) && data.footerLines.length) {
            return data.footerLines
                .map((line) => String(line).trim())
                .filter(Boolean)
                .filter((line) => !/^holiday\b/i.test(line) && !/^sun(?:day)?\b/i.test(line));
        }

        return DEFAULT_LINES.slice();
    }

    function applyFooterHours(lines) {
        document.querySelectorAll('.footer-hours').forEach((container) => {
            container.innerHTML = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
        });
        document.querySelectorAll('.call-store-hours').forEach((el) => {
            el.innerHTML = lines.map((line) => escapeHtml(line)).join('<br>');
        });
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatMoney(n) {
        const v = Number(n);
        if (!Number.isFinite(v) || v < 0) return '';
        return `$${v.toFixed(2)}`;
    }

    function applyShippingRates(data) {
        const ship = data && data.shipping;
        if (!ship) return;
        const threshold = formatMoney(ship.freeShippingThreshold);
        const flat = formatMoney(ship.firstClassRate);
        if (threshold) {
            document.querySelectorAll('[data-ship-threshold]').forEach((el) => {
                el.textContent = threshold;
            });
        }
        if (flat) {
            document.querySelectorAll('[data-ship-flat]').forEach((el) => {
                el.textContent = flat;
            });
        }
    }

    let cachedPromise = null;

    function fetchStoreInfo() {
        if (!cachedPromise) {
            const origin = getApiOrigin();
            const url = origin ? `${origin}/api/store-info` : '/api/store-info';
            cachedPromise = fetch(url, { credentials: 'same-origin' })
                .then((res) => (res.ok ? res.json() : null))
                .catch(() => null);
        }
        return cachedPromise;
    }

    window.BO_getStoreHourLines = async function getStoreHourLines() {
        const data = await fetchStoreInfo();
        return linesFromPayload(data);
    };
    // Legacy alias kept for older storefront callers.
    window.HMHERBS_getStoreHourLines = window.BO_getStoreHourLines;

    async function init() {
        const data = await fetchStoreInfo();
        applyFooterHours(linesFromPayload(data));
        applyShippingRates(data);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
