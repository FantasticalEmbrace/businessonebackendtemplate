const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const axios = require('axios');
const cheerio = require('cheerio');

loadBackendEnv();

const HEADERS = { 'User-Agent': 'Mozilla/5.0' };

function extractPrice($) {
    const text = $('.store-product-price, .product-price, .price').first().text().trim();
    const match = text.match(/\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
    if (match) {
        const price = parseFloat(match[1].replace(/,/g, ''));
        if (Number.isFinite(price) && price >= 0) return price;
    }
    return null;
}

(async () => {
    const pool = createPool();
    const [rows] = await pool.query(
        `SELECT id, slug, name, price FROM products WHERE is_active=1 AND price=25 AND sku NOT LIKE 'GC-%' ORDER BY id`
    );
    for (const row of rows) {
        const slugBase = String(row.slug).replace(/-sku-[a-z0-9-]+$/i, '');
        const candidates = [
            slugBase,
            slugBase.replace(/-10-000-/g, '-10000-').replace(/10-000/g, '10000'),
            slugBase.replace(/-(\d)-(\d{3})-/g, '-$1$2-')
        ].filter((v, i, a) => v && a.indexOf(v) === i);
        let updated = false;
        for (const slug of candidates) {
            const url = `https://hmherbs.com/index.php/products/${slug}`;
            try {
                const res = await axios.get(url, { headers: HEADERS, timeout: 15000, validateStatus: (s) => s < 500 });
                if (res.status === 404) continue;
                const $ = cheerio.load(res.data);
                const price = extractPrice($);
                if (price != null) {
                    await pool.execute('UPDATE products SET price = ?, updated_at = NOW() WHERE id = ?', [price, row.id]);
                    console.log(`Updated #${row.id} ${row.name}: $${price.toFixed(2)} (${url})`);
                    updated = true;
                    break;
                }
            } catch (e) {
                console.log(`Error #${row.id} ${slug}: ${e.message}`);
            }
            await new Promise((r) => setTimeout(r, 800));
        }
        if (!updated) console.log(`No price found #${row.id} ${row.name}`);
        await new Promise((r) => setTimeout(r, 1200));
    }
    await pool.end();
})();
