'use strict';

/** In-process payment idempotency (single-node Linode). TTL 5 minutes. */
const TTL_MS = 5 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 4000;

const byKey = new Map();
const recentByOrder = new Map();

function prune(map) {
    const now = Date.now();
    for (const [k, v] of map.entries()) {
        if (now - v.at > TTL_MS) map.delete(k);
    }
}

/**
 * @returns {{ duplicate: boolean, inFlight?: boolean, tooSoon?: boolean, cached?: object, token?: symbol }}
 */
function beginPaymentAttempt(orderId, idempotencyKey) {
    prune(byKey);
    prune(recentByOrder);

    const oid = Number(orderId);
    const key = String(idempotencyKey || '').trim();
    const now = Date.now();

    if (key) {
        const cached = byKey.get(key);
        if (cached && cached.orderId === oid) {
            if (cached.status === 'in_flight') {
                return { duplicate: true, inFlight: true };
            }
            if (cached.response) {
                return { duplicate: true, cached: cached.response };
            }
        }
    }

    const recent = recentByOrder.get(oid);
    if (recent && recent.status === 'in_flight' && now - recent.at < DUPLICATE_WINDOW_MS) {
        if (!key || recent.key !== key) {
            return { duplicate: true, inFlight: true, tooSoon: true };
        }
    }

    const token = Symbol('payment-attempt');
    const slot = { at: now, key, status: 'in_flight', response: null, token };
    recentByOrder.set(oid, slot);
    if (key) {
        byKey.set(key, { at: now, orderId: oid, status: 'in_flight', response: null, token });
    }
    return { duplicate: false, token, key };
}

function completePaymentAttempt(orderId, idempotencyKey, token, response) {
    const oid = Number(orderId);
    const key = String(idempotencyKey || '').trim();
    const payload = response && typeof response === 'object' ? { ...response } : { success: true };

    const recent = recentByOrder.get(oid);
    if (recent && recent.token === token) {
        recent.status = 'complete';
        recent.response = payload;
        recent.at = Date.now();
    }

    if (key) {
        const cached = byKey.get(key);
        if (cached && cached.token === token) {
            cached.status = 'complete';
            cached.response = payload;
            cached.at = Date.now();
        }
    }
}

function failPaymentAttempt(orderId, idempotencyKey, token) {
    const oid = Number(orderId);
    const key = String(idempotencyKey || '').trim();

    const recent = recentByOrder.get(oid);
    if (recent && recent.token === token) {
        recentByOrder.delete(oid);
    }
    if (key) {
        const cached = byKey.get(key);
        if (cached && cached.token === token) {
            byKey.delete(key);
        }
    }
}

function resetPaymentIdempotencyForTests() {
    byKey.clear();
    recentByOrder.clear();
}

module.exports = {
    beginPaymentAttempt,
    completePaymentAttempt,
    failPaymentAttempt,
    resetPaymentIdempotencyForTests,
};
