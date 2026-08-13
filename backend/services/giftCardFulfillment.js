'use strict';

const logger = require('../utils/logger');
const {
    generateGiftCardCode,
    generateGiftCardPin
} = require('../utils/giftCardCodes');
const { ensureGiftCardRecipientAccount } = require('./giftCardRecipientAccount');
const {
    sendGiftCardRecipientEmail,
    sendGiftCardPurchaserConfirmation
} = require('./giftCardDeliveryEmail');
const { isUsPhoneDisplay } = require('../utils/usPhoneDisplay');

async function recordGiftCardTransaction(connection, row) {
    await connection.execute(
        `INSERT INTO gift_card_transactions
            (gift_card_id, transaction_type, amount, balance_before, balance_after,
             source, order_id, customer_id, description, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            row.gift_card_id,
            row.transaction_type,
            row.amount,
            row.balance_before,
            row.balance_after,
            row.source || 'web',
            row.order_id ?? null,
            row.customer_id ?? null,
            row.description ?? null,
            row.metadata ? JSON.stringify(row.metadata) : null
        ]
    );
}

async function columnExists(connection, table, column) {
    const [rows] = await connection.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return Number(rows[0].c) > 0;
}

/**
 * Issue gift cards for paid order line items.
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} orderId
 */
async function fulfillGiftCardsForOrder(pool, orderId) {
    const oid = Number(orderId);
    if (!Number.isFinite(oid) || oid < 1) return { issued: 0 };

    const hasMetadata = await columnExists(pool, 'order_items', 'metadata');
    const hasGiftType = await columnExists(pool, 'products', 'gift_card_type');

    if (!hasGiftType) {
        logger.warn(`[gift-card-fulfillment] products.gift_card_type missing; skip order ${oid}`);
        return { issued: 0 };
    }

    const metadataSelect = hasMetadata ? 'oi.metadata,' : 'NULL AS metadata,';

    const [lines] = await pool.execute(
        `SELECT oi.id AS order_item_id, oi.product_id, oi.variant_id, oi.quantity, oi.price,
                oi.product_name, oi.product_sku, ${metadataSelect}
                p.gift_card_type,
                o.email AS purchaser_email, o.user_id AS purchaser_user_id,
                o.shipping_first_name, o.shipping_last_name
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           JOIN orders o ON o.id = oi.order_id
          WHERE oi.order_id = ? AND p.gift_card_type IS NOT NULL`,
        [oid]
    );

    if (!lines.length) return { issued: 0 };

    const [[existingIssued]] = await pool.execute(
        `SELECT COUNT(*) AS n FROM gift_cards WHERE order_id = ?`,
        [oid]
    );
    if (Number(existingIssued.n) > 0) {
        logger.info(`[gift-card-fulfillment] Order ${oid} already has gift cards; skipping`);
        return { issued: 0, skipped: true };
    }

    const purchaserName = [lines[0].shipping_first_name, lines[0].shipping_last_name]
        .filter(Boolean)
        .join(' ');
    const confirmationLines = [];
    let issued = 0;

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        for (const line of lines) {
            const meta = parseMetadata(line.metadata);
            const qty = Math.max(1, Number(line.quantity) || 1);
            const balance = Number(line.price);
            const cardType = line.gift_card_type;

            for (let i = 0; i < qty; i++) {
                const giftMeta = resolveGiftMeta(meta, i);
                let customerId = null;
                let resetToken = null;
                let isNewAccount = false;

                if (giftMeta.recipientEmail) {
                    const acct = await ensureGiftCardRecipientAccount(connection, {
                        email: giftMeta.recipientEmail,
                        recipientName: giftMeta.recipientName,
                        recipientPhone: giftMeta.recipientPhone,
                        recipientAddress: giftMeta.recipientAddress
                    });
                    customerId = acct.userId;
                    resetToken = acct.resetToken;
                    isNewAccount = acct.isNew;
                } else if (line.purchaser_user_id) {
                    customerId = line.purchaser_user_id;
                }

                const code = generateGiftCardCode();
                const pin = generateGiftCardPin();
                const status = 'active';

                const [ins] = await connection.execute(
                    `INSERT INTO gift_cards (
                        code, pin, card_type, status,
                        initial_balance, current_balance,
                        customer_id, purchaser_user_id,
                        recipient_name, recipient_email,
                        sender_name, personal_message,
                        order_id, issued_at, activated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
                    [
                        code,
                        pin,
                        cardType,
                        status,
                        balance,
                        balance,
                        customerId,
                        line.purchaser_user_id,
                        giftMeta.recipientName || null,
                        giftMeta.recipientEmail || null,
                        giftMeta.senderName || purchaserName || null,
                        giftMeta.personalMessage || null,
                        oid,
                        new Date()
                    ]
                );

                const giftCardId = ins.insertId;

                await recordGiftCardTransaction(connection, {
                    gift_card_id: giftCardId,
                    transaction_type: 'issue',
                    amount: balance,
                    balance_before: 0,
                    balance_after: balance,
                    source: 'web',
                    order_id: oid,
                    customer_id: customerId,
                    description: `Issued from web order #${oid}`
                });

                await recordGiftCardTransaction(connection, {
                    gift_card_id: giftCardId,
                    transaction_type: 'activate',
                    amount: 0,
                    balance_before: balance,
                    balance_after: balance,
                    source: 'web',
                    order_id: oid,
                    customer_id: customerId,
                    description: 'Activated on purchase'
                });

                if (giftMeta.recipientEmail) {
                    void sendGiftCardRecipientEmail({
                        to: giftMeta.recipientEmail,
                        recipientName: giftMeta.recipientName,
                        senderName: giftMeta.senderName || purchaserName,
                        personalMessage: giftMeta.personalMessage,
                        greetingOccasion: giftMeta.greetingOccasion,
                        includePersonalizedEmail: giftMeta.includePersonalizedEmail,
                        cardType,
                        amount: balance,
                        code,
                        pin,
                        resetToken,
                        isNewAccount
                    });
                }

                confirmationLines.push({
                    cardType: cardType === 'digital' ? 'Digital' : 'Physical',
                    amount: balance,
                    recipientEmail: giftMeta.recipientEmail
                });
                issued += 1;
            }
        }

        await connection.commit();
    } catch (err) {
        await connection.rollback();
        logger.error(`[gift-card-fulfillment] Order ${oid} failed:`, err);
        throw err;
    } finally {
        connection.release();
    }

    if (lines[0].purchaser_email && confirmationLines.length) {
        void sendGiftCardPurchaserConfirmation({
            to: lines[0].purchaser_email,
            purchaserName,
            lines: confirmationLines
        });
    }

    logger.info(`[gift-card-fulfillment] Order ${oid}: issued ${issued} gift card(s)`);
    return { issued };
}

function parseMetadata(raw) {
    if (!raw) return {};
    let parsed = raw;
    if (typeof raw === 'string') {
        try {
            parsed = JSON.parse(raw);
        } catch {
            return {};
        }
    }
    if (parsed && typeof parsed === 'object' && parsed.giftCard) {
        return parsed.giftCard;
    }
    return parsed && typeof parsed === 'object' ? parsed : {};
}

function resolveGiftMeta(meta, index) {
    if (Array.isArray(meta.lines) && meta.lines[index]) {
        return normalizeGiftMeta(meta.lines[index], meta);
    }
    return normalizeGiftMeta(meta, meta);
}

function normalizeGiftMeta(line, defaults) {
    const address = line.recipientAddress || line.recipient_address || defaults.recipientAddress || {};
    return {
        recipientEmail: String(line.recipientEmail || line.recipient_email || defaults.recipientEmail || '')
            .trim()
            .toLowerCase(),
        recipientName: String(line.recipientName || line.recipient_name || defaults.recipientName || '').trim(),
        recipientPhone: String(line.recipientPhone || line.recipient_phone || defaults.recipientPhone || '').trim(),
        recipientAddress: {
            line1: String(address.line1 ?? address.address_line_1 ?? '').trim(),
            line2: String(address.line2 ?? address.address_line_2 ?? '').trim(),
            city: String(address.city ?? '').trim(),
            state: String(address.state ?? '').trim(),
            postalCode: String(address.postalCode ?? address.postal_code ?? '').trim(),
            country: String(address.country ?? 'United States').trim() || 'United States'
        },
        senderName: String(line.senderName || line.sender_name || defaults.senderName || '').trim(),
        personalMessage: String(line.personalMessage || line.personal_message || defaults.personalMessage || '').trim(),
        greetingOccasion: String(line.greetingOccasion || line.greeting_occasion || defaults.greetingOccasion || '')
            .trim()
            .toLowerCase(),
        includePersonalizedEmail: Boolean(
            line.includePersonalizedEmail ??
                line.include_personalized_email ??
                defaults.includePersonalizedEmail ??
                defaults.include_personalized_email
        )
    };
}

function validateDigitalRecipientMeta(meta) {
    const name = String(meta.recipientName || meta.recipient_name || '').trim();
    const email = String(meta.recipientEmail || meta.recipient_email || '').trim().toLowerCase();
    const phone = String(meta.recipientPhone || meta.recipient_phone || '').trim();
    const address = meta.recipientAddress || meta.recipient_address || {};
    const line1 = String(address.line1 ?? address.address_line_1 ?? '').trim();
    const city = String(address.city ?? '').trim();
    const state = String(address.state ?? '').trim();
    const postal = String(address.postalCode ?? address.postal_code ?? '').trim();

    if (!name) {
        const err = new Error('DIGITAL_GIFT_CARD_RECIPIENT_NAME_REQUIRED');
        err.code = 'DIGITAL_GIFT_CARD_RECIPIENT_NAME_REQUIRED';
        throw err;
    }
    if (!email) {
        const err = new Error('DIGITAL_GIFT_CARD_EMAIL_REQUIRED');
        err.code = 'DIGITAL_GIFT_CARD_EMAIL_REQUIRED';
        throw err;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        const err = new Error('INVALID_GIFT_CARD_EMAIL');
        err.code = 'INVALID_GIFT_CARD_EMAIL';
        throw err;
    }
    if (!phone) {
        const err = new Error('DIGITAL_GIFT_CARD_RECIPIENT_PHONE_REQUIRED');
        err.code = 'DIGITAL_GIFT_CARD_RECIPIENT_PHONE_REQUIRED';
        throw err;
    }
    if (!isUsPhoneDisplay(phone)) {
        const err = new Error('INVALID_GIFT_CARD_RECIPIENT_PHONE');
        err.code = 'INVALID_GIFT_CARD_RECIPIENT_PHONE';
        throw err;
    }
    if (!line1 || !city || !state || !postal || !/^\d{5}(-\d{4})?$/.test(postal)) {
        const err = new Error('DIGITAL_GIFT_CARD_RECIPIENT_ADDRESS_REQUIRED');
        err.code = 'DIGITAL_GIFT_CARD_RECIPIENT_ADDRESS_REQUIRED';
        throw err;
    }
}

/**
 * Validate gift card cart metadata before order creation.
 * @param {import('mysql2/promise').Pool} pool
 * @param {Array} normalizedItems
 */
async function validateGiftCardCartItems(pool, normalizedItems) {
    const hasGiftType = await columnExists(pool, 'products', 'gift_card_type');
    if (!hasGiftType) return;

    const ids = [...new Set(normalizedItems.map((i) => i.product_id).filter(Boolean))];
    if (!ids.length) return;

    const [rows] = await pool.execute(
        `SELECT id, gift_card_type, name FROM products WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
    );
    const typeMap = new Map(rows.map((r) => [r.id, r]));

    for (const item of normalizedItems) {
        const prod = typeMap.get(item.product_id);
        if (!prod?.gift_card_type) continue;

        const meta = item.giftCard || item.gift_card || {};
        const email = String(meta.recipientEmail || meta.recipient_email || '').trim().toLowerCase();

        if (prod.gift_card_type === 'digital') {
            validateDigitalRecipientMeta(meta);
        } else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            const err = new Error('INVALID_GIFT_CARD_EMAIL');
            err.code = 'INVALID_GIFT_CARD_EMAIL';
            throw err;
        }
    }
}

module.exports = { fulfillGiftCardsForOrder, validateGiftCardCartItems };
