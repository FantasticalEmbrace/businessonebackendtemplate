const { loadBackendEnv, createPool, createConnection } = require('../utils/dbConfig');
loadBackendEnv();

/**
 * Simple script to fetch product images using DuckDuckGo only
 */

const mysql = require('mysql2/promise');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// Brand website mappings
const BRAND_WEBSITES = {
    'Life Extension': 'https://www.lifeextension.com',
    'Now Foods': 'https://www.nowfoods.com',
    "Nature's Plus": 'https://www.naturesplus.com',
    "Terry Naturally": 'https://www.terrynaturally.com',
    "Life-Flo": 'https://www.lifeflo.com',
    "Irwin Naturals": 'https://www.irwinnaturals.com',
    "Buried Treasure": 'https://www.buriedtreasure.com',
    "North American Herb & Spice": 'https://www.northamericanherbandspice.com'
};

function isValidImageUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return false;
    const lowerUrl = imageUrl.toLowerCase();
    const invalidPatterns = ['bat.bing.com', 'pixel.gif', 'tracking', 'analytics', 'placeholder', 'data:image', 'logo', 'icon', 'spinner', 'loading', '1x1', 'banner', 'searchbann'];
    for (const pattern of invalidPatterns) {
        if (lowerUrl.includes(pattern)) return false;
    }
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) return false;
    return true;
}

async function searchDuckDuckGoImages(brandName, productName) {
    try {
        const searchQuery = `${brandName} ${productName}`;
        const ddgUrl = `https://duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&iax=images&ia=images`;
        const response = await axios.get(ddgUrl, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        
        // DuckDuckGo embeds image data in JSON-LD or in the HTML
        const html = response.data;
        const $ = cheerio.load(html);
        
        // Try to find images in various ways
        const images = $('img');
        for (let i = 0; i < Math.min(images.length, 20); i++) {
            const img = $(images[i]);
            let imgUrl = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src');
            if (imgUrl && imgUrl.startsWith('http') && isValidImageUrl(imgUrl)) {
                return imgUrl;
            }
        }
        
        // Also try to extract from JavaScript data in the page
        const jsMatches = html.match(/https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|webp)/gi);
        if (jsMatches) {
            for (const url of jsMatches.slice(0, 10)) {
                if (isValidImageUrl(url)) {
                    return url;
                }
            }
        }
        
        return null;
    } catch (error) {
        return null;
    }
}

async function updateProductImage(pool, productId, imageUrl) {
    try {
        if (!isValidImageUrl(imageUrl)) {
            console.log(`   ⚠️  Invalid image URL filtered out`);
            return false;
        }
        const [existing] = await pool.execute(
            'SELECT id FROM product_images WHERE product_id = ? AND is_primary = 1',
            [productId]
        );
        if (existing.length > 0) {
            await pool.execute('UPDATE product_images SET image_url = ? WHERE id = ?', [imageUrl, existing[0].id]);
        } else {
            await pool.execute(
                'INSERT INTO product_images (product_id, image_url, is_primary, sort_order) VALUES (?, ?, 1, 0)',
                [productId, imageUrl]
            );
        }
        return true;
    } catch (error) {
        console.error(`   ❌ Error updating database:`, error.message);
        return false;
    }
}

async function fetchProductImages() {
    const pool = createPool({ connectionLimit: 5 });

    try {
        console.log('🚀 Finding products without images...\n');
        const query = `
            SELECT p.id, p.sku, p.name, p.slug, b.name as brand_name, b.website_url as brand_website_url
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1
            WHERE p.is_active = 1 AND pi.id IS NULL
            ORDER BY b.name, p.name
        `;
        const [products] = await pool.execute(query);
        console.log(`📊 Found ${products.length} products without images\n`);

        let totalSuccess = 0;
        let totalFailed = 0;

        for (const product of products) {
            const brandName = product.brand_name || 'Unknown';
            console.log(`\n[${totalSuccess + totalFailed + 1}/${products.length}] ${product.name}`);
            console.log(`   Brand: ${brandName}`);

            try {
                const imageUrl = await searchDuckDuckGoImages(brandName, product.name);
                if (imageUrl) {
                    const updated = await updateProductImage(pool, product.id, imageUrl);
                    if (updated) {
                        console.log(`   ✅ Added: ${imageUrl}`);
                        totalSuccess++;
                    } else {
                        totalFailed++;
                    }
                } else {
                    console.log(`   ⚠️  No image found`);
                    totalFailed++;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error(`   ❌ Error:`, error.message);
                totalFailed++;
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('📊 SUMMARY:');
        console.log(`   Successful: ${totalSuccess}`);
        console.log(`   Failed: ${totalFailed}`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    fetchProductImages().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
}

module.exports = { fetchProductImages };

