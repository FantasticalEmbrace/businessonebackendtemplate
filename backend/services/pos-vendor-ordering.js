'use strict';

const { VendorReceivingService, buildSlipBarcode } = require('./vendor-receiving');
const { fetchAndParseVendorCatalog, parseCatalogCsv, parseCatalogJson } = require('../utils/vendorCatalogFetch');

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeCode(value) {
    return String(value || '').trim();
}

class PosVendorOrderingService {
    constructor(pool) {
        this.pool = pool;
        this.receiving = new VendorReceivingService(pool);
    }

    async listVendors() {
        try {
            const [rows] = await this.pool.query(
                `
                SELECT v.id, v.name, v.status,
                       v.catalog_url,
                       COALESCE(v.pos_ordering_enabled, 1) AS pos_ordering_enabled,
                       v.last_catalog_sync_at,
                       (SELECT COUNT(*) FROM vendor_products vp WHERE vp.vendor_id = v.id) AS catalog_count
                FROM vendors v
                WHERE (v.status IS NULL OR v.status != 'deleted')
                  AND COALESCE(v.pos_ordering_enabled, 1) = 1
                ORDER BY v.name ASC
                `
            );
            return rows.map((row) => ({
                id: row.id,
                name: row.name,
                status: row.status,
                catalogUrl: row.catalog_url || null,
                posOrderingEnabled: Boolean(row.pos_ordering_enabled),
                lastCatalogSyncAt: row.last_catalog_sync_at || null,
                catalogCount: Number(row.catalog_count || 0),
                connected: Boolean(row.catalog_url) || Number(row.catalog_count || 0) > 0
            }));
        } catch (err) {
            if (err?.code === 'ER_BAD_FIELD_ERROR') {
                const [rows] = await this.pool.query(
                    `
                    SELECT v.id, v.name, v.status,
                       (SELECT COUNT(*) FROM vendor_products vp WHERE vp.vendor_id = v.id) AS catalog_count
                FROM vendors v
                WHERE (v.status IS NULL OR v.status != 'deleted')
                  AND COALESCE(v.pos_ordering_enabled, 1) = 1
                ORDER BY v.name ASC
                    `
                );
                return rows.map((row) => ({
                    id: row.id,
                    name: row.name,
                    status: row.status,
                    catalogUrl: null,
                    posOrderingEnabled: true,
                    lastCatalogSyncAt: null,
                    catalogCount: Number(row.catalog_count || 0),
                    connected: Number(row.catalog_count || 0) > 0
                }));
            }
            throw err;
        }
    }

    async getCatalog(vendorId, { q = '', page = 1, limit = 50 } = {}) {
        const offset = (Math.max(1, Number(page) || 1) - 1) * Math.min(200, Math.max(1, Number(limit) || 50));
        const pageLimit = Math.min(200, Math.max(1, Number(limit) || 50));
        const search = normalizeCode(q);
        const params = [vendorId];
        let searchSql = '';
        if (search) {
            searchSql = ` AND (
                p.name LIKE ? OR p.sku LIKE ? OR vp.vendor_sku LIKE ?
            )`;
            const like = `%${search}%`;
            params.push(like, like, like);
        }

        const [rows] = await this.pool.query(
            `
            SELECT vp.id AS vendor_product_id, vp.vendor_sku, vp.wholesale_price, vp.minimum_order_quantity,
                   p.id AS product_id, p.sku AS product_sku, p.name, p.inventory_quantity
            FROM vendor_products vp
            JOIN products p ON p.id = vp.product_id
            WHERE vp.vendor_id = ?
            ${searchSql}
            ORDER BY p.name ASC
            LIMIT ? OFFSET ?
            `,
            [...params, pageLimit, offset]
        );

        const [countRows] = await this.pool.query(
            `
            SELECT COUNT(*) AS total
            FROM vendor_products vp
            JOIN products p ON p.id = vp.product_id
            WHERE vp.vendor_id = ?
            ${searchSql}
            `,
            params
        );

        const items = rows.map((row) => ({
            vendorProductId: row.vendor_product_id,
            productId: row.product_id,
            vendorSku: row.vendor_sku,
            productSku: row.product_sku,
            name: row.name,
            unitCost: row.wholesale_price != null ? toNumber(row.wholesale_price) : null,
            minimumOrderQuantity: Math.max(1, toNumber(row.minimum_order_quantity, 1)),
            inventoryQuantity: row.inventory_quantity != null ? toNumber(row.inventory_quantity) : null
        }));

        return {
            items,
            page: Math.max(1, Number(page) || 1),
            limit: pageLimit,
            total: Number(countRows[0]?.total || 0)
        };
    }

    async syncCatalogFromUrl(vendorId) {
        const [vendors] = await this.pool.query(
            `
            SELECT id, name, catalog_url, catalog_format, catalog_auth_type, catalog_auth_credentials
            FROM vendors
            WHERE id = ?
            LIMIT 1
            `,
            [vendorId]
        );
        if (!vendors.length) {
            throw Object.assign(new Error('Vendor not found'), { code: 'NOT_FOUND' });
        }
        const vendor = vendors[0];
        const items = await fetchAndParseVendorCatalog(vendor);

        const connection = await this.pool.getConnection();
        let imported = 0;
        try {
            await connection.beginTransaction();
            for (const item of items) {
                const productId = await this.ensureProductForCatalogItem(connection, item);
                await connection.query(
                    `
                    INSERT INTO vendor_products (vendor_id, product_id, vendor_sku, wholesale_price, minimum_order_quantity, mapping_status)
                    VALUES (?, ?, ?, ?, ?, 'mapped')
                    ON DUPLICATE KEY UPDATE
                        vendor_sku = VALUES(vendor_sku),
                        wholesale_price = COALESCE(VALUES(wholesale_price), wholesale_price),
                        minimum_order_quantity = COALESCE(VALUES(minimum_order_quantity), minimum_order_quantity),
                        mapping_status = 'mapped'
                    `,
                    [
                        vendorId,
                        productId,
                        item.vendorSku || item.sku || null,
                        item.unitCost,
                        item.minimumOrderQuantity || 1
                    ]
                );
                imported += 1;
            }
            try {
                await connection.query(`UPDATE vendors SET last_catalog_sync_at = NOW() WHERE id = ?`, [vendorId]);
            } catch {
                /* column may not exist yet */
            }
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }

        return { imported, vendorId, vendorName: vendor.name };
    }

    async ensureProductForCatalogItem(connection, item) {
        const sku = normalizeCode(item.sku || item.vendorSku);
        if (!sku) {
            throw Object.assign(new Error('Catalog item missing SKU'), { code: 'VALIDATION' });
        }
        const [existing] = await connection.query(`SELECT id FROM products WHERE sku = ? LIMIT 1`, [sku]);
        if (existing.length) return existing[0].id;

        const [result] = await connection.query(
            `
            INSERT INTO products (sku, name, price, cost, is_active, track_inventory)
            VALUES (?, ?, ?, ?, 1, 1)
            `,
            [sku, item.name || sku, item.unitCost != null ? item.unitCost * 1.5 : 0, item.unitCost]
        );
        return result.insertId;
    }

    async submitOrder(vendorId, payload, { employeeId = null, deviceId = null } = {}) {
        const lines = Array.isArray(payload.lines) ? payload.lines : [];
        if (!lines.length) {
            throw Object.assign(new Error('Add at least one item to the order'), { code: 'VALIDATION' });
        }

        const catalog = await this.getCatalog(vendorId, { limit: 5000 });
        const byProductId = new Map(catalog.items.map((i) => [i.productId, i]));
        const byVendorSku = new Map(catalog.items.filter((i) => i.vendorSku).map((i) => [String(i.vendorSku).toUpperCase(), i]));
        const byProductSku = new Map(catalog.items.filter((i) => i.productSku).map((i) => [String(i.productSku).toUpperCase(), i]));

        const normalizedLines = [];
        for (const line of lines) {
            const qty = Math.max(0, toNumber(line.qty || line.quantity, 0));
            if (qty <= 0) continue;

            let catalogItem =
                (line.productId && byProductId.get(Number(line.productId))) ||
                (line.vendorSku && byVendorSku.get(String(line.vendorSku).toUpperCase())) ||
                (line.sku && byProductSku.get(String(line.sku).toUpperCase()));

            if (!catalogItem) {
                throw Object.assign(new Error(`Item not in vendor catalog: ${line.name || line.sku || line.vendorSku}`), {
                    code: 'NOT_IN_CATALOG'
                });
            }
            const moq = Math.max(1, catalogItem.minimumOrderQuantity || 1);
            if (qty < moq) {
                throw Object.assign(new Error(`${catalogItem.name} requires minimum order of ${moq}`), { code: 'BELOW_MOQ' });
            }

            normalizedLines.push({
                productId: catalogItem.productId,
                sku: catalogItem.productSku,
                vendorSku: catalogItem.vendorSku,
                description: catalogItem.name,
                qtyOrdered: qty,
                unitCost: catalogItem.unitCost
            });
        }

        if (!normalizedLines.length) {
            throw Object.assign(new Error('No valid order lines'), { code: 'VALIDATION' });
        }

        const poNumber = normalizeCode(payload.poNumber) || `POS-${Date.now().toString(36).toUpperCase()}`;
        const order = await this.createPosPurchaseOrder({
            vendorId,
            poNumber,
            notes: normalizeCode(payload.notes) || null,
            lines: normalizedLines,
            employeeId,
            deviceId,
            status: 'submitted'
        });

        return order;
    }

    async createPosPurchaseOrder({ vendorId, poNumber, notes, lines, employeeId, deviceId, status = 'submitted' }) {
        const slipBarcode = buildSlipBarcode(poNumber);
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [result] = await connection.query(
                `
                INSERT INTO vendor_purchase_orders
                    (vendor_id, po_number, slip_barcode, status, ordered_at, notes, order_source, submitted_by_employee_id, pos_device_id)
                VALUES (?, ?, ?, ?, NOW(), ?, 'pos', ?, ?)
                `,
                [vendorId, poNumber, slipBarcode, status, notes, employeeId, deviceId || null]
            );
            const orderId = result.insertId;
            let sort = 0;
            for (const line of lines) {
                sort += 1;
                await connection.query(
                    `
                    INSERT INTO vendor_purchase_order_lines
                        (purchase_order_id, product_id, vendor_sku, product_sku, description, qty_ordered, unit_cost, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                    [
                        orderId,
                        line.productId,
                        line.vendorSku || null,
                        line.sku || line.productSku || null,
                        line.description,
                        line.qtyOrdered,
                        line.unitCost != null ? line.unitCost : null,
                        sort
                    ]
                );
            }
            await connection.commit();
            return this.receiving.getOrderById(orderId);
        } catch (err) {
            await connection.rollback();
            if (err?.code === 'ER_DUP_ENTRY') {
                throw Object.assign(new Error('Order number already used — try again'), { code: 'DUPLICATE_PO' });
            }
            if (err?.code === 'ER_BAD_FIELD_ERROR') {
                return this.receiving.createOrder(
                    { vendorId, poNumber, notes, lines, status: 'open' },
                    null
                );
            }
            throw err;
        } finally {
            connection.release();
        }
    }

    async listSubmittedOrders({ vendorId, limit = 30 } = {}) {
        return this.receiving.listOrders({ status: 'submitted', vendorId, limit });
    }
}

module.exports = { PosVendorOrderingService, parseCatalogCsv, parseCatalogJson };
