'use strict';

/**
 * Race a promise against a timeout. Rejects with Error(`${label} timed out`) on expiry.
 */
function withTimeout(promise, ms, label = 'operation') {
    const timeoutMs = Number(ms);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
        return promise;
    }
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        })
    ]);
}

module.exports = { withTimeout };
