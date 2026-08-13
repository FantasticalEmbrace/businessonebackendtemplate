// Working Image Downloader - Based on proven Node.js patterns
const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { URL } = require('url');

async function downloadImage(url, dest) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        const file = fs.createWriteStream(dest);
        
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/*',
                'Referer': 'https://hmherbs.com/'
            },
            timeout: 15000
        };
        
        const req = protocol.request(options, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                file.close();
                fs.unlink(dest, () => {});
                return downloadImage(response.headers.location, dest).then(resolve).catch(reject);
            }
            
            if (response.statusCode !== 200) {
                file.close();
                fs.unlink(dest, () => {});
                return reject(new Error(`Failed with status ${response.statusCode}`));
            }
            
            response.pipe(file);
            
            file.on('finish', () => {
                file.close();
                resolve();
            });
        });
        
        req.on('error', (err) => {
            file.close();
            fs.unlink(dest, () => {});
            reject(err);
        });
        
        req.on('timeout', () => {
            req.destroy();
            file.close();
            fs.unlink(dest, () => {});
            reject(new Error('Request timeout'));
        });
        
        req.setTimeout(15000);
        req.end();
    });
}

async function downloadFirst10Products() {
    console.log('🖼️  Working Image Downloader - Downloading first 10 products\n');
    
    // Load products
    const dataPath = path.join(__dirname, '../data/complete-scraped-products.json');
    const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
    const products = data.products.slice(0, 10);
    
    console.log(`📦 Processing ${products.length} products\n`);
    
    // Create directory
    const imagesDir = path.join(__dirname, '../../images/products');
    await fs.mkdir(imagesDir, { recursive: true });
    console.log(`📁 Images directory: ${imagesDir}\n`);
    
    let downloaded = 0;
    let failed = 0;
    let skipped = 0;
    
    for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const productName = product.name.substring(0, 40);
        console.log(`[${i + 1}/${products.length}] ${productName}...`);
        
        if (!product.images || product.images.length === 0) {
            console.log('  ⚠️  No images\n');
            skipped++;
            continue;
        }
        
        for (let j = 0; j < product.images.length; j++) {
            const image = product.images[j];
            const imageUrl = image.url;
            
            try {
                // Create safe filename
                const safeName = product.name.replace(/[^a-z0-9]/gi, '-').toLowerCase().substring(0, 30);
                const sku = product.sku || 'unknown';
                const ext = imageUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? imageUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)[0] : '.jpg';
                const filename = `${safeName}-${sku}-${j}${ext}`;
                const filePath = path.join(imagesDir, filename);
                
                // Check if exists
                try {
                    await fs.access(filePath);
                    console.log(`  ✓ ${filename} (exists)`);
                    downloaded++;
                    continue;
                } catch {
                    // File doesn't exist, proceed
                }
                
                process.stdout.write(`  📥 Downloading ${filename}... `);
                const startTime = Date.now();
                
                await downloadImage(imageUrl, filePath);
                
                const elapsed = Date.now() - startTime;
                const stats = await fs.stat(filePath);
                console.log(`✅ (${(stats.size / 1024).toFixed(1)}KB, ${elapsed}ms)`);
                downloaded++;
                
                // Small delay
                await new Promise(r => setTimeout(r, 200));
                
            } catch (error) {
                console.log(`❌ Failed: ${error.message}`);
                failed++;
            }
        }
        console.log('');
    }
    
    console.log('='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Downloaded: ${downloaded}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📁 Directory: ${imagesDir}`);
    console.log('\n✅ Complete!');
}

// Test with single image first
async function testSingleImage() {
    console.log('🧪 Testing single image download...\n');
    
    const dataPath = path.join(__dirname, '../data/complete-scraped-products.json');
    const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
    const product = data.products[0];
    const imageUrl = product.images[0].url;
    
    console.log('Product:', product.name);
    console.log('Image URL:', imageUrl);
    console.log('');
    
    const imagesDir = path.join(__dirname, '../../images/products');
    await fs.mkdir(imagesDir, { recursive: true });
    const filePath = path.join(imagesDir, 'test-single.jpg');
    
    try {
        console.log('Downloading...');
        const startTime = Date.now();
        await downloadImage(imageUrl, filePath);
        const elapsed = Date.now() - startTime;
        const stats = await fs.stat(filePath);
        console.log(`✅ Success! (${(stats.size / 1024).toFixed(1)}KB, ${elapsed}ms)`);
        console.log('File:', filePath);
        return true;
    } catch (error) {
        console.error('❌ Failed:', error.message);
        return false;
    }
}

// Run test first, then download all if test succeeds
if (require.main === module) {
    testSingleImage()
        .then((success) => {
            if (success) {
                console.log('\n' + '='.repeat(60));
                console.log('Test successful! Proceeding with first 10 products...\n');
                return downloadFirst10Products();
            } else {
                console.log('\nTest failed. Please check the error above.');
                process.exit(1);
            }
        })
        .catch((error) => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
}

module.exports = { downloadImage, downloadFirst10Products };

