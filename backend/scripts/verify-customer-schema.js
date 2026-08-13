// Verification: customer / gift-card / loyalty schema, wishlists, and user order aggregates.
// Run from backend: node scripts/verify-customer-schema.js

const { loadBackendEnv, createPool, createConnection } = require('../utils/dbConfig');
const mysql = require('mysql2/promise');

async function tableExists(conn, name) {
    const [[row]] = await conn.query(
        `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [name]
    );
    return row && Number(row.n) > 0;
}

async function columnExists(conn, table, column) {
    const [[row]] = await conn.query(
        `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return row && Number(row.n) > 0;
}

(async () => {
    loadBackendEnv();
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hmherbs',
    });

    const tables = ['users', 'customer_loyalty', 'loyalty_transactions',
        'gift_cards', 'gift_card_transactions', 'customer_notes',
        'customer_communications'];

    console.log('=== Core customer tables ===');
    for (const t of tables) {
        try {
            const [[c]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
            console.log(`  ${t.padEnd(30)} ${c.n} row(s)`);
        } catch (err) {
            console.log(`  ${t.padEnd(30)} MISSING (${err.code})`);
        }
    }

    console.log('\n=== Wishlist tables ===');
    if (await tableExists(conn, 'wishlist_collections')) {
        const [[wc]] = await conn.query('SELECT COUNT(*) AS n FROM wishlist_collections');
        console.log(`  ${'wishlist_collections'.padEnd(30)} ${wc.n} row(s)`);
        const [[def]] = await conn.query(
            `SELECT COUNT(*) AS n FROM wishlist_collections WHERE is_default = 1`
        );
        console.log(`  ${'  (is_default=1)'.padEnd(30)} ${def.n} row(s)`);
    } else {
        console.log(`  ${'wishlist_collections'.padEnd(30)} MISSING`);
    }

    if (await tableExists(conn, 'wishlists')) {
        const [[w]] = await conn.query('SELECT COUNT(*) AS n FROM wishlists');
        console.log(`  ${'wishlists'.padEnd(30)} ${w.n} row(s)`);
        if (await columnExists(conn, 'wishlists', 'collection_id')) {
            const [[orph]] = await conn.query(
                'SELECT COUNT(*) AS n FROM wishlists WHERE collection_id IS NULL'
            );
            const tag = Number(orph.n) === 0 ? 'OK' : 'NEEDS BACKFILL';
            console.log(`  ${'wishlists.collection_id NULL'.padEnd(30)} ${orph.n} row(s) (${tag})`);
        } else {
            console.log(`  ${'wishlists.collection_id'.padEnd(30)} column MISSING (run wishlist migration)`);
        }
    } else {
        console.log(`  ${'wishlists'.padEnd(30)} MISSING`);
    }

    console.log('\n=== users CRM columns ===');
    const [cols] = await conn.query(
        `SELECT COLUMN_NAME, COLUMN_TYPE
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'users'
            AND COLUMN_NAME IN ('customer_number','customer_status','customer_type',
              'lifetime_value','total_orders','last_order_at','avg_order_value',
              'tags',
              'marketing_email_opt_in','tax_exempt','admin_notes')
          ORDER BY ORDINAL_POSITION`
    );
    cols.forEach(c => console.log(`  ${c.COLUMN_NAME.padEnd(30)} ${c.COLUMN_TYPE}`));

    console.log('\n=== Sample customers (first 5) ===');
    const [users] = await conn.query(
        `SELECT id, customer_number, email, customer_status, total_orders, lifetime_value
           FROM users ORDER BY id LIMIT 5`
    );
    users.forEach(u => {
        console.log(`  #${u.id} ${u.customer_number || '—'} ${u.email} (${u.customer_status}) orders=${u.total_orders} ltv=${u.lifetime_value}`);
    });

    console.log('\n=== customer_loyalty vs users ===');
    try {
        const [[lc]] = await conn.query('SELECT COUNT(*) AS n FROM customer_loyalty');
        const [[uc]] = await conn.query('SELECT COUNT(*) AS n FROM users');
        console.log(`  ${lc.n} loyalty rows for ${uc.n} users (${lc.n === uc.n ? 'OK' : 'MISMATCH'})`);
    } catch (e) {
        console.log(`  ${e.message}`);
    }

    console.log('\n=== users.* vs completed orders (drift check) ===');
    console.log('  Expected: total_orders / lifetime_value match COUNT/SUM of orders where status=completed.');
    try {
        const [drift] = await conn.query(`
            SELECT u.id, u.email,
                   u.total_orders AS stored_orders,
                   COALESCE(o.cnt, 0) AS actual_completed,
                   u.lifetime_value AS stored_ltv,
                   COALESCE(o.spent, 0) AS actual_spent
              FROM users u
              LEFT JOIN (
                  SELECT user_id,
                         COUNT(*) AS cnt,
                         COALESCE(SUM(total_amount), 0) AS spent
                    FROM orders
                   WHERE status = 'completed'
                   GROUP BY user_id
              ) o ON o.user_id = u.id
             WHERE u.total_orders != COALESCE(o.cnt, 0)
                OR ABS(COALESCE(u.lifetime_value, 0) - COALESCE(o.spent, 0)) > 0.01
        `);
        if (drift.length === 0) {
            console.log('  No drift (all stored aggregates match orders).');
        } else {
            console.log(`  ${drift.length} user(s) with mismatched aggregates:`);
            drift.forEach(d => {
                console.log(`    #${d.id} ${d.email}: orders stored=${d.stored_orders} actual=${d.actual_completed}; LTV stored=${d.stored_ltv} actual=${d.actual_spent}`);
            });
            console.log('  Tip: new orders use POST .../complete which recalculates from completed orders.');
        }
    } catch (e) {
        if (e.errno === 1054) {
            console.log('  SKIP (users.total_orders or orders columns missing — run customer migration)');
        } else {
            console.log(`  Error: ${e.message}`);
        }
    }

    await conn.end();
})().catch(err => { console.error(err); process.exit(1); });
