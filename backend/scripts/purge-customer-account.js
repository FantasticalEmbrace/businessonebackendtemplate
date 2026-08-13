#!/usr/bin/env node
/**
 * Permanently delete a customer account and associated history.
 * Usage:
 *   node scripts/purge-customer-account.js --email user@example.com --confirm PURGE
 *   node scripts/purge-customer-account.js --email a@x.com --email b@x.com --confirm PURGE
 */

'use strict';

const { loadBackendEnv, createConnection } = require('../utils/dbConfig');

loadBackendEnv();

async function tableExists(conn, tableName) {
    const [rows] = await conn.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tableName]
    );
    return Number(rows[0].c) > 0;
}

async function columnExists(conn, table, column) {
    const [rows] = await conn.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return Number(rows[0].c) > 0;
}

async function deleteWhere(conn, table, column, userId, summary) {
    if (!(await tableExists(conn, table))) return;
    if (!(await columnExists(conn, table, column))) return;
    const [r] = await conn.query(`DELETE FROM \`${table}\` WHERE \`${column}\` = ?`, [userId]);
    if (r.affectedRows) summary.deleted[table] = r.affectedRows;
}

async function purgeGiftCardsForUser(conn, userId, summary) {
    if (!(await tableExists(conn, 'gift_cards'))) return;

    const [cards] = await conn.query(
        `SELECT id FROM gift_cards WHERE customer_id = ? OR purchaser_user_id = ?`,
        [userId, userId]
    );
    const cardIds = cards.map((c) => c.id);
    if (!cardIds.length) return;

    if (await tableExists(conn, 'gift_card_transactions')) {
        const ph = cardIds.map(() => '?').join(',');
        const [rTx] = await conn.query(
            `DELETE FROM gift_card_transactions WHERE gift_card_id IN (${ph}) OR customer_id = ?`,
            [...cardIds, userId]
        );
        summary.deleted.gift_card_transactions =
            (summary.deleted.gift_card_transactions || 0) + rTx.affectedRows;
    }

    const ph = cardIds.map(() => '?').join(',');
    const [rGc] = await conn.query(`DELETE FROM gift_cards WHERE id IN (${ph})`, cardIds);
    summary.deleted.gift_cards = rGc.affectedRows;
}

async function purgeCustomer(conn, email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return { email, status: 'skipped', reason: 'empty email' };

    const [users] = await conn.query(
        `SELECT id, email, first_name, last_name, is_active FROM users WHERE LOWER(TRIM(email)) = ?`,
        [normalized]
    );
    if (!users.length) {
        return { email: normalized, status: 'not_found' };
    }

    const userId = users[0].id;
    const summary = { email: normalized, userId, status: 'purged', deleted: {} };

    await conn.beginTransaction();
    try {
        const [orders] = await conn.query(`SELECT id FROM orders WHERE user_id = ?`, [userId]);
        const orderIds = orders.map((o) => o.id);
        if (orderIds.length) {
            const placeholders = orderIds.map(() => '?').join(',');
            if (await tableExists(conn, 'order_items')) {
                const [r] = await conn.query(
                    `DELETE FROM order_items WHERE order_id IN (${placeholders})`,
                    orderIds
                );
                summary.deleted.order_items = r.affectedRows;
            }
            const [rOrders] = await conn.query(
                `DELETE FROM orders WHERE user_id = ?`,
                [userId]
            );
            summary.deleted.orders = rOrders.affectedRows;
        }

        if (await tableExists(conn, 'edsa_bookings')) {
            const [r] = await conn.query(`DELETE FROM edsa_bookings WHERE user_id = ?`, [userId]);
            summary.deleted.edsa_bookings = r.affectedRows;
        }

        if (await tableExists(conn, 'product_reviews')) {
            const [r] = await conn.query(`DELETE FROM product_reviews WHERE user_id = ?`, [userId]);
            summary.deleted.product_reviews = r.affectedRows;
        }

        await purgeGiftCardsForUser(conn, userId, summary);

        if (await tableExists(conn, 'wishlist_collections')) {
            const [cols] = await conn.query(
                `SELECT id FROM wishlist_collections WHERE user_id = ?`,
                [userId]
            );
            const colIds = cols.map((c) => c.id);
            if (colIds.length && (await tableExists(conn, 'wishlists'))) {
                const ph = colIds.map(() => '?').join(',');
                const [rW] = await conn.query(
                    `DELETE FROM wishlists WHERE collection_id IN (${ph}) OR user_id = ?`,
                    [...colIds, userId]
                );
                summary.deleted.wishlists = rW.affectedRows;
            }
            await deleteWhere(conn, 'wishlist_collections', 'user_id', userId, summary);
        } else {
            await deleteWhere(conn, 'wishlists', 'user_id', userId, summary);
        }

        await deleteWhere(conn, 'loyalty_transactions', 'user_id', userId, summary);
        await deleteWhere(conn, 'customer_loyalty', 'user_id', userId, summary);
        await deleteWhere(conn, 'customer_notes', 'user_id', userId, summary);
        await deleteWhere(conn, 'customer_communications', 'user_id', userId, summary);
        await deleteWhere(conn, 'user_addresses', 'user_id', userId, summary);
        await deleteWhere(conn, 'user_oauth_accounts', 'user_id', userId, summary);
        await deleteWhere(conn, 'password_reset_tokens', 'user_id', userId, summary);

        await conn.query(`UPDATE users SET referred_by_user_id = NULL WHERE referred_by_user_id = ?`, [
            userId,
        ]);

        const [rUser] = await conn.query(`DELETE FROM users WHERE id = ?`, [userId]);
        summary.deleted.users = rUser.affectedRows;

        await conn.commit();
        return summary;
    } catch (err) {
        await conn.rollback();
        throw err;
    }
}

function parseArgs(argv) {
    const emails = [];
    let confirm = '';
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--email') emails.push(argv[++i]);
        else if (argv[i] === '--confirm') confirm = argv[++i];
    }
    return { emails, confirm };
}

async function main() {
    const { emails, confirm } = parseArgs(process.argv);
    if (!emails.length) {
        console.error('Usage: node scripts/purge-customer-account.js --email user@example.com --confirm PURGE');
        process.exit(1);
    }
    if (confirm !== 'PURGE') {
        console.error('Refusing to run without --confirm PURGE');
        process.exit(1);
    }

    const conn = await createConnection();
    try {
        for (const email of emails) {
            const result = await purgeCustomer(conn, email);
            console.log(JSON.stringify(result, null, 2));
        }
    } finally {
        await conn.end();
    }
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
