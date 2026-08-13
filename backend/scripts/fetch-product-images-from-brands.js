const { loadBackendEnv, createPool, createConnection } = require('../utils/dbConfig');
loadBackendEnv();

/**
 * Script to fetch product images from brand websites
 * For products without images, searches brand websites and downloads product images
 */

const mysql = require('mysql2/promise');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
let puppeteer = null;
try {
    puppeteer = require('puppeteer');
} catch (e) {
    console.warn('Puppeteer not available, JavaScript-rendered sites may not work');
}
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

/**
 * Search Google Images for product image directly
 */
async function searchGoogleImages(brandName, productName) {
    try {
        // Build search query with brand and product name
        const searchQuery = `${brandName} ${productName} product`;
        const googleImageSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&tbm=isch&safe=active`;
        
        if (puppeteer) {
            // Use Puppeteer for better results
            let browser = null;
            try {
                browser = await puppeteer.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
                const page = await browser.newPage();
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                
                await page.goto(googleImageSearchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                await new Promise(resolve => setTimeout(resolve, 2000));

                const imageUrl = await page.evaluate(() => {
                    // Find the first image result
                    const images = document.querySelectorAll('img[data-src], img[src*="https"]');
                    for (const img of images) {
                        let src = img.src || img.getAttribute('data-src');
                        if (src && src.startsWith('http') && !src.includes('google') && !src.includes('gstatic')) {
                            // Filter out Google's own images
                            const lower = src.toLowerCase();
                            if (!lower.includes('logo') && !lower.includes('icon') && 
                                !lower.includes('avatar') && !lower.includes('placeholder') &&
                                (lower.includes('.jpg') || lower.includes('.png') || lower.includes('.webp') || lower.includes('image'))) {
                                return src;
                            }
                        }
                    }
                    return null;
                });

                await browser.close();
                return imageUrl;
            } catch (error) {
                if (browser) await browser.close();
                return null;
            }
        } else {
            // Fallback to axios (less reliable but works)
            const response = await axios.get(googleImageSearchUrl, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const $ = cheerio.load(response.data);
            
            // Try to extract image URLs from the page
            const images = $('img');
            for (let i = 0; i < Math.min(images.length, 20); i++) {
                const img = $(images[i]);
                let src = img.attr('src') || img.attr('data-src');
                if (src && src.startsWith('http') && !src.includes('google') && !src.includes('gstatic')) {
                    const lower = src.toLowerCase();
                    if (!lower.includes('logo') && !lower.includes('icon') && 
                        (lower.includes('.jpg') || lower.includes('.png') || lower.includes('.webp'))) {
                        return src;
                    }
                }
            }
        }
        
        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Search Google for product page on brand website
 */
async function searchGoogleForProduct(brandName, productName, brandWebsite) {
    try {
        const searchQuery = `"${productName}" site:${new URL(brandWebsite).hostname}`;
        const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
        
        if (puppeteer) {
            let browser = null;
            try {
                browser = await puppeteer.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
                const page = await browser.newPage();
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
                
                await page.goto(googleSearchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                await new Promise(resolve => setTimeout(resolve, 2000));

                const productUrl = await page.evaluate((site) => {
                    const links = document.querySelectorAll('a[href*="/url?q="]');
                    for (let i = 0; i < Math.min(links.length, 10); i++) {
                        const href = links[i].href;
                        if (href) {
                            const match = href.match(/\/url\?q=([^&]+)/);
                            if (match) {
                                const url = decodeURIComponent(match[1]);
                                if (url.includes(site) && (url.includes('/product') || url.includes('/p/') || url.includes('/shop/'))) {
                                    return url;
                                }
                            }
                        }
                    }
                    return null;
                }, brandWebsite);

                await browser.close();
                return productUrl;
            } catch (error) {
                if (browser) await browser.close();
                return null;
            }
        } else {
            const response = await axios.get(googleSearchUrl, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const $ = cheerio.load(response.data);
            
            // Try to extract product page URL from search results
            const links = $('a[href*="/url?q="]');
            for (let i = 0; i < Math.min(links.length, 5); i++) {
                const href = $(links[i]).attr('href');
                if (href) {
                    const match = href.match(/\/url\?q=([^&]+)/);
                    if (match) {
                        const url = decodeURIComponent(match[1]);
                        if (url.includes(brandWebsite) && url.includes('/product')) {
                            return url;
                        }
                    }
                }
            }
        }
        
        return null;
    } catch (error) {
        return null;
    }
}

async function searchDuckDuckGoImages(brandName, productName) {
    try {
        const searchQuery = `${brandName} ${productName}`;
        const ddgUrl = `https://duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&iax=images&ia=images`;
        const response = await axios.get(ddgUrl, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const html = response.data;
        const $ = cheerio.load(html);
        const images = $('img');
        for (let i = 0; i < Math.min(images.length, 20); i++) {
            const img = $(images[i]);
            let imgUrl = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src');
            if (imgUrl && imgUrl.startsWith('http') && isValidImageUrl(imgUrl)) {
                return imgUrl;
            }
        }
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

/**
 * Search for product on brand website and extract image URL
 * This function uses multiple strategies to find product images
 */
async function searchProductOnBrandWebsite(brandName, productName, brandWebsite) {
    try {
        console.log(`\n🔍 Searching for "${productName}"...`);
        
        // Use DuckDuckGo Image Search directly (simple and efficient)
        console.log(`   🔍 Searching DuckDuckGo Images...`);
        const ddgImageUrl = await searchDuckDuckGoImages(brandName, productName);
        if (ddgImageUrl && isValidImageUrl(ddgImageUrl)) {
            console.log(`   ✅ Found image via DuckDuckGo: ${ddgImageUrl}`);
            return ddgImageUrl;
        }
        
        return null;

    } catch (error) {
        console.error(`   ❌ Error:`, error.message);
        return null;
    }
}

/**
 * Get image from a specific product page using Puppeteer (for JavaScript sites)
 */
async function getImageFromProductPageWithPuppeteer(productPageUrl, brandWebsite) {
    if (!puppeteer) return null;

    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await page.goto(productPageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Wait a bit for images to load
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Try to get image using various selectors
        const imageUrl = await page.evaluate((brandSite) => {
            // Try Open Graph image
            const ogImage = document.querySelector('meta[property="og:image"]');
            if (ogImage && ogImage.content) {
                let url = ogImage.content;
                if (!url.startsWith('http')) {
                    url = new URL(url, brandSite).href;
                }
                if (!url.toLowerCase().includes('placeholder') && !url.toLowerCase().includes('logo')) {
                    return url;
                }
            }

            // Try common product image selectors
            const selectors = [
                'img.product-image',
                'img[src*="product"]',
                '.product-image img',
                '.product-photo img',
                '.product-main-image img',
                'img.main-product-image',
                '.gallery img:first-of-type',
                '.product-gallery img:first-of-type'
            ];

            for (const selector of selectors) {
                const img = document.querySelector(selector);
                if (img) {
                    let src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
                    if (src) {
                        if (!src.startsWith('http')) {
                            src = new URL(src, brandSite).href;
                        }
                        const lower = src.toLowerCase();
                        if (!lower.includes('placeholder') && !lower.includes('logo') && 
                            !lower.includes('icon') && !lower.includes('tracking') &&
                            !lower.includes('pixel') && !lower.includes('bat.bing')) {
                            return src;
                        }
                    }
                }
            }

            // Find largest image that might be product
            const images = Array.from(document.querySelectorAll('img'));
            let largest = null;
            let largestSize = 0;

            for (const img of images) {
                const width = img.naturalWidth || img.width || 0;
                const height = img.naturalHeight || img.height || 0;
                const size = width * height;

                if (size > largestSize && size > 20000) {
                    let src = img.src || img.getAttribute('data-src');
                    if (src) {
                        if (!src.startsWith('http')) {
                            src = new URL(src, brandSite).href;
                        }
                        const lower = src.toLowerCase();
                        if (!lower.includes('logo') && !lower.includes('icon') && 
                            !lower.includes('banner') && !lower.includes('tracking') &&
                            !lower.includes('pixel') && !lower.includes('bat.bing')) {
                            largest = src;
                            largestSize = size;
                        }
                    }
                }
            }

            return largest;
        }, brandWebsite);

        await browser.close();
        return imageUrl;

    } catch (error) {
        if (browser) await browser.close();
        console.error(`   ❌ Error with Puppeteer:`, error.message);
        return null;
    }
}

/**
 * Get image from a specific product page
 */
async function getImageFromProductPage(productPageUrl, brandWebsite, usePuppeteer = false) {
    // Try Puppeteer first for JavaScript sites
    if (usePuppeteer && puppeteer) {
        const puppeteerResult = await getImageFromProductPageWithPuppeteer(productPageUrl, brandWebsite);
        if (puppeteerResult) return puppeteerResult;
    }

    try {
        const response = await axios.get(productPageUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });

        const $ = cheerio.load(response.data);

        // Try Open Graph image first (most reliable)
        const ogImage = $('meta[property="og:image"]').attr('content');
        if (ogImage) {
            const imgUrl = ogImage.startsWith('http') ? ogImage : new URL(ogImage, brandWebsite).href;
            if (isValidImageUrl(imgUrl)) {
                return imgUrl;
            }
        }

        // Try Twitter Card image
        const twitterImage = $('meta[name="twitter:image"]').attr('content');
        if (twitterImage) {
            const imgUrl = twitterImage.startsWith('http') ? twitterImage : new URL(twitterImage, brandWebsite).href;
            if (isValidImageUrl(imgUrl)) {
                return imgUrl;
            }
        }

        // Common product image selectors
        const imageSelectors = [
            'img.product-image',
            'img[src*="product"]',
            '.product-image img',
            '.product-photo img',
            '.product-main-image img',
            'img.main-product-image',
            '.gallery img:first',
            '.product-gallery img:first',
            '.product-media img:first',
            'figure.product-image img',
            '.product-single__photo img'
        ];

        for (const selector of imageSelectors) {
            const img = $(selector).first();
            let imgUrl = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || img.attr('data-zoom-src');

                        if (imgUrl) {
                            if (!imgUrl.startsWith('http')) {
                                imgUrl = new URL(imgUrl, brandWebsite).href;
                            }
                            // Validate the image URL
                            if (isValidImageUrl(imgUrl)) {
                                return imgUrl;
                            }
                        }
        }

        // Last resort: find largest image that might be product image
        const allImages = $('img').toArray();
        let largestImage = null;
        let largestSize = 0;

        for (const img of allImages) {
            const $img = $(img);
            const src = $img.attr('src') || $img.attr('data-src');
            if (src) {
                const width = parseInt($img.attr('width') || $img.attr('data-width') || '0');
                const height = parseInt($img.attr('height') || $img.attr('data-height') || '0');
                const size = width * height;

                if (size > largestSize && size > 20000) { // At least 200x100 pixels
                    const imgUrl = src.startsWith('http') ? src : new URL(src, brandWebsite).href;
                    const lowerUrl = imgUrl.toLowerCase();
                    if (!lowerUrl.includes('logo') && !lowerUrl.includes('icon') && !lowerUrl.includes('banner')) {
                        largestImage = imgUrl;
                        largestSize = size;
                    }
                }
            }
        }

        return largestImage;

    } catch (error) {
        // If it's a 404 or similar, that's ok - product doesn't exist
        if (error.response && error.response.status === 404) {
            return null;
        }
        console.error(`   ❌ Error fetching product page:`, error.message);
        return null;
    }
}

/**
 * Validate image URL - filter out tracking pixels, placeholders, and invalid images
 */
function isValidImageUrl(imageUrl, allowBanners = false) {
    if (!imageUrl || typeof imageUrl !== 'string') return false;
    
    const lowerUrl = imageUrl.toLowerCase();
    
    // Filter out tracking pixels and analytics
    const invalidPatterns = [
        'bat.bing.com',
        'pixel.gif',
        'tracking',
        'analytics',
        'placeholder',
        'data:image/svg+xml', // SVG placeholders
        'logo',
        'icon',
        'spinner',
        'loading',
        '1x1',
        'transparent'
    ];
    
    // Filter out banners unless explicitly allowed
    if (!allowBanners) {
        invalidPatterns.push('banner', 'searchbann', 'promo', 'advertisement');
    }
    
    for (const pattern of invalidPatterns) {
        if (lowerUrl.includes(pattern)) {
            return false;
        }
    }
    
    // Must be a valid image URL (http/https)
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
        return false;
    }
    
    // Should have an image extension (optional but preferred)
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const hasExtension = imageExtensions.some(ext => lowerUrl.includes(ext));
    
    // If it doesn't have an extension, check if it looks like an image endpoint
    if (!hasExtension && !lowerUrl.includes('/image') && !lowerUrl.includes('/img') && !lowerUrl.includes('/product') && !lowerUrl.includes('/media')) {
        return false;
    }
    
    return true;
}

/**
 * Update database with product image URL
 */
async function updateProductImage(pool, productId, imageUrl, allowBanners = false) {
    try {
        // Validate the image URL first
        if (!isValidImageUrl(imageUrl, allowBanners)) {
            console.log(`   ⚠️  Invalid image URL (filtered out): ${imageUrl.substring(0, 100)}...`);
            return false;
        }
        
        // Check if image already exists
        const [existing] = await pool.execute(
            'SELECT id FROM product_images WHERE product_id = ? AND is_primary = 1',
            [productId]
        );

        if (existing.length > 0) {
            // Update existing
            await pool.execute(
                'UPDATE product_images SET image_url = ? WHERE id = ?',
                [imageUrl, existing[0].id]
            );
        } else {
            // Insert new
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

/**
 * Main function to fetch images for products without images
 */
async function fetchProductImages() {
    const pool = createPool({ connectionLimit: 5 });

    try {
        console.log('🚀 Starting product image fetch process...\n');

        // Load products without images
        const { findProductsWithoutImages } = require('./find-products-without-images');
        const productsByBrand = await findProductsWithoutImages();

        if (!productsByBrand || Object.keys(productsByBrand).length === 0) {
            console.log('✅ No products without images found!');
            return;
        }

        let totalProcessed = 0;
        let totalSuccess = 0;
        let totalFailed = 0;

        // Process each brand
        for (const brandName of Object.keys(productsByBrand).sort()) {
            const brandInfo = productsByBrand[brandName];
            const brandWebsite = BRAND_WEBSITES[brandName] || brandInfo.website_url;

            if (!brandWebsite) {
                console.log(`\n⚠️  Skipping ${brandName} - no website URL available`);
                continue;
            }

            console.log(`\n📦 Processing ${brandName} (${brandInfo.products.length} products)...`);

            // Process each product
            for (const product of brandInfo.products) {
                totalProcessed++;
                console.log(`\n[${totalProcessed}/${Object.values(productsByBrand).reduce((sum, b) => sum + b.products.length, 0)}] Processing: ${product.name}`);

                try {
                    // Search for product image
                    const imageUrl = await searchProductOnBrandWebsite(brandName, product.name, brandWebsite);

                    if (!imageUrl) {
                        console.log(`   ⚠️  Could not find image for "${product.name}"`);
                        totalFailed++;
                        continue;
                    }

                    // Update database with URL directly (try without banner filter first, then with)
                    let updated = await updateProductImage(pool, product.id, imageUrl, false);
                    if (!updated) {
                        // Try again allowing banners as last resort
                        updated = await updateProductImage(pool, product.id, imageUrl, true);
                    }

                    if (updated) {
                        console.log(`   ✅ Successfully added image URL: ${imageUrl}`);
                        totalSuccess++;
                    } else {
                        console.log(`   ⚠️  Image URL was filtered out or invalid`);
                        totalFailed++;
                    }

                    // Add delay to avoid overwhelming servers
                    await new Promise(resolve => setTimeout(resolve, 2000));

                } catch (error) {
                    console.error(`   ❌ Error processing product:`, error.message);
                    totalFailed++;
                }
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('📊 SUMMARY:');
        console.log(`   Total processed: ${totalProcessed}`);
        console.log(`   Successful: ${totalSuccess}`);
        console.log(`   Failed: ${totalFailed}`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

// Run if called directly
if (require.main === module) {
    fetchProductImages()
        .then(() => {
            console.log('\n✅ Script completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Script failed:', error);
            process.exit(1);
        });
}

module.exports = { fetchProductImages, searchProductOnBrandWebsite, isValidImageUrl };

