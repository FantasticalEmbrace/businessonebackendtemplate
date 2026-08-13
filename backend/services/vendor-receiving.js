'use strict';

const RECEIVABLE_STATUSES = ['open', 'partial'];

function normalizeCode(value) {
    return String(value || '').trim();
}

function normalizeCodeUpper(value) {
    return normalizeCode(value).toUpperCase();
}

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function buildSlipBarcode(poNumber) {
    const num = normalizeCode(poNumber);
    return num.toUpperCase().startsWith('PO-') ? num.toUpperCase() : `PO-${num}`;
}

function mapOrderRow(row) {
    return {
        id: row.id,
        vendorId: row.vendor_id,
        vendorName: row.vendor_name || null,
        poNumber: row.po_number,
        vendorReference: row.vendor_reference,
        slipBarcode: row.slip_barcode,
        status: row.status,
        orderedAt: row.ordered_at,
        expectedAt: row.expected_at,
        receivedAt: row.received_at,
        notes: row.notes,
        lineCount: Number(row.line_count || 0),
        qtyOrdered: toNumber(row.qty_ordered_total),
        qtyReceived: toNumber(row.qty_received_total)
    };
}

function mapLineRow(row) {
    const ordered = toNumber(row.qty_ordered);
    const received = toNumber(row.qty_received);
    return {
        id: row.id,
        purchaseOrderId: row.purchase_order_id,
        productId: row.product_id,
        variantId: row.variant_id,
        vendorSku: row.vendor_sku,
        productSku: row.product_sku,
        description: row.description,
        qtyOrdered: ordered,
        qtyReceived: received,
        qtyRemaining: Math.max(0, ordered - received),
        unitCost: row.unit_cost != null ? toNumber(row.unit_cost) : null,
        sortOrder: Number(row.sort_order || 0),
        complete: received >= ordered && ordered > 0
    };
}

class VendorReceivingService {
    constructor(pool) {
        this.pool = pool;
    }

    async listOrders({ status, vendorId, limit = 50 } = {}) {
        const where = [];
        const params = [];
        if (status) {
            const statuses = String(status)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            if (statuses.length) {
                where.push(`vpo.status IN (${statuses.map(() => '?').join(', ')})`);
                params.push(...statuses);
            }
        }
        if (vendorId) {
            where.push('vpo.vendor_id = ?');
            params.push(vendorId);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const [rows] = await this.pool.query(
            `
            SELECT vpo.*, v.name AS vendor_name,
                   COUNT(vpol.id) AS line_count,
                   COALESCE(SUM(vpol.qty_ordered), 0) AS qty_ordered_total,
                   COALESCE(SUM(vpol.qty_received), 0) AS qty_received_total
            FROM vendor_purchase_orders vpo
            LEFT JOIN vendors v ON v.id = vpo.vendor_id
            LEFT JOIN vendor_purchase_order_lines vpol ON vpol.purchase_order_id = vpo.id
            ${whereSql}
            GROUP BY vpo.id
            ORDER BY vpo.created_at DESC
            LIMIT ?
            `,
            [...params, Math.min(200, Math.max(1, Number(limit) || 50))]
        );
        return rows.map(mapOrderRow);
    }

    async getOrderById(orderId, { connection } = {}) {
        const db = connection || this.pool;
        const [orders] = await db.query(
            `
            SELECT vpo.*, v.name AS vendor_name
            FROM vendor_purchase_orders vpo
            LEFT JOIN vendors v ON v.id = vpo.vendor_id
            WHERE vpo.id = ?
            LIMIT 1
            `,
            [orderId]
        );
        if (!orders.length) return null;
        const [lines] = await db.query(
            `
            SELECT *
            FROM vendor_purchase_order_lines
            WHERE purchase_order_id = ?
            ORDER BY sort_order ASC, id ASC
            `,
            [orderId]
        );
        return {
            ...mapOrderRow(orders[0]),
            lines: lines.map(mapLineRow)
        };
    }

    async findOrderBySlipCode(code) {
        const raw = normalizeCode(code);
        if (!raw) return null;
        const candidates = [raw, raw.toUpperCase(), buildSlipBarcode(raw), buildSlipBarcode(raw).toUpperCase()];
        const unique = [...new Set(candidates.filter(Boolean))];
        const [rows] = await this.pool.query(
            `
            SELECT vpo.*, v.name AS vendor_name
            FROM vendor_purchase_orders vpo
            LEFT JOIN vendors v ON v.id = vpo.vendor_id
            WHERE vpo.slip_barcode IN (${unique.map(() => '?').join(', ')})
               OR vpo.po_number IN (${unique.map(() => '?').join(', ')})
            ORDER BY vpo.created_at DESC
            LIMIT 1
            `,
            [...unique, ...unique]
        );
        if (!rows.length) return null;
        return this.getOrderById(rows[0].id);
    }

    async resolveProductByScan(code, vendorId) {
        const scan = normalizeCode(code);
        if (!scan) return null;

        const [bySku] = await this.pool.query(
            `
            SELECT p.id AS product_id, NULL AS variant_id, p.sku AS product_sku, p.name AS description
            FROM products p
            WHERE p.sku = ? OR p.sku = ?
            LIMIT 1
            `,
            [scan, scan.toUpperCase()]
        );
        if (bySku.length) return bySku[0];

        const [byVariant] = await this.pool.query(
            `
            SELECT p.id AS product_id, pv.id AS variant_id, pv.sku AS product_sku,
                   CONCAT(p.name, ' — ', pv.name) AS description
            FROM product_variants pv
            JOIN products p ON p.id = pv.product_id
            WHERE pv.sku = ? OR pv.sku = ?
            LIMIT 1
            `,
            [scan, scan.toUpperCase()]
        );
        if (byVariant.length) return byVariant[0];

        if (vendorId) {
            const [byVendorSku] = await this.pool.query(
                `
                SELECT p.id AS product_id, NULL AS variant_id, p.sku AS product_sku, p.name AS description
                FROM vendor_products vp
                JOIN products p ON p.id = vp.product_id
                WHERE vp.vendor_id = ? AND (vp.vendor_sku = ? OR vp.vendor_sku = ?)
                LIMIT 1
                `,
                [vendorId, scan, scan.toUpperCase()]
            );
            if (byVendorSku.length) return byVendorSku[0];
        }

        return null;
    }

    findLineForScan(lines, scanCode, resolvedProduct) {
        const code = normalizeCodeUpper(scanCode);
        const exact =
            lines.find((line) => normalizeCodeUpper(line.productSku) === code) ||
            lines.find((line) => normalizeCodeUpper(line.vendorSku) === code);
        if (exact) return exact;

        if (resolvedProduct) {
            const byProduct = lines.find(
                (line) =>
                    line.productId === resolvedProduct.product_id &&
                    (line.variantId == null || line.variantId === resolvedProduct.variant_id)
            );
            if (byProduct) return byProduct;
        }
        return null;
    }

    async createOrder(payload, adminId = null) {
        const vendorId = Number(payload.vendorId);
        if (!vendorId) throw Object.assign(new Error('vendorId is required'), { code: 'VALIDATION' });

        const poNumber = normalizeCode(payload.poNumber);
        if (!poNumber) throw Object.assign(new Error('poNumber is required'), { code: 'VALIDATION' });

        const lines = Array.isArray(payload.lines) ? payload.lines : [];
        if (!lines.length) throw Object.assign(new Error('At least one line is required'), { code: 'VALIDATION' });

        const slipBarcode = normalizeCode(payload.slipBarcode) || buildSlipBarcode(poNumber);
        const status = payload.status === 'open' ? 'open' : 'draft';
        const connection = await this.pool.getConnection();

        try {
            await connection.beginTransaction();
            const [result] = await connection.query(
                `
                INSERT INTO vendor_purchase_orders
                    (vendor_id, po_number, vendor_reference, slip_barcode, status, ordered_at, expected_at, notes, created_by_admin_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    vendorId,
                    poNumber,
                    normalizeCode(payload.vendorReference) || null,
                    slipBarcode,
                    status,
                    payload.orderedAt || new Date(),
                    payload.expectedAt || null,
                    normalizeCode(payload.notes) || null,
                    adminId
                ]
            );
            const orderId = result.insertId;
            let sort = 0;
            for (const line of lines) {
                sort += 1;
                const qtyOrdered = Math.max(0, toNumber(line.qtyOrdered, 0));
                const resolved = await this.resolveLineProduct(connection, vendorId, line);
                await connection.query(
                    `
                    INSERT INTO vendor_purchase_order_lines
                        (purchase_order_id, product_id, variant_id, vendor_sku, product_sku, description, qty_ordered, unit_cost, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                    [
                        orderId,
                        resolved.productId,
                        resolved.variantId,
                        resolved.vendorSku,
                        resolved.productSku,
                        resolved.description,
                        qtyOrdered,
                        line.unitCost != null ? toNumber(line.unitCost) : null,
                        sort
                    ]
                );
            }
            await connection.commit();
            return this.getOrderById(orderId);
        } catch (err) {
            await connection.rollback();
            if (err?.code === 'ER_DUP_ENTRY') {
                throw Object.assign(new Error('A purchase order with that number or slip barcode already exists'), {
                    code: 'DUPLICATE_PO'
                });
            }
            throw err;
        } finally {
            connection.release();
        }
    }

    async resolveLineProduct(connection, vendorId, line) {
        const vendorSku = normalizeCode(line.vendorSku) || null;
        const productSku = normalizeCode(line.sku || line.productSku) || null;
        const description = normalizeCode(line.description) || productSku || vendorSku || 'Item';

        if (productSku) {
            const [rows] = await connection.query(
                `SELECT id, sku, name FROM products WHERE sku = ? OR sku = ? LIMIT 1`,
                [productSku, productSku.toUpperCase()]
            );
            if (rows.length) {
                return {
                    productId: rows[0].id,
                    variantId: null,
                    vendorSku,
                    productSku: rows[0].sku,
                    description: normalizeCode(line.description) || rows[0].name
                };
            }
        }

        if (vendorSku) {
            const [rows] = await connection.query(
                `
                SELECT p.id, p.sku, p.name, vp.vendor_sku
                FROM vendor_products vp
                JOIN products p ON p.id = vp.product_id
                WHERE vp.vendor_id = ? AND (vp.vendor_sku = ? OR vp.vendor_sku = ?)
                LIMIT 1
                `,
                [vendorId, vendorSku, vendorSku.toUpperCase()]
            );
            if (rows.length) {
                return {
                    productId: rows[0].id,
                    variantId: null,
                    vendorSku: rows[0].vendor_sku || vendorSku,
                    productSku: rows[0].sku,
                    description: normalizeCode(line.description) || rows[0].name
                };
            }
        }

        return {
            productId: line.productId ? Number(line.productId) : null,
            variantId: line.variantId ? Number(line.variantId) : null,
            vendorSku,
            productSku,
            description
        };
    }

    async openOrder(orderId) {
        const [result] = await this.pool.query(
            `UPDATE vendor_purchase_orders SET status = 'open' WHERE id = ? AND status IN ('draft', 'partial', 'submitted')`,
            [orderId]
        );
        if (!result.affectedRows) {
            throw Object.assign(new Error('Purchase order cannot be opened'), { code: 'INVALID_STATE' });
        }
        return this.getOrderById(orderId);
    }

    async scanReceive(orderId, { code, qty = 1, employeeId = null, deviceId = null, allowOverReceive = false } = {}) {
        const scanCode = normalizeCode(code);
        if (!scanCode) throw Object.assign(new Error('Scan code is required'), { code: 'VALIDATION' });

        const delta = Math.max(0.001, toNumber(qty, 1));
        const connection = await this.pool.getConnection();

        try {
            await connection.beginTransaction();
            const [orders] = await connection.query(
                `SELECT * FROM vendor_purchase_orders WHERE id = ? FOR UPDATE`,
                [orderId]
            );
            if (!orders.length) throw Object.assign(new Error('Purchase order not found'), { code: 'NOT_FOUND' });
            const order = orders[0];
            if (!RECEIVABLE_STATUSES.includes(order.status)) {
                throw Object.assign(new Error('This purchase order is not open for receiving'), { code: 'INVALID_STATE' });
            }

            const [lineRows] = await connection.query(
                `SELECT * FROM vendor_purchase_order_lines WHERE purchase_order_id = ? FOR UPDATE`,
                [orderId]
            );
            const lines = lineRows.map(mapLineRow);
            const resolved = await this.resolveProductByScan(scanCode, order.vendor_id);
            const line = this.findLineForScan(lines, scanCode, resolved);
            if (!line) {
                throw Object.assign(new Error('Scanned item is not on this order slip'), { code: 'LINE_NOT_FOUND' });
            }

            const nextQty = toNumber(line.qtyReceived) + delta;
            if (!allowOverReceive && nextQty > toNumber(line.qtyOrdered) + 0.0001) {
                throw Object.assign(new Error('Received quantity would exceed ordered quantity'), {
                    code: 'OVER_RECEIVE',
                    lineId: line.id,
                    qtyOrdered: line.qtyOrdered,
                    qtyReceived: line.qtyReceived
                });
            }

            await connection.query(
                `UPDATE vendor_purchase_order_lines SET qty_received = ? WHERE id = ?`,
                [nextQty, line.id]
            );
            await connection.query(
                `
                INSERT INTO vendor_receiving_events
                    (purchase_order_id, line_id, employee_id, device_id, scan_code, qty_delta)
                VALUES (?, ?, ?, ?, ?, ?)
                `,
                [orderId, line.id, employeeId, deviceId || null, scanCode, delta]
            );

            const updatedLines = lines.map((l) =>
                l.id === line.id ? { ...l, qtyReceived: nextQty, qtyRemaining: Math.max(0, l.qtyOrdered - nextQty) } : l
            );
            const totalOrdered = updatedLines.reduce((sum, l) => sum + l.qtyOrdered, 0);
            const totalReceived = updatedLines.reduce((sum, l) => sum + l.qtyReceived, 0);
            const anyReceived = totalReceived > 0;
            const nextStatus = anyReceived ? 'partial' : 'open';

            await connection.query(`UPDATE vendor_purchase_orders SET status = ? WHERE id = ?`, [nextStatus, orderId]);
            await connection.commit();

            const updatedOrder = await this.getOrderById(orderId);
            return {
                order: updatedOrder,
                line: updatedOrder.lines.find((l) => l.id === line.id),
                scanCode,
                qtyAdded: delta
            };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async completeReceiving(orderId, { allowOverReceive = false, employeeId = null, deviceId = null } = {}) {
        const order = await this.getOrderById(orderId);
        if (!order) throw Object.assign(new Error('Purchase order not found'), { code: 'NOT_FOUND' });
        if (!RECEIVABLE_STATUSES.includes(order.status)) {
            throw Object.assign(new Error('Purchase order is not receivable'), { code: 'INVALID_STATE' });
        }

        const overLines = order.lines.filter((l) => l.qtyReceived > l.qtyOrdered + 0.0001);
        if (overLines.length && !allowOverReceive) {
            throw Object.assign(new Error('Manager approval required — received quantity exceeds ordered on one or more lines'), {
                code: 'OVER_RECEIVE',
                lines: overLines
            });
        }

        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            for (const line of order.lines) {
                const delta = toNumber(line.qtyReceived);
                if (delta <= 0 || !line.productId) continue;
                await this.adjustInventory(connection, line, delta);
            }
            await connection.query(
                `UPDATE vendor_purchase_orders SET status = 'received', received_at = NOW() WHERE id = ?`,
                [orderId]
            );
            await connection.commit();
            return this.getOrderById(orderId);
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async adjustInventory(connection, line, qtyReceived) {
        if (!line.productId || qtyReceived <= 0) return;

        if (line.variantId) {
            await connection.query(
                `
                UPDATE product_variants
                SET inventory_quantity = COALESCE(inventory_quantity, 0) + ?
                WHERE id = ?
                `,
                [qtyReceived, line.variantId]
            );
        } else {
            await connection.query(
                `
                UPDATE products
                SET inventory_quantity = COALESCE(inventory_quantity, 0) + ?
                WHERE id = ?
                `,
                [qtyReceived, line.productId]
            );
        }
    }

    async listVendors() {
        try {
            const [rows] = await this.pool.query(
                `
                SELECT id, name, status, catalog_url,
                       COALESCE(pos_ordering_enabled, 1) AS pos_ordering_enabled
                FROM vendors
                WHERE status IS NULL OR status != 'deleted'
                ORDER BY name ASC
                `
            );
            return rows.map((row) => ({
                id: row.id,
                name: row.name,
                status: row.status,
                catalogUrl: row.catalog_url || null,
                posOrderingEnabled: Boolean(row.pos_ordering_enabled)
            }));
        } catch {
            return [];
        }
    }

    async importCsvLines(vendorId, csvText) {
        const rows = String(csvText || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        if (rows.length < 2) {
            throw Object.assign(new Error('CSV must include a header row and at least one line'), { code: 'VALIDATION' });
        }

        const header = rows[0].split(',').map((h) => h.trim().toLowerCase());
        const idx = (names) => header.findIndex((h) => names.includes(h));
        const skuIdx = idx(['sku', 'product_sku', 'product sku']);
        const vendorSkuIdx = idx(['vendor_sku', 'vendor sku', 'vendor code', 'item']);
        const qtyIdx = idx(['qty', 'qty_ordered', 'quantity', 'ordered']);
        const descIdx = idx(['description', 'name', 'product']);
        const costIdx = idx(['unit_cost', 'cost', 'price']);

        if (skuIdx < 0 && vendorSkuIdx < 0) {
            throw Object.assign(new Error('CSV needs a sku or vendor_sku column'), { code: 'VALIDATION' });
        }
        if (qtyIdx < 0) {
            throw Object.assign(new Error('CSV needs a qty or quantity column'), { code: 'VALIDATION' });
        }

        const lines = [];
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i].split(',').map((c) => c.trim());
            const qtyOrdered = toNumber(cols[qtyIdx], 0);
            if (qtyOrdered <= 0) continue;
            lines.push({
                sku: skuIdx >= 0 ? cols[skuIdx] : null,
                vendorSku: vendorSkuIdx >= 0 ? cols[vendorSkuIdx] : null,
                description: descIdx >= 0 ? cols[descIdx] : null,
                qtyOrdered,
                unitCost: costIdx >= 0 ? toNumber(cols[costIdx]) : null
            });
        }

        if (!lines.length) {
            throw Object.assign(new Error('No valid lines found in CSV'), { code: 'VALIDATION' });
        }

        return lines;
    }

    async updateVendorCatalogSettings(vendorId, { catalogUrl, posOrderingEnabled = true }) {
        try {
            await this.pool.query(
                `
                UPDATE vendors
                SET catalog_url = ?, pos_ordering_enabled = ?
                WHERE id = ?
                `,
                [catalogUrl || null, posOrderingEnabled ? 1 : 0, vendorId]
            );
        } catch (err) {
            if (err?.code === 'ER_BAD_FIELD_ERROR') {
                await this.pool.query(`UPDATE vendors SET catalog_url = ? WHERE id = ?`, [catalogUrl || null, vendorId]);
                return;
            }
            throw err;
        }
    }
}

module.exports = { VendorReceivingService, buildSlipBarcode };
