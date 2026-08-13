'use strict';

const PRODUCT_IMPORT_TEMPLATE_HEADERS = [
    'sku',
    'barcode',
    'name',
    'short_description',
    'description',
    'brand',
    'category',
    'price',
    'cost',
    'compare_price',
    'quantity',
    'weight',
    'image_url',
    'track_inventory',
    'is_taxable',
    'is_active',
    'is_featured',
    'show_on_web',
    'low_stock_threshold'
];

const PRODUCT_IMPORT_TEMPLATE_SAMPLE = [
    'SAMPLE-001',
    '012345678901',
    'Sample Vitamin C 500mg',
    'Immune support — 60 capsules.',
    'Full product description for the website and POS.',
    'Sample Brand',
    'Vitamins',
    '19.99',
    '10.50',
    '24.99',
    '25',
    '8.0',
    'https://example.com/images/sample-vitamin-c.jpg',
    'true',
    'true',
    'true',
    'false',
    'true',
    '5'
];

function escapeCsvCell(value) {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function rowToCsvLine(cells) {
    return cells.map(escapeCsvCell).join(',');
}

function buildProductImportTemplateCsv() {
    const lines = [
        PRODUCT_IMPORT_TEMPLATE_HEADERS.join(','),
        PRODUCT_IMPORT_TEMPLATE_SAMPLE.map(escapeCsvCell).join(',')
    ];
    return `${lines.join('\n')}\n`;
}

module.exports = {
    PRODUCT_IMPORT_TEMPLATE_HEADERS,
    buildProductImportTemplateCsv,
    escapeCsvCell,
    rowToCsvLine
};
