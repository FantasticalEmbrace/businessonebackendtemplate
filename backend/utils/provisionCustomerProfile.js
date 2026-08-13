'use strict';

/**
 * Ensures storefront customer profile satellites exist for a user id:
 *   - users.customer_number (HM-CUST-000123) when column exists
 *   - customer_loyalty row (1:1 with users)
 *   - default wishlist_collections row ("My Wishlist")
 *
 * Idempotent. Ignores missing tables/columns so older DBs without migrations
 * still run register/login.
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} userId
 * @param {{ warn?: (msg: string, meta?: object) => void }} [log]
 */
async function provisionWebCustomerProfile(pool, userId, log = console) {
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0) return;

    const ignoreSchema = (err) => {
        const no = err && err.errno;
        const code = err && err.code;
        if (no === 1054 || no === 1146) return true;
        if (code === 'ER_BAD_FIELD_ERROR' || code === 'ER_NO_SUCH_TABLE') return true;
        return false;
    };

    const run = async (fn) => {
        try {
            await fn();
        } catch (err) {
            if (!ignoreSchema(err)) {
                log.warn?.('[provisionWebCustomerProfile]', err.message);
            }
        }
    };

    await run(async () => {
        await pool.execute(
            `UPDATE users SET customer_number = CONCAT('HM-CUST-', LPAD(id, 6, '0'))
             WHERE id = ? AND (customer_number IS NULL OR customer_number = '')`,
            [uid]
        );
    });

    await run(async () => {
        await pool.execute(
            'INSERT IGNORE INTO customer_loyalty (user_id, member_since) VALUES (?, CURDATE())',
            [uid]
        );
    });

    await run(async () => {
        const [[row]] = await pool.execute(
            'SELECT COUNT(*) AS n FROM wishlist_collections WHERE user_id = ? AND is_default = 1',
            [uid]
        );
        if (!row || Number(row.n) > 0) return;
        await pool.execute(
            `INSERT INTO wishlist_collections (user_id, name, is_default, sort_order) VALUES (?, 'My Wishlist', 1, 0)`,
            [uid]
        );
    });
}

module.exports = { provisionWebCustomerProfile };
