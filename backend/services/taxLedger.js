const logger = require('../utils/logger');
const { resolveCounty } = require('../utils/zipCountyLookup');

const TARGET_STATES = new Set(['GA', 'NC', 'IN', 'MI', 'OH']);

function toDateKey(input = new Date()) {
    const date = input instanceof Date ? input : new Date(input);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function toMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeStateCode(raw) {
    return String(raw || '').trim().toUpperCase();
}

function isTargetState(stateCode) {
    return TARGET_STATES.has(normalizeStateCode(stateCode));
}

class TaxLedgerService {
    constructor(pool) {
        this.pool = pool;
    }

    async ensureDailyReserve(dateKey) {
        await this.pool.execute(
            `INSERT INTO daily_tax_reserves (date, webstore_total, pos_total, combined_reserve_needed, status)
             VALUES (?, 0, 0, 0, 'pending')
             ON DUPLICATE KEY UPDATE date = VALUES(date)`,
            [dateKey]
        );
    }

    async upsertDailyReserve(dateKey) {
        await this.pool.execute(
            `INSERT INTO daily_tax_reserves (date, webstore_total, pos_total, combined_reserve_needed, status)
             SELECT ?, 
                    COALESCE(SUM(CASE WHEN source = 'webstore' THEN tax_amount ELSE 0 END), 0) AS webstore_total,
                    COALESCE(SUM(CASE WHEN source = 'pos' THEN tax_amount ELSE 0 END), 0) AS pos_total,
                    COALESCE(SUM(tax_amount), 0) AS combined_reserve_needed,
                    'pending'
               FROM tax_entries
              WHERE DATE(created_at) = ?
             ON DUPLICATE KEY UPDATE
                webstore_total = VALUES(webstore_total),
                pos_total = VALUES(pos_total),
                combined_reserve_needed = VALUES(combined_reserve_needed)`,
            [dateKey, dateKey]
        );
    }

    async syncWebstoreTaxEntries(dateKey) {
        const [orders] = await this.pool.execute(
            `SELECT id, order_number, tax_amount, shipping_state, shipping_postal_code, created_at
               FROM orders
              WHERE DATE(created_at) = ?
                AND COALESCE(tax_amount, 0) > 0
                AND status NOT IN ('cancelled', 'refunded')
                AND COALESCE(sales_channel, 'online') = 'online'`,
            [dateKey]
        );

        let inserted = 0;
        for (const row of orders) {
            const stateCode = normalizeStateCode(row.shipping_state);
            if (!isTargetState(stateCode)) continue;

            const taxAmount = toMoney(row.tax_amount);
            const orderId = row.order_number || `WEB-${row.id}`;
            const zipCode = row.shipping_postal_code || null;
            const countyName =
                resolveCounty({ orderCounty: null, zip: zipCode, stateCode }) || null;
            await this.pool.execute(
                `INSERT INTO tax_entries (order_id, source, tax_amount, taxable_amount, state_code, zip_code, county_name, created_at)
                 VALUES (?, 'webstore', ?, NULL, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    tax_amount = VALUES(tax_amount),
                    state_code = VALUES(state_code),
                    zip_code = VALUES(zip_code),
                    county_name = VALUES(county_name),
                    created_at = VALUES(created_at)`,
                [
                    String(orderId),
                    taxAmount,
                    stateCode,
                    zipCode,
                    countyName,
                    row.created_at
                ]
            );
            inserted += 1;
        }

        await this.upsertDailyReserve(dateKey);
        return { inserted };
    }

    async syncPosTaxEntries(dateKey) {
        // In-store POS tax sync has been removed; only webstore sales are tracked now.
        await this.upsertDailyReserve(dateKey);
        return { inserted: 0, totalTax: 0, fetchedOrders: 0, skipped: true, reason: 'POS sync disabled' };
    }

    async runDailySync(dateKey = toDateKey()) {
        await this.ensureDailyReserve(dateKey);
        const webstore = await this.syncWebstoreTaxEntries(dateKey);
        const pos = await this.syncPosTaxEntries(dateKey);
        await this.upsertDailyReserve(dateKey);
        return { date: dateKey, webstore, pos };
    }

    async getDailyOverview(dateKey = toDateKey()) {
        await this.ensureDailyReserve(dateKey);
        await this.syncWebstoreTaxEntries(dateKey);
        await this.upsertDailyReserve(dateKey);

        const [[reserve]] = await this.pool.execute(
            `SELECT date, webstore_total, pos_total, combined_reserve_needed, status, updated_at
               FROM daily_tax_reserves
              WHERE date = ?`,
            [dateKey]
        );

        return reserve || null;
    }

    async markTransferred(dateKey = toDateKey()) {
        await this.ensureDailyReserve(dateKey);
        await this.pool.execute(
            `UPDATE daily_tax_reserves
                SET status = 'transferred'
              WHERE date = ?`,
            [dateKey]
        );
        return this.getDailyOverview(dateKey);
    }

    async syncDateRange(startDate, endDate) {
        const start = new Date(`${startDate}T12:00:00`);
        const end = new Date(`${endDate}T12:00:00`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            throw new Error('Invalid date range');
        }
        if (start > end) {
            throw new Error('startDate must be on or before endDate');
        }

        const days = [];
        for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
            const dateKey = toDateKey(cursor);
            days.push(await this.runDailySync(dateKey));
        }
        return { startDate, endDate, daysSynced: days.length, days };
    }
}

module.exports = {
    TaxLedgerService,
    toDateKey
};
