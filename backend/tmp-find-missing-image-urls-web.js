const mysql = require('mysql2/promise');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hmherbs',
};

// Helper: run Google Image search (uses scraping fallback)
async function findImageOnWeb(productName, brandName) {
    const q = encodeURIComponent(`${brandName ? brandName + ' ' : ''}${productName} product`);
    // Simple DuckDuckGo Images endpoint, does not require API key
    const url = `https://duckduckgo.com/?q=${q}&iax=images&ia=images`;
    return url; // return the page for manual check (API limitations for scraping)
}

(async () => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        // Find products missing images
        const [products] = await connection.execute(
            `SELECT p.id, p.sku, p.name, b.name AS brand_name
             FROM products p
             LEFT JOIN brands b ON p.brand_id = b.id
             LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1
             WHERE p.is_active = 1 
             AND (pi.image_url IS NULL OR pi.image_url = '' OR pi.image_url = 'null')
             ORDER BY p.name`
        );

        const results = [];
        for (const product of products) {
            const image_url = await findImageOnWeb(product.name, product.brand_name);
            results.push({
                id: product.id,
                sku: product.sku,
                name: product.name,
                brand: product.brand_name,
                duckduckgo_images_url: image_url
            });
        }

        // Output as CSV and JSON for review
        const csvOut = ['sku,name,brand,search_url'];
        results.forEach(row => {
            csvOut.push(`"${row.sku}","${row.name.replace(/"/g,'""')}","${row.brand.replace(/"/g,'""')}","${row.duckduckgo_images_url}"`);
        });
        fs.writeFileSync('products-missing-images-url.csv', csvOut.join('\n'));
        fs.writeFileSync('products-missing-images-url.json', JSON.stringify(results, null, 2));
        console.log('Search URLs for missing product images written to products-missing-images-url.csv');
    } catch (err) {
        console.error(err);
    } finally {
        if (connection) await connection.end();
    }
})();

