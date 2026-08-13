'use strict';

const {
    PRODUCT_IMPORT_TEMPLATE_HEADERS,
    rowToCsvLine
} = require('../utils/productImportTemplate');

function boolCsv(value) {
    return value === true || value === 1 || value === '1' ? 'true' : 'false';
}

function moneyCsv(value) {
    if (value == null || value === '') return '';
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : '';
}

function qtyCsv(value) {
    if (value == null || value === '') return '0';
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? String(n) : '0';
}

async function columnExists(pool, tableName, columnName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );
    return Number(rows[0].c) > 0;
}

/**
 * Build a CSV backup of the full product catalog (re-importable via admin CSV import).
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<{ csv: string, count: number }>}
 */
async function buildProductCatalogExportCsv(pool) {
    const hasShowOnWeb = await columnExists(pool, 'products', 'show_on_web');
    const showOnWebSelect = hasShowOnWeb ? 'p.show_on_web' : '1 AS show_on_web';

    const [rows] = await pool.execute(
        `SELECT p.sku, p.name, p.short_description, p.long_description,
                p.price, p.cost_price, p.compare_price, p.inventory_quantity, p.weight,
                p.track_inventory, p.is_taxable, p.is_active, p.is_featured,
                ${showOnWebSelect},
                p.low_stock_threshold,
                b.name AS brand_name,
                pc.name AS category_name,
                (
                    SELECT GROUP_CONCAT(pi.image_url ORDER BY pi.is_primary DESC, pi.sort_order SEPARATOR '|')
                      FROM product_images pi
                     WHERE pi.product_id = p.id
                ) AS image_urls
           FROM products p
           LEFT JOIN brands b ON b.id = p.brand_id
           LEFT JOIN product_categories pc ON pc.id = p.category_id
          ORDER BY p.name ASC`
    );

    const lines = [PRODUCT_IMPORT_TEMPLATE_HEADERS.join(',')];

    for (const row of rows) {
        lines.push(
            rowToCsvLine([
                row.sku || '',
                row.sku || '',
                row.name || '',
                row.short_description || '',
                row.long_description || '',
                row.brand_name || '',
                row.category_name || '',
                moneyCsv(row.price),
                moneyCsv(row.cost_price),
                moneyCsv(row.compare_price),
                qtyCsv(row.inventory_quantity),
                row.weight != null && row.weight !== '' ? String(row.weight) : '',
                row.image_urls || '',
                boolCsv(row.track_inventory),
                boolCsv(row.is_taxable),
                boolCsv(row.is_active),
                boolCsv(row.is_featured),
                boolCsv(row.show_on_web),
                qtyCsv(row.low_stock_threshold)
            ])
        );
    }

    return {
        csv: `${lines.join('\n')}\n`,
        count: rows.length
    };
}

module.exports = { buildProductCatalogExportCsv };
