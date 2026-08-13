'use strict';

/**
 * Placeholder so the API server can start when the full scraper script
 * is not present locally. Admin scrape endpoints will return a clear error.
 */
class HMHerbsScraper {
    constructor(onProgress) {
        this.onProgress = typeof onProgress === 'function' ? onProgress : null;
    }

    async scrape() {
        throw new Error('HM Herbs catalog scraper is not available in this environment.');
    }
}

module.exports = HMHerbsScraper;
