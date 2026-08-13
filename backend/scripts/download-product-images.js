// Download Product Images from HM Herbs Website
// Downloads all product images and saves them locally

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');

class ProductImageDownloader {
    constructor() {
        this.baseUrl = 'https://hmherbs.com';
        this.imagesDir = path.join(__dirname, '../../images/products');
        this.downloadedImages = new Map(); // Track downloaded images to avoid duplicates
        this.failedDownloads = [];
        this.stats = {
            total: 0,
            downloaded: 0,
            skipped: 0,
            failed: 0
        };
    }

    async initialize() {
        // Create products directory if it doesn't exist
        try {
            await fs.mkdir(this.imagesDir, { recursive: true });
            console.log(`📁 Created images directory: ${this.imagesDir}`);
        } catch (error) {
            console.error(`❌ Error creating directory: ${error.message}`);
        }
    }

    async downloadAllImages() {
        console.log('🖼️  Starting product image download process...\n');
        
        await this.initialize();

        // Try to load existing scraped products
        const scrapedDataPath = path.join(__dirname, '../data/complete-scraped-products.json');
        let products = [];

        try {
            const data = await fs.readFile(scrapedDataPath, 'utf8');
            const jsonData = JSON.parse(data);
            products = jsonData.products || [];
            console.log(`📦 Loaded ${products.length} products from scraped data\n`);
        } catch (error) {
            console.log(`⚠️  Could not load scraped products. Starting fresh scrape...\n`);
            // If no scraped data, we'll need to scrape first
            const { loadScraper } = require('../utils/businessone-scraper');
            const CatalogScraper = loadScraper();
            const scraper = new CatalogScraper({
                domain: process.env.CATALOG_SCRAPE_DOMAIN || 'https://hmherbs.com'
            });
            await scraper.scrapeAllProducts();
            
            // Try loading again
            try {
                const data = await fs.readFile(scrapedDataPath, 'utf8');
                const jsonData = JSON.parse(data);
                products = jsonData.products || [];
                console.log(`📦 Loaded ${products.length} products after scraping\n`);
            } catch (err) {
                console.error(`❌ Still could not load products: ${err.message}`);
                return;
            }
        }

        if (products.length === 0) {
            console.log('⚠️  No products found. Please run the scraper first.');
            return;
        }

        this.stats.total = products.length;

        // Download images for each product
        for (let i = 0; i < products.length; i++) {
            const product = products[i];
            console.log(`\n[${i + 1}/${products.length}] Processing: ${product.name || 'Unknown Product'}`);
            
            if (!product.images || product.images.length === 0) {
                console.log(`   ⚠️  No images found for this product`);
                this.stats.skipped++;
                continue;
            }

            // Download all images for this product
            const downloadedPaths = [];
            for (let j = 0; j < product.images.length; j++) {
                const image = product.images[j];
                const imageUrl = image.url || image;
                
                if (!imageUrl) {
                    console.log(`   ⚠️  Invalid image URL`);
                    continue;
                }

                try {
                    const localPath = await this.downloadImage(imageUrl, product, j);
                    if (localPath) {
                        downloadedPaths.push(localPath);
                        this.stats.downloaded++;
                    } else {
                        this.stats.skipped++;
                    }
                } catch (error) {
                    console.log(`   ❌ Failed to download image ${j + 1}: ${error.message}`);
                    this.failedDownloads.push({
                        product: product.name,
                        url: imageUrl,
                        error: error.message
                    });
                    this.stats.failed++;
                }

                // Small delay between downloads
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            // Update product with local image paths
            if (downloadedPaths.length > 0) {
                product.localImages = downloadedPaths;
                product.primaryImage = downloadedPaths[0]; // First image is primary
            }

            // Progress update every 10 products
            if ((i + 1) % 10 === 0) {
                console.log(`\n📊 Progress: ${i + 1}/${products.length} products processed`);
                console.log(`   ✅ Downloaded: ${this.stats.downloaded}`);
                console.log(`   ⏭️  Skipped: ${this.stats.skipped}`);
                console.log(`   ❌ Failed: ${this.stats.failed}`);
            }
        }

        // Save updated product data with local image paths
        await this.saveUpdatedProducts(products);

        // Print final summary
        this.printSummary();
    }

    async downloadImage(imageUrl, product, index) {
        try {
            // Generate filename from product name and index
            const productName = this.sanitizeFilename(product.name || 'product');
            const sku = product.sku || 'unknown';
            const extension = this.getImageExtension(imageUrl);
            const filename = `${productName}-${sku}-${index}${extension}`;
            const filePath = path.join(this.imagesDir, filename);

            // Check if already downloaded
            if (this.downloadedImages.has(imageUrl)) {
                console.log(`   ⏭️  Image already downloaded: ${filename}`);
                return this.downloadedImages.get(imageUrl);
            }

            // Check if file already exists locally
            try {
                await fs.access(filePath);
                console.log(`   ✓ Image already exists: ${filename}`);
                this.downloadedImages.set(imageUrl, `/images/products/${filename}`);
                return `/images/products/${filename}`;
            } catch {
                // File doesn't exist, proceed with download
            }

            console.log(`   📥 Downloading: ${imageUrl.substring(0, 60)}...`);

            // Download the image
            const response = await axios({
                method: 'GET',
                url: imageUrl,
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            // Save to file
            await fs.writeFile(filePath, response.data);
            
            const relativePath = `/images/products/${filename}`;
            this.downloadedImages.set(imageUrl, relativePath);
            console.log(`   ✅ Saved: ${filename}`);

            return relativePath;

        } catch (error) {
            if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                throw new Error(`Network error: ${error.message}`);
            } else if (error.response && error.response.status === 404) {
                throw new Error('Image not found (404)');
            } else {
                throw new Error(`Download failed: ${error.message}`);
            }
        }
    }

    sanitizeFilename(name) {
        return name
            .replace(/[^a-z0-9]/gi, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase()
            .substring(0, 50); // Limit length
    }

    getImageExtension(url) {
        const urlPath = url.split('?')[0]; // Remove query params
        const match = urlPath.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i);
        return match ? match[0].toLowerCase() : '.jpg'; // Default to .jpg
    }

    async saveUpdatedProducts(products) {
        console.log('\n💾 Saving updated product data with local image paths...');
        
        const updatedData = {
            products: products,
            imagesDownloaded: this.stats.downloaded,
            imagesFailed: this.stats.failed,
            downloadedAt: new Date().toISOString()
        };

        const outputPath = path.join(__dirname, '../data/products-with-images.json');
        await fs.writeFile(
            outputPath,
            JSON.stringify(updatedData, null, 2)
        );

        console.log(`✅ Saved updated product data to: ${outputPath}`);

        // Also save a mapping file for easy reference
        const imageMapping = products
            .filter(p => p.localImages && p.localImages.length > 0)
            .map(p => ({
                sku: p.sku,
                name: p.name,
                images: p.localImages,
                primaryImage: p.primaryImage
            }));

        const mappingPath = path.join(__dirname, '../data/image-mapping.json');
        await fs.writeFile(
            mappingPath,
            JSON.stringify(imageMapping, null, 2)
        );

        console.log(`✅ Saved image mapping to: ${mappingPath}`);
    }

    printSummary() {
        console.log('\n' + '='.repeat(60));
        console.log('📊 DOWNLOAD SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total Products: ${this.stats.total}`);
        console.log(`✅ Images Downloaded: ${this.stats.downloaded}`);
        console.log(`⏭️  Images Skipped: ${this.stats.skipped}`);
        console.log(`❌ Images Failed: ${this.stats.failed}`);
        console.log(`📁 Images Directory: ${this.imagesDir}`);
        
        if (this.failedDownloads.length > 0) {
            console.log('\n⚠️  Failed Downloads:');
            this.failedDownloads.slice(0, 10).forEach((fail, i) => {
                console.log(`   ${i + 1}. ${fail.product}: ${fail.error}`);
            });
            if (this.failedDownloads.length > 10) {
                console.log(`   ... and ${this.failedDownloads.length - 10} more`);
            }
        }
        
        console.log('\n✅ Image download process complete!');
        console.log('💡 Next step: Update product database with local image paths');
    }
}

// CLI usage
if (require.main === module) {
    const downloader = new ProductImageDownloader();
    downloader.downloadAllImages()
        .then(() => {
            console.log('\n🎉 Image download completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Image download failed:', error);
            process.exit(1);
        });
}

module.exports = ProductImageDownloader;

