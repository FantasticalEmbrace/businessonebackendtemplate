'use strict';

/** MySQL2 rejects `undefined` bind values — use SQL NULL via `null`. */
function normalizeCartUserId(userId) {
    if (userId == null || userId === '') return null;
    const n = Number(userId);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeCartSessionId(sessionId) {
    if (sessionId == null || sessionId === '') return null;
    const s = String(sessionId).trim();
    return s || null;
}

function normalizeVariantId(variantId) {
    if (variantId == null || variantId === '') return null;
    const n = Number(variantId);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function cartLookupBinds(userId, sessionId) {
    return [normalizeCartUserId(userId), normalizeCartSessionId(sessionId)];
}

function hasCartIdentity(userId, sessionId) {
    const [uid, sid] = cartLookupBinds(userId, sessionId);
    return Boolean(uid || sid);
}

module.exports = {
    normalizeCartUserId,
    normalizeCartSessionId,
    normalizeVariantId,
    cartLookupBinds,
    hasCartIdentity
};
