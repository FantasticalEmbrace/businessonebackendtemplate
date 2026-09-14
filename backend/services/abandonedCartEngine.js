'use strict';

const logger = require('../utils/logger');
const { isValidCustomerEmail } = require('../utils/customerEmail');
const {
    roundMoney,
    normalizeEmail,
    delayToMs,
    matchesSubtotalThreshold,
    getMasterEnabled,
    listPrograms,
} = require('./abandonedCartPrograms');
const { sendAbandonedCartEmail } = require('./abandonedCartEmail');

const MAX_SNAPSHOT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FREQUENCY_CAP_MAX_SENDS = 3;
const FREQUENCY_CAP_WINDOW_DAYS = 7;

function parseCartJson(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    if (raw && typeof raw === 'object') return Array.isArray(raw) ? raw : [];
    return [];
}

function normalizeCartItems(cartItems) {
    return (cartItems || [])
        .map((item) => ({
            product_id: Number(item.product_id ?? item.productId ?? item.id) || null,
            variant_id: Number(item.variant_id ?? item.variantId) || null,
            name: String(item.name || 'Item').trim(),
            price: roundMoney(item.price ?? 0),
            quantity: Math.max(1, parseInt(item.quantity, 10) || 1),
            slug: item.slug ? String(item.slug) : null,
        }))
        .filter((item) => item.product_id && item.name);
}

function computeSubtotal(items) {
    return roundMoney(
        items.reduce((sum, item) => sum + roundMoney(item.price) * item.quantity, 0)
    );
}

async function supersedeConflictingSnapshots(pool, { userId, sessionId, email }) {
    const ids = new Set();

    if (userId) {
        const [rows] = await pool.execute(
            `SELECT id FROM abandoned_cart_snapshots
              WHERE status = 'active' AND user_id = ? AND email <> ?`,
            [userId, email]
        );
        for (const row of rows) ids.add(row.id);
    }

    if (sessionId) {
        const [rows] = await pool.execute(
            `SELECT id FROM abandoned_cart_snapshots
              WHERE status = 'active' AND session_id = ? AND email <> ?`,
            [sessionId, email]
        );
        for (const row of rows) ids.add(row.id);
    }

    const localPart = email.split('@')[0];
    if (localPart) {
        const [candidates] = await pool.execute(
            `SELECT id, email FROM abandoned_cart_snapshots
              WHERE status = 'active' AND email <> ? AND email LIKE ?`,
            [email, `${localPart}@%`]
        );
        for (const row of candidates) {
            if (!isValidCustomerEmail(row.email)) ids.add(row.id);
        }
    }

    if (!ids.size) return;
    const idList = [...ids];
    await pool.execute(
        `UPDATE abandoned_cart_snapshots
            SET status = 'suppressed', converted_at = NOW()
          WHERE id IN (${idList.map(() => '?').join(',')})`,
        idList
    );
}

async function recordSendAttempt(
    pool,
    { programId, snapshotId, email, row, subtotal, status, failureReason = null }
) {
    await pool.execute(
        `INSERT INTO abandoned_cart_sends (
            program_id, snapshot_id, email, send_status, failure_reason,
            promo_code, discount_type, discount_value, subtotal_at_send
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            programId,
            snapshotId,
            email,
            status,
            failureReason ? String(failureReason).slice(0, 255) : null,
            row.promo_code,
            row.discount_type,
            row.discount_value,
            subtotal,
        ]
    );
}

async function upsertSnapshot(pool, { userId, sessionId, email, firstName, cartItems }) {
    const normalized = normalizeEmail(email);
    const items = normalizeCartItems(cartItems);
    if (!normalized || !items.length) return null;

    const sid = sessionId ? String(sessionId).trim().slice(0, 64) : null;
    const subtotal = computeSubtotal(items);
    const now = new Date();
    const cartJson = JSON.stringify(items);
    const uid = userId && Number.isInteger(Number(userId)) ? Number(userId) : null;

    await supersedeConflictingSnapshots(pool, {
        userId: uid,
        sessionId: sid,
        email: normalized,
    });

    const [existing] = await pool.execute(
        `SELECT id FROM abandoned_cart_snapshots
          WHERE email = ? AND status = 'active'
          ORDER BY last_activity_at DESC LIMIT 1`,
        [normalized]
    );

    if (existing.length) {
        await pool.execute(
            `UPDATE abandoned_cart_snapshots SET
                user_id = COALESCE(?, user_id),
                session_id = COALESCE(?, session_id),
                first_name = COALESCE(?, first_name),
                cart_json = ?,
                subtotal = ?,
                last_activity_at = ?
             WHERE id = ?`,
            [
                uid,
                sid,
                firstName ? String(firstName).trim().slice(0, 120) : null,
                cartJson,
                subtotal,
                now,
                existing[0].id,
            ]
        );
        return existing[0].id;
    }

    const [result] = await pool.execute(
        `INSERT INTO abandoned_cart_snapshots (
            user_id, session_id, email, first_name, cart_json, subtotal, abandoned_at, last_activity_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
        [
            uid,
            sid,
            normalized,
            firstName ? String(firstName).trim().slice(0, 120) : null,
            cartJson,
            subtotal,
            now,
            now,
        ]
    );
    return result.insertId;
}

async function markSnapshotsConvertedForEmail(pool, email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return;
    await pool.execute(
        `UPDATE abandoned_cart_snapshots
            SET status = 'converted', converted_at = NOW()
          WHERE email = ? AND status = 'active'`,
        [normalized]
    );
}

async function suppressActiveSnapshots(pool, { userId = null, sessionId = null, email = null } = {}) {
    const normalized = email ? normalizeEmail(email) : null;
    const uid = userId && Number.isInteger(Number(userId)) ? Number(userId) : null;
    const sid = sessionId ? String(sessionId).trim().slice(0, 64) : null;

    const conditions = [];
    const params = [];
    if (normalized) {
        conditions.push('email = ?');
        params.push(normalized);
    }
    if (uid) {
        conditions.push('user_id = ?');
        params.push(uid);
    }
    if (sid) {
        conditions.push('session_id = ?');
        params.push(sid);
    }
    if (!conditions.length) return 0;

    const [result] = await pool.execute(
        `UPDATE abandoned_cart_snapshots
            SET status = 'suppressed', converted_at = NOW()
          WHERE status = 'active' AND (${conditions.join(' OR ')})`,
        params
    );
    return result.affectedRows || 0;
}

function snapshotHasAbandonableCart(snapshot) {
    if (Number(snapshot.subtotal) <= 0) return false;
    const cartItems = parseCartJson(snapshot.cart_json);
    return normalizeCartItems(cartItems).length > 0;
}

function isSnapshotTooOld(snapshot, nowMs = Date.now()) {
    const activityAt = new Date(snapshot.last_activity_at).getTime();
    if (!Number.isFinite(activityAt)) return true;
    return nowMs - activityAt > MAX_SNAPSHOT_AGE_MS;
}

async function countRecentSuccessfulSends(pool, email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return 0;
    const [rows] = await pool.execute(
        `SELECT COUNT(*) AS n FROM abandoned_cart_sends
          WHERE LOWER(email) = ? AND send_status = 'sent'
            AND sent_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [normalized, FREQUENCY_CAP_WINDOW_DAYS]
    );
    return Number(rows[0]?.n) || 0;
}

async function loadProductPricing(pool, productIds, variantIds) {
    const pids = [...new Set(productIds.filter(Boolean))];
    const vids = [...new Set(variantIds.filter(Boolean))];
    const products = new Map();
    const variants = new Map();

    if (pids.length) {
        const placeholders = pids.map(() => '?').join(',');
        const [rows] = await pool.execute(
            `SELECT id, name, price, compare_price, slug FROM products WHERE id IN (${placeholders})`,
            pids
        );
        for (const row of rows) products.set(row.id, row);
    }

    if (vids.length) {
        const placeholders = vids.map(() => '?').join(',');
        const [rows] = await pool.execute(
            `SELECT id, product_id, price, compare_price FROM product_variants WHERE id IN (${placeholders})`,
            vids
        );
        for (const row of rows) variants.set(row.id, row);
    }

    return { products, variants };
}

function resolveCurrentPrice(item, { products, variants }) {
    if (item.variant_id && variants.has(item.variant_id)) {
        const v = variants.get(item.variant_id);
        return {
            price: roundMoney(v.price),
            comparePrice: v.compare_price != null ? roundMoney(v.compare_price) : null,
            name: item.name,
        };
    }
    if (item.product_id && products.has(item.product_id)) {
        const p = products.get(item.product_id);
        return {
            price: roundMoney(p.price),
            comparePrice: p.compare_price != null ? roundMoney(p.compare_price) : null,
            name: p.name || item.name,
        };
    }
    return { price: roundMoney(item.price), comparePrice: null, name: item.name };
}

function detectSaleItems(cartItems, pricingMaps) {
    const saleItems = [];
    for (const item of cartItems) {
        const current = resolveCurrentPrice(item, pricingMaps);
        const cartPrice = roundMoney(item.price);
        const priceDrop = current.price < cartPrice - 0.001;
        const onSaleNow =
            current.comparePrice != null && current.comparePrice > current.price + 0.001;
        if (priceDrop || onSaleNow) {
            saleItems.push({
                name: current.name,
                currentPrice: current.price,
                wasPrice: priceDrop ? cartPrice : current.comparePrice,
            });
        }
    }
    return saleItems;
}

async function customerAllowsEmail(pool, snapshot) {
    if (!snapshot.user_id) return true;
    const [rows] = await pool.execute(
        'SELECT marketing_email_opt_in FROM users WHERE id = ? LIMIT 1',
        [snapshot.user_id]
    );
    return rows[0] ? Boolean(rows[0].marketing_email_opt_in) : true;
}

async function hasPaidOrderSince(pool, email, sinceDate) {
    const [rows] = await pool.execute(
        `SELECT id FROM orders
          WHERE LOWER(email) = ? AND payment_status = 'paid' AND created_at >= ?
          LIMIT 1`,
        [email, sinceDate]
    );
    return rows.length > 0;
}

function programRowForMatch(program) {
    return {
        id: program.id,
        min_subtotal: program.minSubtotal ?? program.min_subtotal,
        max_subtotal: program.maxSubtotal ?? program.max_subtotal,
        delay_value: program.delayValue ?? program.delay_value,
        delay_unit: program.delayUnit ?? program.delay_unit,
        trigger_type: program.triggerType ?? program.trigger_type,
        discount_type: program.discountType ?? program.discount_type,
        discount_value: program.discountValue ?? program.discount_value,
        promo_code: program.promoCode ?? program.promo_code,
        email_subject: program.emailSubject ?? program.email_subject,
        email_intro: program.emailIntro ?? program.email_intro,
        require_marketing_opt_in: program.requireMarketingOptIn ?? program.require_marketing_opt_in,
    };
}

function isProgramDue(program, snapshot, nowMs, saleItems) {
    const row = programRowForMatch(program);
    if (!matchesSubtotalThreshold(row, snapshot.subtotal)) return false;

    const activityAt = new Date(snapshot.last_activity_at).getTime();
    const dueAt = activityAt + delayToMs(row);
    if (nowMs < dueAt) return false;

    if (row.trigger_type === 'item_on_sale') {
        return saleItems.length > 0;
    }
    return true;
}

async function processAbandonedCartEmails(pool, { dryRun = false } = {}) {
    const enabled = await getMasterEnabled(pool);
    if (!enabled) return { skipped: true, reason: 'master_disabled', sent: 0 };

    const programs = (await listPrograms(pool)).filter((p) => p.isActive);
    if (!programs.length) return { skipped: true, reason: 'no_active_programs', sent: 0 };

    const [snapshots] = await pool.execute(
        `SELECT * FROM abandoned_cart_snapshots
          WHERE status = 'active'
          ORDER BY last_activity_at ASC
          LIMIT 200`
    );

    const nowMs = Date.now();
    let sent = 0;
    const errors = [];

    for (const snapshot of snapshots) {
        if (!snapshotHasAbandonableCart(snapshot)) {
            if (!dryRun) {
                await pool.execute(
                    `UPDATE abandoned_cart_snapshots SET status = 'suppressed', converted_at = NOW() WHERE id = ?`,
                    [snapshot.id]
                );
            }
            continue;
        }

        if (isSnapshotTooOld(snapshot, nowMs)) {
            if (!dryRun) {
                await pool.execute(
                    `UPDATE abandoned_cart_snapshots SET status = 'suppressed', converted_at = NOW() WHERE id = ?`,
                    [snapshot.id]
                );
            }
            continue;
        }

        const cartItems = parseCartJson(snapshot.cart_json);

        if (await hasPaidOrderSince(pool, snapshot.email, snapshot.abandoned_at)) {
            if (!dryRun) {
                await pool.execute(
                    `UPDATE abandoned_cart_snapshots SET status = 'converted', converted_at = NOW() WHERE id = ?`,
                    [snapshot.id]
                );
            }
            continue;
        }

        const productIds = cartItems.map((i) => i.product_id);
        const variantIds = cartItems.map((i) => i.variant_id);
        const pricingMaps = await loadProductPricing(pool, productIds, variantIds);
        const saleItems = detectSaleItems(cartItems, pricingMaps);
        const recentSendCount = await countRecentSuccessfulSends(pool, snapshot.email);
        const frequencyCapped = recentSendCount >= FREQUENCY_CAP_MAX_SENDS;

        for (const program of programs) {
            if (frequencyCapped) continue;
            const row = programRowForMatch(program);
            if (row.require_marketing_opt_in && !(await customerAllowsEmail(pool, snapshot))) {
                continue;
            }

            const [already] = await pool.execute(
                'SELECT id FROM abandoned_cart_sends WHERE program_id = ? AND snapshot_id = ? LIMIT 1',
                [program.id, snapshot.id]
            );
            if (already.length) continue;

            if (!isProgramDue(program, snapshot, nowMs, saleItems)) continue;

            const payload = {
                email: snapshot.email,
                firstName: snapshot.first_name,
                subtotal: Number(snapshot.subtotal),
                cartItems,
            };

            if (dryRun) {
                sent += 1;
                continue;
            }

            try {
                const result = await sendAbandonedCartEmail({
                    program,
                    snapshot: payload,
                    saleItems: row.trigger_type === 'item_on_sale' ? saleItems : [],
                    pool,
                });
                if (!result.sent) {
                    await recordSendAttempt(pool, {
                        programId: program.id,
                        snapshotId: snapshot.id,
                        email: snapshot.email,
                        row,
                        subtotal: snapshot.subtotal,
                        status: 'failed',
                        failureReason: result.reason || 'send_failed',
                    });
                    errors.push({ snapshotId: snapshot.id, programId: program.id, reason: result.reason });
                    continue;
                }
                await recordSendAttempt(pool, {
                    programId: program.id,
                    snapshotId: snapshot.id,
                    email: snapshot.email,
                    row,
                    subtotal: snapshot.subtotal,
                    status: 'sent',
                });
                sent += 1;
            } catch (err) {
                logger.error('[abandoned-cart] send failed', {
                    snapshotId: snapshot.id,
                    programId: program.id,
                    message: err.message,
                });
                try {
                    await recordSendAttempt(pool, {
                        programId: program.id,
                        snapshotId: snapshot.id,
                        email: snapshot.email,
                        row,
                        subtotal: snapshot.subtotal,
                        status: 'failed',
                        failureReason: err.message,
                    });
                } catch (recordErr) {
                    logger.error('[abandoned-cart] failed to record send attempt', {
                        snapshotId: snapshot.id,
                        message: recordErr.message,
                    });
                }
                errors.push({ snapshotId: snapshot.id, programId: program.id, reason: err.message });
            }
        }
    }

    return { sent, errors, programs: programs.length, snapshots: snapshots.length };
}

module.exports = {
    MAX_SNAPSHOT_AGE_MS,
    FREQUENCY_CAP_MAX_SENDS,
    FREQUENCY_CAP_WINDOW_DAYS,
    normalizeCartItems,
    computeSubtotal,
    upsertSnapshot,
    supersedeConflictingSnapshots,
    recordSendAttempt,
    markSnapshotsConvertedForEmail,
    suppressActiveSnapshots,
    snapshotHasAbandonableCart,
    isSnapshotTooOld,
    countRecentSuccessfulSends,
    detectSaleItems,
    matchesSubtotalThreshold,
    delayToMs,
    isProgramDue,
    processAbandonedCartEmails,
};
