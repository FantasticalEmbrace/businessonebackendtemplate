'use strict';

/** Tracks one in-flight HM Herbs product scrape for admin cancel + SSE cleanup. */
let active = null;

function registerScraper(scraper, res) {
    active = { scraper, res };
}

function clearActive() {
    active = null;
}

function cancelActive(reason = 'Cancelled') {
    if (!active?.scraper) return false;
    const { scraper, res } = active;
    scraper._cancelled = true;
    scraper._cancelReason = String(reason || 'Cancelled');
    if (typeof scraper.cancel === 'function') {
        try {
            scraper.cancel(reason);
        } catch {
            /* ignore */
        }
    }
    if (res && !res.writableEnded && !res.destroyed) {
        try {
            res.end();
        } catch {
            /* ignore */
        }
    }
    return true;
}

module.exports = {
    registerScraper,
    clearActive,
    cancelActive,
};
