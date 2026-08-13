// Final Working Image Downloader - Based on proven Node.js stream pattern
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

function downloadImage(url, dest) {
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
            }
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
        
        req.setTimeout(30000, () => {
            req.destroy();
            file.close();
            fs.unlink(dest, () => {});
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

async function main() {
    console.log('🖼️  Working Image Downloader\n');
    console.log('Starting at:', new Date().toLocaleString());
    console.log('');
    
    // Load products
    const dataPath = path.join(__dirname, '../data/complete-scraped-products.json');
    console.log('Loading data from:', dataPath);
    
    if (!fs.existsSync(dataPath)) {
        console.error('ERROR: Data file not found!');
        process.exit(1);
    }
    
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const products = data.products.slice(0, 10);
    
    console.log('Loaded', products.length, 'products');
    console.log('');
    
    console.log(`📦 Processing first ${products.length} products\n`);
    
    // Create directory
    const imagesDir = path.join(__dirname, '../../images/products');
    if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
    }
    console.log(`📁 Images directory: ${imagesDir}\n`);
    
    let downloaded = 0;
    let failed = 0;
    let skipped = 0;
    
    for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const productName = product.name.substring(0, 50);
        console.log(`[${i + 1}/${products.length}] ${productName}`);
        
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
                const urlPath = imageUrl.split('?')[0];
                const extMatch = urlPath.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                const ext = extMatch ? extMatch[0] : '.jpg';
                const filename = `${safeName}-${sku}-${j}${ext}`;
                const filePath = path.join(imagesDir, filename);
                
                // Check if exists
                if (fs.existsSync(filePath)) {
                    console.log(`  ✓ ${filename} (exists)`);
                    downloaded++;
                    continue;
                }
                
                console.log(`  📥 Downloading ${filename}...`);
                console.log(`     URL: ${imageUrl.substring(0, 80)}...`);
                const startTime = Date.now();
                
                try {
                    await downloadImage(imageUrl, filePath);
                } catch (downloadError) {
                    throw downloadError;
                }
                
                const elapsed = Date.now() - startTime;
                const stats = fs.statSync(filePath);
                console.log(`✅ (${(stats.size / 1024).toFixed(1)}KB, ${elapsed}ms)`);
                downloaded++;
                
                // Small delay
                await new Promise(r => setTimeout(r, 300));
                
            } catch (error) {
                console.log(`❌ ${error.message}`);
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

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

module.exports = { downloadImage };

