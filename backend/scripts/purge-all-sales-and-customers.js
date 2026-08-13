#!/usr/bin/env node
/**
 * Permanently delete ALL customer accounts and sales history.
 * Preserves: products/catalog, admin_users, POS config, menus, vendors, settings.
 *
 * Usage:
 *   node scripts/purge-all-sales-and-customers.js --dry-run
 *   node scripts/purge-all-sales-and-customers.js --confirm PURGE-ALL-SALES-AND-CUSTOMERS
 */

'use strict';

const { loadBackendEnv, createConnection } = require('../utils/dbConfig');

loadBackendEnv();

const CONFIRM_PHRASE = 'PURGE-ALL-SALES-AND-CUSTOMERS';

/** Child tables first, then parents. Only tables that exist are touched. */
const TABLES_TO_CLEAR = [
    'order_payment_tenders',
    'order_items',
    'web_promotion_redemptions',
    'gift_card_transactions',
    'loyalty_transactions',
    'cart_items',
    'wishlists',
    'orders',
    'pos_transactions',
    'pos_discount_usage',
    'pos_cash_drawer_events',
    'pos_shift_sessions',
    'pos_display_snapshots',
    'inventory_transactions',
    'tax_report_deliveries',
    'tax_entries',
    'daily_tax_reserves',
    'shopping_carts',
    'wishlist_collections',
    'product_reviews',
    'edsa_bookings',
    'customer_communications',
    'customer_notes',
    'customer_loyalty',
    'pos_customer_loyalty',
    'gift_cards',
    'pos_gift_cards',
    'payment_cards',
    'user_customer_groups',
    'user_addresses',
    'octopos_customers_cache',
    'email_subscribers',
    'users',
];

async function tableExists(conn, tableName) {
    const [rows] = await conn.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tableName]
    );
    return Number(rows[0].c) > 0;
}

async function countTable(conn, tableName) {
    if (!(await tableExists(conn, tableName))) return null;
    const [rows] = await conn.query(`SELECT COUNT(*) AS c FROM \`${tableName}\``);
    return Number(rows[0].c);
}

async function dryRun(conn) {
    const counts = {};
    for (const table of TABLES_TO_CLEAR) {
        const count = await countTable(conn, table);
        if (count !== null) counts[table] = count;
    }
    const admins = await countTable(conn, 'admin_users');
    const products = await countTable(conn, 'products');
    return { counts, preserved: { admin_users: admins, products } };
}

async function purgeAll(conn) {
    const summary = { deleted: {}, preserved: {} };

    await conn.beginTransaction();
    try {
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');

        if (await tableExists(conn, 'users')) {
            await conn.query('UPDATE users SET referred_by_user_id = NULL WHERE referred_by_user_id IS NOT NULL');
        }

        for (const table of TABLES_TO_CLEAR) {
            if (!(await tableExists(conn, table))) continue;
            const [result] = await conn.query(`DELETE FROM \`${table}\``);
            if (result.affectedRows) summary.deleted[table] = result.affectedRows;
        }

        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        await conn.commit();
    } catch (err) {
        await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
        await conn.rollback();
        throw err;
    }

    summary.preserved.admin_users = await countTable(conn, 'admin_users');
    summary.preserved.products = await countTable(conn, 'products');
    return summary;
}

function parseArgs(argv) {
    let dryRun = false;
    let confirm = '';
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--dry-run') dryRun = true;
        else if (argv[i] === '--confirm') confirm = argv[++i];
    }
    return { dryRun, confirm };
}

async function main() {
    const { dryRun: isDryRun, confirm } = parseArgs(process.argv);

    const conn = await createConnection();
    try {
        const [dbRow] = await conn.query('SELECT DATABASE() AS db, @@hostname AS host');
        const target = dbRow[0];

        console.log(`Database: ${target.db} (server host: ${target.host})`);

        if (isDryRun) {
            const result = await dryRun(conn);
            console.log(JSON.stringify({ mode: 'dry-run', ...result }, null, 2));
            return;
        }

        if (confirm !== CONFIRM_PHRASE) {
            console.error(`Refusing to run without --confirm ${CONFIRM_PHRASE}`);
            console.error('Run with --dry-run first to see row counts.');
            process.exit(1);
        }

        const before = await dryRun(conn);
        console.log('Before purge:', JSON.stringify(before.counts, null, 2));

        const summary = await purgeAll(conn);
        console.log(JSON.stringify({ mode: 'purged', ...summary }, null, 2));
    } finally {
        await conn.end();
    }
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
