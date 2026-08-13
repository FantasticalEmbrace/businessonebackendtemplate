#!/usr/bin/env node
/**
 * Build sitemap.xml + sitemap-products.xml from the live MySQL catalog.
 *
 * Usage (repo root):
 *   node scripts/seo-migration/generate-sitemap.js
 *   node scripts/seo-migration/generate-sitemap.js --base-url https://hmherbs.com
 *
 * Env: backend/.env DB_* ; optional SITE_BASE_URL or STOREFRONT_PUBLIC_URL
 */

const fs = require('fs');
const path = require('path');
const { loadBackendEnv, createPool } = require('../../backend/utils/dbConfig');

const rootDir = path.join(__dirname, '..', '..');

const STATIC_PAGES = [
    { loc: '/', changefreq: 'daily', priority: '1.0' },
    { loc: '/products.html', changefreq: 'daily', priority: '0.9' },
    { loc: '/brands.html', changefreq: 'weekly', priority: '0.8' },
    { loc: '/categories.html', changefreq: 'weekly', priority: '0.8' },
    { loc: '/about.html', changefreq: 'monthly', priority: '0.6' },
    { loc: '/business-one-menu.html', changefreq: 'monthly', priority: '0.5' },
    { loc: '/shipping-returns.html', changefreq: 'monthly', priority: '0.5' },
    { loc: '/privacy-policy.html', changefreq: 'yearly', priority: '0.3' },
    { loc: '/ccpa-privacy-rights.html', changefreq: 'yearly', priority: '0.3' }
];

function resolveBaseUrl() {
    const argIdx = process.argv.indexOf('--base-url');
    if (argIdx >= 0 && process.argv[argIdx + 1]) {
        return String(process.argv[argIdx + 1]).trim().replace(/\/+$/, '');
    }
    let base = String(
        process.env.SITE_BASE_URL ||
            process.env.STOREFRONT_PUBLIC_URL ||
            process.env.FRONTEND_URL ||
            'https://hmherbs.com'
    ).trim();
    base = base.replace(/\/+$/, '');
    return base;
}

function xmlEscapeText(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function buildLoc(base, pathname, query = null) {
    const url = new URL(pathname.startsWith('/') ? pathname : `/${pathname}`, `${base}/`);
    if (query && typeof query === 'object') {
        for (const [key, val] of Object.entries(query)) {
            if (val != null && String(val).trim() !== '') {
                url.searchParams.set(key, String(val).trim());
            }
        }
    }
    return xmlEscapeText(url.href);
}

function formatLastmod(value) {
    if (!value) return new Date().toISOString().slice(0, 10);
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    return d.toISOString().slice(0, 10);
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
    let xml = '  <url>\n';
    xml += `    <loc>${loc}</loc>\n`;
    if (lastmod) xml += `    <lastmod>${xmlEscapeText(lastmod)}</lastmod>\n`;
    if (changefreq) xml += `    <changefreq>${changefreq}</changefreq>\n`;
    if (priority) xml += `    <priority>${priority}</priority>\n`;
    xml += '  </url>\n';
    return xml;
}

function writeUrlset(filePath, entries) {
    const header =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    const footer = '</urlset>\n';
    const body = entries.join('');
    fs.writeFileSync(filePath, header + body + footer, 'utf8');
}

function writeSitemapIndex(filePath, base, childFiles) {
    const today = new Date().toISOString().slice(0, 10);
    let xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (const file of childFiles) {
        const loc = xmlEscapeText(`${base}/${file}`);
        xml += '  <sitemap>\n';
        xml += `    <loc>${loc}</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += '  </sitemap>\n';
    }
    xml += '</sitemapindex>\n';
    fs.writeFileSync(filePath, xml, 'utf8');
}

async function main() {
    loadBackendEnv(path.join(__dirname, '..', '..', 'backend', '.env'));
    const base = resolveBaseUrl();
    const today = formatLastmod(new Date());

    const pool = createPool({ connectionLimit: 5 });

    try {
        const pageEntries = [];

        for (const page of STATIC_PAGES) {
            pageEntries.push(
                urlEntry({
                    loc: buildLoc(base, page.loc),
                    lastmod: today,
                    changefreq: page.changefreq,
                    priority: page.priority
                })
            );
        }

        const [brands] = await pool.query(
            'SELECT slug, created_at FROM brands WHERE is_active = 1 AND TRIM(slug) <> "" ORDER BY slug'
        );
        for (const row of brands) {
            pageEntries.push(
                urlEntry({
                    loc: buildLoc(base, '/products.html', { brand: row.slug }),
                    lastmod: formatLastmod(row.created_at),
                    changefreq: 'weekly',
                    priority: '0.7'
                })
            );
        }

        const [productCategories] = await pool.query(
            `SELECT slug, created_at FROM product_categories
              WHERE is_active = 1 AND TRIM(slug) <> "" ORDER BY slug`
        );
        for (const row of productCategories) {
            pageEntries.push(
                urlEntry({
                    loc: buildLoc(base, '/products.html', { category: row.slug }),
                    lastmod: formatLastmod(row.created_at),
                    changefreq: 'weekly',
                    priority: '0.7'
                })
            );
        }

        const [healthCategories] = await pool.query(
            `SELECT slug, created_at FROM health_categories
              WHERE is_active = 1 AND TRIM(slug) <> "" ORDER BY slug`
        );
        const seenCategoryLocs = new Set(
            productCategories.map((r) => buildLoc(base, '/products.html', { category: r.slug }))
        );
        for (const row of healthCategories) {
            const loc = buildLoc(base, '/products.html', { category: row.slug });
            if (seenCategoryLocs.has(loc)) continue;
            seenCategoryLocs.add(loc);
            pageEntries.push(
                urlEntry({
                    loc,
                    lastmod: formatLastmod(row.created_at),
                    changefreq: 'weekly',
                    priority: '0.7'
                })
            );
        }

        const [products] = await pool.query(
            `SELECT slug, updated_at FROM products
              WHERE is_active = 1 AND COALESCE(show_on_web, 1) = 1 AND TRIM(slug) <> "" ORDER BY slug`
        );

        const productEntries = products.map((row) =>
            urlEntry({
                loc: buildLoc(base, '/product.html', { slug: row.slug }),
                lastmod: formatLastmod(row.updated_at),
                changefreq: 'weekly',
                priority: '0.6'
            })
        );

        const pagesPath = path.join(rootDir, 'sitemap-pages.xml');
        const productsPath = path.join(rootDir, 'sitemap-products.xml');
        const indexPath = path.join(rootDir, 'sitemap.xml');

        writeUrlset(pagesPath, pageEntries);
        writeUrlset(productsPath, productEntries);
        writeSitemapIndex(indexPath, base, ['sitemap-pages.xml', 'sitemap-products.xml']);

        const inventoryPath = path.join(__dirname, 'output', 'sitemap-urls.csv');
        fs.mkdirSync(path.dirname(inventoryPath), { recursive: true });
        const invRows = [['loc', 'type', 'lastmod']];
        const pushInv = (loc, type, lastmod) => invRows.push([loc.replace(/&amp;/g, '&'), type, lastmod]);

        for (const page of STATIC_PAGES) {
            pushInv(buildLoc(base, page.loc).replace(/&amp;/g, '&'), 'static', today);
        }
        for (const row of brands) {
            pushInv(
                buildLoc(base, '/products.html', { brand: row.slug }).replace(/&amp;/g, '&'),
                'brand',
                formatLastmod(row.created_at)
            );
        }
        for (const row of productCategories) {
            pushInv(
                buildLoc(base, '/products.html', { category: row.slug }).replace(/&amp;/g, '&'),
                'product_category',
                formatLastmod(row.created_at)
            );
        }
        for (const row of healthCategories) {
            pushInv(
                buildLoc(base, '/products.html', { category: row.slug }).replace(/&amp;/g, '&'),
                'health_category',
                formatLastmod(row.created_at)
            );
        }
        for (const row of products) {
            pushInv(
                buildLoc(base, '/product.html', { slug: row.slug }).replace(/&amp;/g, '&'),
                'product',
                formatLastmod(row.updated_at)
            );
        }
        const esc = (cell) => {
            const s = String(cell ?? '');
            return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        fs.writeFileSync(
            inventoryPath,
            invRows.map((r) => r.map(esc).join(',')).join('\n'),
            'utf8'
        );

        console.log('Sitemap base URL:', base);
        console.log('Wrote', indexPath, '(sitemap index)');
        console.log('Wrote', pagesPath, `(${pageEntries.length} URLs)`);
        console.log('Wrote', productsPath, `(${productEntries.length} product URLs)`);
        console.log('Wrote', inventoryPath);
        console.log(
            'Total indexable URLs:',
            pageEntries.length + productEntries.length
        );
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
