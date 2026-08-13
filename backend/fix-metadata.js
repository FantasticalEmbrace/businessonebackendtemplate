const mysql = require('mysql2/promise');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

/**
 * Specialized script to scan the website and fix brands/categories
 * for every product in the database.
 */
async function fixMetadata() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hmherbs',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };

    try {
        console.log('🚀 Starting website scan to fix brands and categories...');

        // 1. Get all products from database that have a URL
        // If they don't have a URL, we'll try to find them by name
        const [products] = await pool.execute('SELECT id, name, sku, slug FROM products');
        console.log(`📦 Found ${products.length} products in database to verify.`);

        // 2. Map of context (category/brand) from scanning list pages
        const productMetadata = new Map(); // url -> { category, brand }

        // 3. Scan category pages to get "ground truth" for categories
        const baseUrl = 'https://hmherbs.com';
        console.log('🔍 Scanning home page for category/brand links...');
        try {
            const homeRes = await axios.get(baseUrl, { headers });
            const $home = cheerio.load(homeRes.data);
            
            const categoryPages = [];
            $home('a[href*="/category/"]').each((i, el) => {
                categoryPages.push({
                    url: $home(el).attr('href').startsWith('http') ? $home(el).attr('href') : baseUrl + $home(el).attr('href'),
                    name: $home(el).text().trim()
                });
            });

            const brandPages = [];
            $home('a[href*="/brand/"]').each((i, el) => {
                brandPages.push({
                    url: $home(el).attr('href').startsWith('http') ? $home(el).attr('href') : baseUrl + $home(el).attr('href'),
                    name: $home(el).text().trim()
                });
            });

            console.log(`📊 Found ${categoryPages.length} categories and ${brandPages.length} brands to scan.`);

            // Process categories
            for (const cat of categoryPages) {
                console.log(`📁 Scanning category: ${cat.name}...`);
                try {
                    const res = await axios.get(cat.url, { headers, timeout: 10000 });
                    const $ = cheerio.load(res.data);
                    $('a[href*="/products/"]').each((i, el) => {
                        const href = $(el).attr('href');
                        const fullUrl = href.startsWith('http') ? href : baseUrl + href;
                        if (!productMetadata.has(fullUrl)) productMetadata.set(fullUrl, {});
                        productMetadata.get(fullUrl).category = cat.name;
                    });
                } catch (e) { console.warn(`Failed to scan ${cat.url}`); }
            }

            // Process brands
            for (const brand of brandPages) {
                console.log(`🏷️  Scanning brand: ${brand.name}...`);
                try {
                    const res = await axios.get(brand.url, { headers, timeout: 10000 });
                    const $ = cheerio.load(res.data);
                    $('a[href*="/products/"]').each((i, el) => {
                        const href = $(el).attr('href');
                        const fullUrl = href.startsWith('http') ? href : baseUrl + href;
                        if (!productMetadata.has(fullUrl)) productMetadata.set(fullUrl, {});
                        productMetadata.get(fullUrl).brand = brand.name;
                    });
                } catch (e) { console.warn(`Failed to scan ${brand.url}`); }
            }
        } catch (e) { console.error('Failed to scan home page'); }

        // 4. Update Database
        console.log('\n📝 Updating database records...');
        let updatedCount = 0;

        for (const product of products) {
            // Try to construct URL from slug if missing
            const url = `${baseUrl}/index.php/products/${product.slug}`;
            const meta = productMetadata.get(url) || {};

            let finalCategory = meta.category;
            let finalBrand = meta.brand;

            // If not found in metadata scan, we'd need to visit the page
            // But for now, let's apply what we found from category/brand pages
            if (finalCategory || finalBrand) {
                const connection = await pool.getConnection();
                try {
                    await connection.beginTransaction();

                    if (finalBrand) {
                        const brandSlug = finalBrand.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                        await connection.execute('INSERT IGNORE INTO brands (name, slug) VALUES (?, ?)', [finalBrand, brandSlug]);
                        const [[brandRow]] = await connection.execute('SELECT id FROM brands WHERE name = ?', [finalBrand]);
                        await connection.execute('UPDATE products SET brand_id = ? WHERE id = ?', [brandRow.id, product.id]);
                    }

                    if (finalCategory) {
                        const catSlug = finalCategory.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                        await connection.execute('INSERT IGNORE INTO product_categories (name, slug) VALUES (?, ?)', [finalCategory, catSlug]);
                        const [[catRow]] = await connection.execute('SELECT id FROM product_categories WHERE name = ?', [finalCategory]);
                        await connection.execute('UPDATE products SET category_id = ? WHERE id = ?', [catRow.id, product.id]);
                    }

                    await connection.commit();
                    updatedCount++;
                    if (updatedCount % 50 === 0) console.log(`Updated ${updatedCount} products...`);
                } catch (err) {
                    await connection.rollback();
                } finally {
                    connection.release();
                }
            }
        }

        console.log(`\n✅ Finished! Updated ${updatedCount} products with exact website metadata.`);

    } catch (error) {
        console.error('Master script failed:', error.message);
    } finally {
        await pool.end();
    }
}

fixMetadata();

