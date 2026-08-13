const fs = require('fs');
const path = require('path');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { catalogPriceForSku, canonicalSkuForCatalog } = require('../utils/catalogOverrides');

loadBackendEnv();

function normalizeSku(sku) {
    return String(sku || '').trim().toUpperCase().replace(/^HM-/, '');
}
function skuFromProductSlug(slug) {
    const m = String(slug || '').match(/-sku-([a-z0-9-]+)$/i);
    return m ? m[1] : '';
}

function loadIndex() {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/scraped-products.json'), 'utf8'));
    const bySku = new Map();
    const bySlug = new Map();
    for (const product of data.products || []) {
        const sku = String(product.sku || '').trim();
        const price = parseFloat(product.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        const entry = { price, sku };
        if (sku) {
            bySku.set(sku.toUpperCase(), entry);
            bySku.set(normalizeSku(sku), entry);
            bySku.set(canonicalSkuForCatalog(sku), entry);
        }
        const m = String(product.url || '').match(/\/products\/([^/?#]+)/i);
        if (m) bySlug.set(decodeURIComponent(m[1]).toLowerCase(), entry);
    }
    return { bySku, bySlug };
}

function trace(row, index) {
    const steps = [];
    const override = catalogPriceForSku(row.sku) ?? catalogPriceForSku(skuFromProductSlug(row.slug));
    if (override != null) steps.push({ step: 'override', price: override });

    const sku = String(row.sku || '').trim();
    if (sku && index.bySku.has(sku.toUpperCase())) steps.push({ step: 'sku.upper', key: sku.toUpperCase(), ...index.bySku.get(sku.toUpperCase()) });
    const norm = normalizeSku(sku);
    if (norm && index.bySku.has(norm)) steps.push({ step: 'sku.norm', key: norm, ...index.bySku.get(norm) });

    const slugSku = normalizeSku(skuFromProductSlug(row.slug));
    if (slugSku && index.bySku.has(slugSku)) steps.push({ step: 'slugSku', key: slugSku, ...index.bySku.get(slugSku) });

    const slug = String(row.slug || '').trim().toLowerCase();
    if (slug && index.bySlug.has(slug)) steps.push({ step: 'slug', key: slug, ...index.bySlug.get(slug) });
    const slugBase = slug.replace(/-sku-[a-z0-9-]+$/i, '');
    if (slugBase && index.bySlug.has(slugBase)) steps.push({ step: 'slugBase', key: slugBase, ...index.bySlug.get(slugBase) });

    return steps;
}

(async () => {
    const index = loadIndex();
    const pool = createPool({ connectionLimit: 2 });
    const [rows] = await pool.query('SELECT id, sku, slug, price FROM products WHERE id IN (39,40,41,42) ORDER BY id');
    for (const row of rows) {
        console.log('\n', row.id, row.sku);
        console.log(trace(row, index));
    }
    await pool.end();
})();
