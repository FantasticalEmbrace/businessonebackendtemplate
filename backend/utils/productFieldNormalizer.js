'use strict';

const PRODUCT_BULK_ALLOWED_FIELDS = Object.freeze([
    'brand_id',
    'category_id',
    'price',
    'compare_price',
    'cost_price',
    'weight',
    'inventory_quantity',
    'low_stock_threshold',
    'is_active',
    'is_featured',
    'show_on_web',
    'is_cannabis'
]);

const PRODUCT_SINGLE_ALLOWED_FIELDS = Object.freeze([
    'sku',
    'name',
    'short_description',
    'long_description',
    'brand_id',
    'category_id',
    'price',
    'compare_price',
    'cost_price',
    'weight',
    'inventory_quantity',
    'low_stock_threshold',
    'is_active',
    'is_featured',
    'show_on_web',
    'is_cannabis',
    'coa_url',
    'coa_updated_at'
]);

const NUMERIC_FIELDS = new Set([
    'price',
    'compare_price',
    'cost_price',
    'weight',
    'inventory_quantity',
    'low_stock_threshold'
]);

const INTEGER_FIELDS = new Set(['brand_id', 'category_id', 'inventory_quantity', 'low_stock_threshold']);

const BOOLEAN_FIELDS = new Set(['is_active', 'is_featured', 'show_on_web', 'is_cannabis']);

function normalizeProductFieldValue(field, rawValue) {
    if (rawValue === undefined) return undefined;

    let value = rawValue;

    if (NUMERIC_FIELDS.has(field)) {
        if (value === '' || value === null) return null;
        const numValue = parseFloat(value);
        return Number.isNaN(numValue) ? null : numValue;
    }

    if (INTEGER_FIELDS.has(field)) {
        if (value === '' || value === null) return null;
        const intValue = parseInt(value, 10);
        return Number.isNaN(intValue) ? null : intValue;
    }

    if (BOOLEAN_FIELDS.has(field)) {
        if (value === '' || value === null) return false;
        return Boolean(value === true || value === 'true' || value === 1 || value === '1');
    }

    if (field === 'coa_url') {
        if (value === '' || value === null) return null;
        return String(value).trim().slice(0, 500);
    }

    if (field === 'coa_updated_at') {
        if (value === '' || value === null) return null;
        const d = new Date(String(value));
        return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }

    if (['short_description', 'long_description'].includes(field)) {
        if (value === '') return null;
    }

    if (field === 'sku' && value != null) {
        return String(value).trim();
    }

    return value;
}

function buildProductUpdateClause(updates, allowedFields = PRODUCT_BULK_ALLOWED_FIELDS) {
    const setParts = [];
    const setValues = [];
    const applied = {};

    for (const field of allowedFields) {
        if (updates[field] === undefined) continue;
        const value = normalizeProductFieldValue(field, updates[field]);
        setParts.push(`${field} = ?`);
        setValues.push(value);
        applied[field] = value;
    }

    return { setParts, setValues, applied };
}

async function validateProductReferences(pool, updates) {
    if (updates.brand_id !== undefined && updates.brand_id !== null) {
        const [rows] = await pool.execute('SELECT id FROM brands WHERE id = ? AND is_active = 1', [
            updates.brand_id
        ]);
        if (!rows.length) {
            const err = new Error('Selected brand was not found or is inactive.');
            err.code = 'INVALID_BRAND';
            throw err;
        }
    }

    if (updates.category_id !== undefined && updates.category_id !== null) {
        const [rows] = await pool.execute('SELECT id FROM product_categories WHERE id = ?', [
            updates.category_id
        ]);
        if (!rows.length) {
            const err = new Error('Selected category was not found.');
            err.code = 'INVALID_CATEGORY';
            throw err;
        }
    }
}

module.exports = {
    PRODUCT_BULK_ALLOWED_FIELDS,
    PRODUCT_SINGLE_ALLOWED_FIELDS,
    normalizeProductFieldValue,
    buildProductUpdateClause,
    validateProductReferences
};
