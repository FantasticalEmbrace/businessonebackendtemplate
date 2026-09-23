'use strict';

const logger = require('../utils/logger');
const shippo = require('./shippoClient');
const { registerTrack, syncOrderTracking } = require('./shippoTracking');
const { validateOriginForExpressCarriers } = require('./shippoCarrierAudit');
const {
    buildCarrierTrackingUrl,
    enrichOrderTracking,
    inferCarrierFromTracking,
    isPlaceholderTracking,
} = require('../utils/trackingUrl');
const {
    sendLabelCreatedNotificationEmail,
    sendShippedNotificationEmail,
} = require('./shippedNotificationEmail');
const {
    FREE_SHIPPING_THRESHOLD,
    FIRST_CLASS_SHIPPING,
    getShippingConfig,
} = require('../config/shippingConfig');

function roundMoney(v) {
    return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

/** Manual scale weight, or catalog content + box tare when weights are known. */
function resolvePackageWeightOz(contentOz, box, manualOz) {
    const manual = parseFloat(manualOz);
    if (Number.isFinite(manual) && manual > 0) return roundMoney(manual);
    const content = Number(contentOz) || 0;
    const boxOz = Number(box?.empty_weight_oz) || 0;
    if (content <= 0) return null;
    return Math.max(1, roundMoney(content + boxOz));
}

/** mysql2 rejects undefined bind params — use null instead. */
function sqlBind(value) {
    return value === undefined ? null : value;
}

function normalizeMassUnit(unit) {
    const u = String(unit || 'oz').toLowerCase();
    if (u === 'lb' || u === 'lbs') return 'lb';
    if (u === 'kg') return 'kg';
    if (u === 'g') return 'g';
    return 'oz';
}

function weightToOz(weight, unit) {
    const w = Number(weight);
    if (!Number.isFinite(w) || w <= 0) return null;
    const u = normalizeMassUnit(unit);
    if (u === 'lb') return w * 16;
    if (u === 'kg') return w * 35.274;
    if (u === 'g') return w * 0.035274;
    return w;
}

function shippoAddressFromOrder(order, prefix = 'shipping') {
    const name = [order[`${prefix}_first_name`], order[`${prefix}_last_name`]].filter(Boolean).join(' ').trim();
    const origin = getShippingConfig().STORE_ORIGIN;
    const phone =
        String(order.phone || '').trim() ||
        String(origin.phone || '').trim() ||
        undefined;
    return {
        name: name || 'Customer',
        street1: order[`${prefix}_address_line_1`] || '',
        street2: order[`${prefix}_address_line_2`] || '',
        city: order[`${prefix}_city`] || '',
        state: order[`${prefix}_state`] || '',
        zip: order[`${prefix}_postal_code`] || '',
        country: order[`${prefix}_country`] || 'US',
        phone,
        email: order.email || origin.email || undefined,
    };
}

function shippoAddressFromOrigin() {
    const o = getShippingConfig().STORE_ORIGIN;
    if (!o.street1 || !o.city || !o.state || !o.zip) {
        const err = new Error('SHIP_ORIGIN_NOT_CONFIGURED');
        err.code = 'SHIP_ORIGIN_NOT_CONFIGURED';
        throw err;
    }
    return {
        name: o.name,
        company: o.company,
        street1: o.street1,
        street2: o.street2 || undefined,
        city: o.city,
        state: o.state,
        zip: o.zip,
        country: o.country || 'US',
        phone: o.phone || undefined,
        email: o.email || undefined,
    };
}

async function loadProductWeights(pool, productIds, variantIds = []) {
    const weights = new Map();
    if (productIds.length) {
        const [rows] = await pool.execute(
            `SELECT id, weight, weight_unit FROM products WHERE id IN (${productIds.map(() => '?').join(',')})`,
            productIds
        );
        for (const row of rows) {
            weights.set(`p:${row.id}`, {
                product_id: row.id,
                variant_id: null,
                weight_oz: weightToOz(row.weight, row.weight_unit),
                source: 'product',
            });
        }
    }
    const vids = variantIds.filter(Boolean);
    if (vids.length) {
        const [vrows] = await pool.execute(
            `SELECT id, product_id, weight FROM product_variants WHERE id IN (${vids.map(() => '?').join(',')})`,
            vids
        );
        for (const row of vrows) {
            weights.set(`v:${row.id}`, {
                product_id: row.product_id,
                variant_id: row.id,
                weight_oz: weightToOz(row.weight, 'oz'),
                source: 'variant',
            });
        }
    }
    return weights;
}

async function resolveCartWeights(pool, cartItems) {
    const productIds = [...new Set(cartItems.map((i) => Number(i.product_id)).filter((n) => n > 0))];
    const variantIds = [...new Set(cartItems.map((i) => i.variant_id).filter(Boolean))];
    const catalog = await loadProductWeights(pool, productIds, variantIds);

    const lines = [];
    let totalOz = 0;
    let allKnown = true;

    for (const item of cartItems) {
        const pid = Number(item.product_id);
        const vid = item.variant_id ? Number(item.variant_id) : null;
        const qty = Number(item.quantity) || 1;
        let entry = vid ? catalog.get(`v:${vid}`) : null;
        if (!entry || entry.weight_oz == null) entry = catalog.get(`p:${pid}`);
        const weightOz = entry?.weight_oz ?? null;
        if (weightOz == null) allKnown = false;
        else totalOz += weightOz * qty;
        lines.push({
            product_id: pid,
            variant_id: vid,
            quantity: qty,
            weight_oz: weightOz,
            product_name: item.name || item.product_name || null,
        });
    }

    return { lines, totalWeightOz: roundMoney(totalOz), allWeightsKnown: allKnown && totalOz > 0 };
}

function flatRateOptions(merchandiseSubtotal) {
    const sub = Number(merchandiseSubtotal) || 0;
    const options = [];
    if (sub >= FREE_SHIPPING_THRESHOLD) {
        options.push({
            id: 'free_standard',
            method: 'free_standard',
            label: 'Free Standard Shipping',
            description: `Free on orders $${FREE_SHIPPING_THRESHOLD.toFixed(2)}+`,
            amount: 0,
            carrier: process.env.STORE_NAME || 'Store',
            provider: 'standard',
            estimated_days: '3–7 business days',
        });
    } else {
        options.push({
            id: 'first_class',
            method: 'first_class',
            label: 'First Class Mail',
            description: 'Standard shipping for orders under $50',
            amount: FIRST_CLASS_SHIPPING,
            carrier: 'USPS',
            provider: 'usps',
            estimated_days: '3–7 business days',
        });
    }
    return options;
}

function resolveFlatRateAmount(method, merchandiseSubtotal) {
    const sub = Number(merchandiseSubtotal) || 0;
    if (method === 'free_standard' && sub >= FREE_SHIPPING_THRESHOLD) return 0;
    if (method === 'first_class' && sub < FREE_SHIPPING_THRESHOLD) return FIRST_CLASS_SHIPPING;
    return null;
}

function formatCarrierRate(rate) {
    const provider = String(rate.provider || '').toLowerCase();
    if (!getShippingConfig().CARRIER_FILTER.has(provider)) return null;
    const amount = parseFloat(rate.amount);
    if (!Number.isFinite(amount)) return null;
    const service = rate.servicelevel?.name || rate.servicelevel_name || 'Carrier rate';
    return {
        id: `shippo:${rate.object_id}`,
        method: `shippo:${rate.object_id}`,
        shippo_rate_id: rate.object_id,
        label: `${String(rate.provider || '').toUpperCase()} — ${service}`,
        description: rate.duration_terms || rate.estimated_days
            ? `${rate.estimated_days || ''} ${rate.duration_terms || ''}`.trim()
            : 'Carrier rate',
        amount: roundMoney(amount),
        carrier: String(rate.provider || '').toUpperCase(),
        provider,
        service,
        estimated_days: rate.estimated_days || rate.duration_terms || null,
    };
}

function sortCarrierRates(rates) {
    const order = { usps: 0, ups: 1, fedex: 2 };
    return [...rates].sort((a, b) => {
        const pa = order[String(a.provider || '').toLowerCase()] ?? 9;
        const pb = order[String(b.provider || '').toLowerCase()] ?? 9;
        if (pa !== pb) return pa - pb;
        return Number(a.amount) - Number(b.amount);
    });
}

async function fetchShippoRates({ addressTo, parcel }) {
    if (!shippo.isConfigured()) {
        const err = new Error('SHIPPO_NOT_CONFIGURED');
        err.code = 'SHIPPO_NOT_CONFIGURED';
        throw err;
    }
    const origin = getShippingConfig().STORE_ORIGIN;
    const originCheck = validateOriginForExpressCarriers(origin);
    if (!originCheck.ok) {
        const err = new Error(originCheck.issues[0] || 'SHIP_ORIGIN_NOT_CONFIGURED');
        err.code = 'SHIP_ORIGIN_NOT_CONFIGURED';
        err.issues = originCheck.issues;
        throw err;
    }
    const shipment = await shippo.createShipment({
        address_from: shippoAddressFromOrigin(),
        address_to: {
            ...addressTo,
            phone: addressTo.phone || origin.phone || undefined,
            email: addressTo.email || origin.email || undefined,
        },
        parcels: [parcel],
    });
    if (!shipment?.object_id) {
        const err = new Error('SHIPPO_SHIPMENT_FAILED');
        err.code = 'SHIPPO_SHIPMENT_FAILED';
        throw err;
    }
    const rates = Array.isArray(shipment.rates) ? shipment.rates : [];
    return {
        shipment_id: shipment.object_id,
        rates: sortCarrierRates(rates.map(formatCarrierRate).filter(Boolean)),
    };
}

async function getCheckoutOptions(pool, { cartItems, postalCode, state, country, merchandiseSubtotal }) {
    const flat = flatRateOptions(merchandiseSubtotal);
    const weightInfo = await resolveCartWeights(pool, cartItems);
    const options = [...flat];

    if (!weightInfo.allWeightsKnown || !postalCode || !shippo.isConfigured()) {
        return { options, weightInfo, shippoEnabled: shippo.isConfigured() };
    }

    const [boxes] = await pool.execute(
        'SELECT * FROM shipping_boxes WHERE is_active = 1 ORDER BY sort_order ASC LIMIT 1'
    );
    const box = boxes[0];
    if (!box) return { options, weightInfo, shippoEnabled: true };

    const parcelWeight = Math.max(1, roundMoney(weightInfo.totalWeightOz + Number(box.empty_weight_oz || 0)));
    try {
        const { shipment_id, rates } = await fetchShippoRates({
            addressTo: {
                name: 'Customer',
                street1: '123 Main St',
                city: 'City',
                state: state || 'UT',
                zip: String(postalCode).trim(),
                country: country || 'US',
                phone: getShippingConfig().STORE_ORIGIN.phone,
                email: getShippingConfig().STORE_ORIGIN.email,
            },
            parcel: {
                length: String(box.length),
                width: String(box.width),
                height: String(box.height),
                distance_unit: box.dimension_unit || 'in',
                weight: String(parcelWeight),
                mass_unit: 'oz',
            },
        });
        for (const rate of rates) {
            options.push({ ...rate, shippo_shipment_id: shipment_id });
        }
    } catch {
        // Carrier rates are optional; flat rates always available
    }

    return { options, weightInfo, shippoEnabled: shippo.isConfigured() };
}

async function getOrderFulfillmentContext(pool, orderId) {
    const [orders] = await pool.execute('SELECT * FROM orders WHERE id = ? LIMIT 1', [orderId]);
    if (orders.length && orders[0].tracking_number && ['label_created', 'shipped', 'in_transit'].includes(orders[0].status)) {
        await syncOrderTracking(pool, orderId);
    }
    const [refreshed] = await pool.execute('SELECT * FROM orders WHERE id = ? LIMIT 1', [orderId]);
    if (refreshed.length) orders[0] = refreshed[0];
    if (!orders.length) {
        const err = new Error('ORDER_NOT_FOUND');
        err.code = 'ORDER_NOT_FOUND';
        throw err;
    }
    const order = orders[0];

    const [items] = await pool.execute(
        `SELECT oi.*, p.weight AS product_weight, p.weight_unit, pv.weight AS variant_weight
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         LEFT JOIN product_variants pv ON pv.id = oi.variant_id
         WHERE oi.order_id = ?
         ORDER BY oi.id`,
        [orderId]
    );

    const lines = items.map((row) => {
        let weightOz = null;
        if (row.variant_weight != null) weightOz = weightToOz(row.variant_weight, 'oz');
        if (weightOz == null && row.product_weight != null) weightOz = weightToOz(row.product_weight, row.weight_unit);
        return {
            order_item_id: row.id,
            product_id: row.product_id,
            variant_id: row.variant_id,
            product_name: row.product_name,
            product_sku: row.product_sku,
            quantity: row.quantity,
            weight_oz: weightOz,
            needs_weight: weightOz == null,
        };
    });

    const [boxes] = await pool.execute(
        'SELECT * FROM shipping_boxes WHERE is_active = 1 ORDER BY sort_order ASC'
    );

    const contentOz = lines.reduce((s, l) => s + (l.weight_oz || 0) * l.quantity, 0);
    const suggestedBox = boxes.find((b) => contentOz <= 32) || boxes[boxes.length - 1] || null;
    const allWeightsKnown = lines.every((l) => !l.needs_weight) && contentOz > 0;
    const estimatedPackageWeightOz = allWeightsKnown
        ? resolvePackageWeightOz(contentOz, suggestedBox, null)
        : null;

    const storeOrigin = getShippingConfig().STORE_ORIGIN;
    return {
        order: enrichOrderTracking(order),
        lines,
        boxes,
        missingWeights: lines.filter((l) => l.needs_weight),
        allWeightsKnown,
        estimatedContentOz: roundMoney(contentOz),
        estimatedPackageWeightOz,
        suggestedBoxId: suggestedBox?.id || null,
        shippoConfigured: shippo.isConfigured(),
        originConfigured: Boolean(storeOrigin.street1 && storeOrigin.city),
        hasLabel: Boolean(order.label_url),
    };
}

async function saveLearnedWeights(pool, weights = []) {
    let saved = 0;
    for (const row of weights) {
        const oz = parseFloat(row.weight_oz);
        if (!Number.isFinite(oz) || oz <= 0) continue;
        const pid = Number(row.product_id);
        if (!Number.isInteger(pid) || pid < 1) continue;
        const vid = row.variant_id ? Number(row.variant_id) : null;

        if (vid) {
            await pool.execute('UPDATE product_variants SET weight = ? WHERE id = ? AND product_id = ?', [
                oz,
                vid,
                pid,
            ]);
        } else {
            await pool.execute('UPDATE products SET weight = ?, weight_unit = ? WHERE id = ?', [oz, 'oz', pid]);
        }
        saved++;
    }
    return saved;
}

async function getRatesForOrder(pool, orderId, { boxId, packageWeightOz }) {
    const ctx = await getOrderFulfillmentContext(pool, orderId);
    if (ctx.missingWeights.length) {
        const err = new Error('MISSING_PRODUCT_WEIGHTS');
        err.code = 'MISSING_PRODUCT_WEIGHTS';
        err.missing = ctx.missingWeights;
        throw err;
    }

    const resolvedBoxId = boxId || ctx.suggestedBoxId || ctx.boxes[0]?.id;
    const [boxes] = await pool.execute('SELECT * FROM shipping_boxes WHERE id = ? LIMIT 1', [resolvedBoxId]);
    const box = boxes[0];
    if (!box) {
        const err = new Error('BOX_NOT_FOUND');
        err.code = 'BOX_NOT_FOUND';
        throw err;
    }

    const weightOz = resolvePackageWeightOz(ctx.estimatedContentOz, box, packageWeightOz);
    if (!weightOz) {
        const err = new Error('INVALID_PACKAGE_WEIGHT');
        err.code = 'INVALID_PACKAGE_WEIGHT';
        throw err;
    }

    const { shipment_id, rates } = await fetchShippoRates({
        addressTo: shippoAddressFromOrder(ctx.order, 'shipping'),
        parcel: {
            length: String(box.length),
            width: String(box.width),
            height: String(box.height),
            distance_unit: box.dimension_unit || 'in',
            weight: String(weightOz),
            mass_unit: 'oz',
        },
    });

    await pool.execute(
        'UPDATE orders SET shippo_shipment_id = ?, shipping_box_id = ?, package_weight_oz = ? WHERE id = ?',
        [sqlBind(shipment_id), sqlBind(resolvedBoxId), sqlBind(weightOz), orderId]
    );

    return { shipment_id, rates, box, packageWeightOz: weightOz, weightAutoCalculated: !(parseFloat(packageWeightOz) > 0) };
}

async function purchaseLabel(pool, orderId, { rateId, boxId, packageWeightOz, itemWeights }) {
    if (itemWeights?.length) await saveLearnedWeights(pool, itemWeights);

    const [orders] = await pool.execute('SELECT * FROM orders WHERE id = ? LIMIT 1', [orderId]);
    if (!orders.length) {
        const err = new Error('ORDER_NOT_FOUND');
        err.code = 'ORDER_NOT_FOUND';
        throw err;
    }
    const order = orders[0];
    if (isOrderBlockedFromShipping(order)) {
        const err = new Error('ORDER_VOIDED_OR_REFUNDED');
        err.code = 'ORDER_VOIDED_OR_REFUNDED';
        err.message = 'Cannot create a shipping label for a voided, refunded, or cancelled order';
        throw err;
    }
    if (String(order.payment_status || '').toLowerCase() !== 'paid') {
        const err = new Error('ORDER_NOT_PAID');
        err.code = 'ORDER_NOT_PAID';
        err.message = 'Only paid orders can get a shipping label';
        throw err;
    }
    if (order.label_url) {
        const err = new Error('LABEL_ALREADY_EXISTS');
        err.code = 'LABEL_ALREADY_EXISTS';
        throw err;
    }

    let resolvedRateId = rateId ? String(rateId).trim() : null;
    let resolvedBoxId = boxId ? Number(boxId) : null;
    let resolvedWeightOz = parseFloat(packageWeightOz);
    let quoteRate = null;

    if (!resolvedRateId) {
        const quote = await getRatesForOrder(pool, orderId, { boxId, packageWeightOz });
        quoteRate = quote.rates[0] || null;
        if (!quoteRate?.shippo_rate_id) {
            const err = new Error('NO_RATES_AVAILABLE');
            err.code = 'NO_RATES_AVAILABLE';
            throw err;
        }
        resolvedRateId = quoteRate.shippo_rate_id;
        resolvedBoxId = quote.box?.id ?? resolvedBoxId;
        resolvedWeightOz = quote.packageWeightOz;
    } else if (!Number.isFinite(resolvedWeightOz) || resolvedWeightOz <= 0) {
        const ctx = await getOrderFulfillmentContext(pool, orderId);
        const bid = resolvedBoxId || ctx.suggestedBoxId || ctx.boxes[0]?.id;
        const [boxRows] = await pool.execute('SELECT * FROM shipping_boxes WHERE id = ? LIMIT 1', [bid]);
        resolvedWeightOz = resolvePackageWeightOz(ctx.estimatedContentOz, boxRows[0], packageWeightOz);
        resolvedBoxId = bid;
    }

    if (!resolvedRateId) {
        const err = new Error('NO_RATES_AVAILABLE');
        err.code = 'NO_RATES_AVAILABLE';
        throw err;
    }

    const txn = await shippo.createTransaction({
        rate: resolvedRateId,
        // 4×6 portrait thermal label — not 8.5×11 PDF (labels render sideways in browser/printer).
        label_file_type: 'PDF_4x6',
    });

    const status = String(txn.status || txn.object_status || '').toUpperCase();
    if (status !== 'SUCCESS') {
        const msg = (txn.messages || []).map((m) => m.text || m.message).filter(Boolean).join('; ');
        const err = new Error(msg || 'LABEL_PURCHASE_FAILED');
        err.code = 'LABEL_PURCHASE_FAILED';
        err.transaction = txn;
        throw err;
    }

    const trackingNumber = String(txn.tracking_number || '').trim();
    let carrier = String(txn.rate?.provider || txn.provider || quoteRate?.carrier || '').toUpperCase();
    if (!carrier && trackingNumber) {
        carrier = inferCarrierFromTracking(trackingNumber).toUpperCase();
    }
    const trackingUrl =
        String(txn.tracking_url_provider || '').trim() ||
        buildCarrierTrackingUrl(carrier, trackingNumber) ||
        '';
    const labelUrl = String(txn.label_url || '').trim();
    const service = String(txn.rate?.servicelevel?.name || txn.servicelevel?.name || '').trim();

    await pool.execute(
        `UPDATE orders SET
            shippo_transaction_id = ?,
            shippo_rate_id = ?,
            tracking_number = ?,
            tracking_url = ?,
            label_url = ?,
            shipping_carrier = ?,
            shipping_service = ?,
            shipping_box_id = COALESCE(?, shipping_box_id),
            package_weight_oz = COALESCE(?, package_weight_oz),
            status = 'label_created',
            fulfillment_status = 'partial',
            label_created_at = NOW(),
            tracking_status = 'PRE_TRANSIT',
            tracking_status_detail = 'Shipping label created — awaiting carrier scan'
         WHERE id = ?`,
        [
            sqlBind(txn.object_id),
            sqlBind(resolvedRateId),
            sqlBind(trackingNumber || null),
            sqlBind(trackingUrl || null),
            sqlBind(labelUrl || null),
            sqlBind(carrier || null),
            sqlBind(service || null),
            sqlBind(resolvedBoxId),
            sqlBind(resolvedWeightOz),
            orderId,
        ]
    );

    if (trackingNumber && carrier) {
        void registerTrack(carrier, trackingNumber);
        void syncOrderTracking(pool, orderId);
    }

    void sendLabelCreatedNotificationEmail(pool, orderId).catch((err) => {
        logger.error(`Label tracking email failed for order ${orderId}:`, err);
    });

    return {
        transaction_id: txn.object_id,
        tracking_number: trackingNumber,
        tracking_url: trackingUrl,
        label_url: labelUrl,
        carrier,
        service,
        status: 'label_created',
    };
}

async function listBoxes(pool) {
    const [rows] = await pool.execute(
        'SELECT * FROM shipping_boxes WHERE is_active = 1 ORDER BY sort_order ASC'
    );
    return rows;
}

function isOrderBlockedFromShipping(order) {
    const status = String(order?.status || '').trim().toLowerCase();
    const payment = String(order?.payment_status || '').trim().toLowerCase();
    if (['cancelled', 'canceled', 'refunded', 'voided', 'void'].includes(status)) return true;
    if (['refunded', 'voided', 'void', 'cancelled', 'canceled'].includes(payment)) return true;
    return false;
}

/** Dropship / external fulfillment — vendor tracking without a Shippo label. */
async function setManualTracking(
    pool,
    orderId,
    {
        trackingNumber,
        shippingCarrier = null,
        shippingService = null,
        trackingUrl = null,
        markShipped = true,
    } = {}
) {
    const num = String(trackingNumber || '').trim();
    if (!num) {
        const err = new Error('Tracking number is required');
        err.code = 'TRACKING_REQUIRED';
        throw err;
    }
    if (isPlaceholderTracking(num)) {
        const err = new Error('Enter the real carrier tracking number from the vendor');
        err.code = 'TRACKING_INVALID';
        throw err;
    }

    const oid = Number(orderId);
    if (!Number.isFinite(oid) || oid < 1) {
        const err = new Error('ORDER_NOT_FOUND');
        err.code = 'ORDER_NOT_FOUND';
        throw err;
    }

    const [orders] = await pool.execute('SELECT * FROM orders WHERE id = ? LIMIT 1', [oid]);
    if (!orders.length) {
        const err = new Error('ORDER_NOT_FOUND');
        err.code = 'ORDER_NOT_FOUND';
        throw err;
    }
    const order = orders[0];

    if (isOrderBlockedFromShipping(order)) {
        const err = new Error('Cannot update tracking on a voided, refunded, or cancelled order');
        err.code = 'ORDER_VOIDED_OR_REFUNDED';
        throw err;
    }
    if (String(order.payment_status || '').toLowerCase() !== 'paid') {
        const err = new Error('Only paid orders can receive tracking');
        err.code = 'ORDER_NOT_PAID';
        throw err;
    }
    if (order.label_url || order.shippo_transaction_id) {
        const err = new Error(
            'This order already has a Shippo label — tracking is managed by the carrier. Use manual tracking only for dropships without a store label.'
        );
        err.code = 'SHIPPO_LABEL_EXISTS';
        throw err;
    }

    let carrier = String(shippingCarrier || '').trim() || inferCarrierFromTracking(num);
    carrier = String(carrier || '').trim();
    if (!carrier) {
        const err = new Error('Select a carrier (USPS, UPS, FedEx, etc.)');
        err.code = 'CARRIER_REQUIRED';
        throw err;
    }

    const url = String(trackingUrl || '').trim() || buildCarrierTrackingUrl(carrier, num) || null;
    const service = String(shippingService || '').trim() || null;
    const shouldMarkShipped = markShipped !== false;
    const st = String(order.status || '').toLowerCase();
    const alreadyShipped = ['shipped', 'in_transit', 'delivered'].includes(st);

    const updates = [
        'tracking_number = ?',
        'tracking_url = ?',
        'shipping_carrier = ?',
        'tracking_status_detail = ?',
        'tracking_status_updated_at = NOW()',
    ];
    const params = [
        num.slice(0, 128),
        url ? String(url).slice(0, 500) : null,
        carrier.slice(0, 32),
        // Customer-facing status line — never include "dropship" (staff-only term)
        'Tracking entered — awaiting carrier update',
    ];

    if (service) {
        updates.push('shipping_service = ?');
        params.push(service.slice(0, 128));
    }

    if (shouldMarkShipped) {
        if (!alreadyShipped) updates.push("status = 'shipped'");
        updates.push('shipped_at = COALESCE(shipped_at, NOW())');
        updates.push("fulfillment_status = 'fulfilled'");
    }

    params.push(oid);
    await pool.execute(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`, params);

    void registerTrack(carrier, num)
        .then(() => syncOrderTracking(pool, oid))
        .catch((err) => {
            logger.warn(`Manual tracking register failed for order ${oid}: ${err.message}`);
        });

    if (shouldMarkShipped) {
        void sendShippedNotificationEmail(pool, oid).catch((err) => {
            logger.error(`Shipped email failed after manual tracking for order ${oid}:`, err);
        });
    }

    const [fresh] = await pool.execute('SELECT * FROM orders WHERE id = ? LIMIT 1', [oid]);
    return { order: enrichOrderTracking(fresh[0] || order) };
}

const BULK_LABEL_LIMIT = 25;
const BULK_PRINT_LIMIT = 50;

const SHIPPING_ELIGIBLE_SQL = `
    LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'refunded', 'voided', 'void')
    AND LOWER(COALESCE(o.payment_status, '')) NOT IN ('refunded', 'voided', 'void', 'cancelled', 'canceled')
`;

function merchantScopeSql(merchantId, alias = 'o') {
    const mid = merchantId || null;
    if (!mid) return { sql: '', params: [] };
    return { sql: ` AND ${alias}.merchant_id = ?`, params: [mid] };
}

/** Paid webstore orders that still need a shipping label. */
async function listOrdersNeedingLabels(pool, { limit = BULK_LABEL_LIMIT, merchantId = null } = {}) {
    const lim = Math.min(BULK_LABEL_LIMIT, Math.max(1, Number(limit) || BULK_LABEL_LIMIT));
    const mid = merchantScopeSql(merchantId);
    const [rows] = await pool.query(
        `SELECT o.id, o.order_number, o.email, o.status, o.payment_status, o.fulfillment_status,
                o.shipping_first_name, o.shipping_last_name, o.created_at,
                o.shipping_address_line_1, o.shipping_city, o.shipping_state, o.shipping_postal_code
           FROM orders o
          WHERE o.payment_status = 'paid'
            AND COALESCE(o.sales_channel, 'online') = 'online'
            AND (o.label_url IS NULL OR o.label_url = '')
            AND (o.tracking_number IS NULL OR TRIM(o.tracking_number) = ''
                 OR o.tracking_number LIKE 'BOTRK%' OR o.tracking_number LIKE 'HMTRK%')
            AND ${SHIPPING_ELIGIBLE_SQL}
            AND LOWER(COALESCE(o.status, '')) NOT IN ('delivered')
            AND NULLIF(TRIM(o.shipping_address_line_1), '') IS NOT NULL
            AND NULLIF(TRIM(o.shipping_postal_code), '') IS NOT NULL
            ${mid.sql}
          ORDER BY o.created_at ASC
          LIMIT ${lim}`,
        mid.params
    );
    return rows;
}

/** Labels created but not yet marked printed (excludes voided/refunded/cancelled). */
async function listUnprintedLabels(pool, { limit = BULK_PRINT_LIMIT, merchantId = null } = {}) {
    const lim = Math.min(BULK_PRINT_LIMIT, Math.max(1, Number(limit) || BULK_PRINT_LIMIT));
    const mid = merchantScopeSql(merchantId);
    const [rows] = await pool.query(
        `SELECT o.id, o.order_number, o.email, o.status, o.payment_status, o.label_url, o.label_created_at,
                o.label_printed_at, o.shipping_carrier, o.tracking_number,
                o.shipping_first_name, o.shipping_last_name, o.created_at
           FROM orders o
          WHERE o.label_url IS NOT NULL AND o.label_url <> ''
            AND o.label_printed_at IS NULL
            AND ${SHIPPING_ELIGIBLE_SQL}
            ${mid.sql}
          ORDER BY o.label_created_at ASC, o.created_at ASC
          LIMIT ${lim}`,
        mid.params
    );
    return rows;
}

async function markLabelsPrinted(pool, orderIds = [], { merchantId = null } = {}) {
    const ids = [...new Set((orderIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
    if (!ids.length) return { updated: 0, ids: [] };
    const placeholders = ids.map(() => '?').join(', ');
    const mid = merchantScopeSql(merchantId);
    const [result] = await pool.execute(
        `UPDATE orders o
            SET o.label_printed_at = COALESCE(o.label_printed_at, NOW())
          WHERE o.id IN (${placeholders})
            AND o.label_url IS NOT NULL AND o.label_url <> ''
            AND ${SHIPPING_ELIGIBLE_SQL}
            ${mid.sql}`,
        [...ids, ...mid.params]
    );
    return { updated: Number(result?.affectedRows) || 0, ids };
}

/**
 * Create shipping labels for many ready orders (cheapest/first Shippo rate).
 * Skips orders that still need product weights or already have labels.
 */
async function bulkPurchaseLabels(pool, { orderIds = null, limit = BULK_LABEL_LIMIT, merchantId = null } = {}) {
    let targets;
    if (Array.isArray(orderIds) && orderIds.length) {
        const ids = [...new Set(orderIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
        if (!ids.length) return { created: [], skipped: [], failed: [] };
        const placeholders = ids.map(() => '?').join(', ');
        const mid = merchantScopeSql(merchantId);
        const [rows] = await pool.execute(
            `SELECT id, order_number, status, payment_status FROM orders o
              WHERE o.id IN (${placeholders})
                AND o.payment_status = 'paid'
                AND (o.label_url IS NULL OR o.label_url = '')
                AND ${SHIPPING_ELIGIBLE_SQL}
                ${mid.sql}
              ORDER BY FIELD(o.id, ${placeholders})`,
            [...ids, ...mid.params, ...ids]
        );
        targets = rows;
    } else {
        targets = await listOrdersNeedingLabels(pool, { limit, merchantId });
    }

    const created = [];
    const skipped = [];
    const failed = [];

    for (const row of targets) {
        try {
            const ctx = await getOrderFulfillmentContext(pool, row.id);
            if (ctx.hasLabel) {
                skipped.push({
                    orderId: row.id,
                    orderNumber: row.order_number,
                    reason: 'already_has_label',
                });
                continue;
            }
            const tn = String(ctx.order?.tracking_number || '').trim();
            if (tn && !isPlaceholderTracking(tn)) {
                skipped.push({
                    orderId: row.id,
                    orderNumber: row.order_number,
                    reason: 'dropship_manual_tracking',
                });
                continue;
            }
            if (ctx.missingWeights?.length) {
                skipped.push({
                    orderId: row.id,
                    orderNumber: row.order_number,
                    reason: 'missing_weights',
                    missing: ctx.missingWeights.map((m) => m.product_name || m.product_sku || m.product_id),
                });
                continue;
            }
            if (!ctx.shippoConfigured || !ctx.originConfigured) {
                failed.push({
                    orderId: row.id,
                    orderNumber: row.order_number,
                    reason: !ctx.shippoConfigured ? 'shippo_not_configured' : 'origin_not_configured',
                });
                continue;
            }

            const result = await purchaseLabel(pool, row.id, {});
            created.push({
                orderId: row.id,
                orderNumber: row.order_number,
                labelUrl: result.label_url,
                trackingNumber: result.tracking_number,
                carrier: result.carrier,
                service: result.service,
            });
        } catch (e) {
            const code = e.code || 'ERROR';
            if (code === 'LABEL_ALREADY_EXISTS') {
                skipped.push({ orderId: row.id, orderNumber: row.order_number, reason: 'already_has_label' });
            } else if (code === 'ORDER_VOIDED_OR_REFUNDED') {
                skipped.push({
                    orderId: row.id,
                    orderNumber: row.order_number,
                    reason: 'voided_or_refunded',
                });
            } else if (code === 'MISSING_PRODUCT_WEIGHTS') {
                skipped.push({
                    orderId: row.id,
                    orderNumber: row.order_number,
                    reason: 'missing_weights',
                    missing: (e.missing || []).map((m) => m.product_name || m.product_sku || m.product_id),
                });
            } else {
                failed.push({
                    orderId: row.id,
                    orderNumber: row.order_number,
                    reason: code,
                    message: e.message || 'Unable to create label',
                });
                logger.warn(`[bulk-label] Failed order ${row.id}: ${e.message}`);
            }
        }
    }

    return {
        created,
        skipped,
        failed,
        summary: {
            created: created.length,
            skipped: skipped.length,
            failed: failed.length,
            total: targets.length,
        },
    };
}

module.exports = {
    roundMoney,
    weightToOz,
    flatRateOptions,
    resolveFlatRateAmount,
    resolveCartWeights,
    getCheckoutOptions,
    getOrderFulfillmentContext,
    saveLearnedWeights,
    getRatesForOrder,
    purchaseLabel,
    setManualTracking,
    listBoxes,
    listOrdersNeedingLabels,
    listUnprintedLabels,
    markLabelsPrinted,
    bulkPurchaseLabels,
    isOrderBlockedFromShipping,
    BULK_LABEL_LIMIT,
    BULK_PRINT_LIMIT,
    FREE_SHIPPING_THRESHOLD,
    FIRST_CLASS_SHIPPING,
};
