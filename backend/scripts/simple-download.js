// Simple, robust image downloader for first 10 products
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');

async function downloadImages() {
    console.log('Starting image download...\n');
    
    // Load products
    const dataPath = path.join(__dirname, '../data/complete-scraped-products.json');
    const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
    const products = data.products.slice(0, 10);
    
    console.log(`Processing ${products.length} products\n`);
    
    // Create directory
    const imagesDir = path.join(__dirname, '../../images/products');
    await fs.mkdir(imagesDir, { recursive: true });
    
    let downloaded = 0;
    let failed = 0;
    
    for (let i = 0; i < products.length; i++) {
        const product = products[i];
        console.log(`\n[${i + 1}/${products.length}] ${product.name.substring(0, 50)}...`);
        
        if (!product.images || product.images.length === 0) {
            console.log('  No images');
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
                } catch {}
                
                console.log(`  Downloading ${filename}...`);
                
                // Download with proper headers for WordPress CDN
                const response = await axios({
                    method: 'GET',
                    url: imageUrl,
                    responseType: 'arraybuffer',
                    timeout: 30000,
                    maxRedirects: 5,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Referer': 'https://hmherbs.com/',
                        'Accept-Encoding': 'gzip, deflate, br'
                    },
                    httpsAgent: new https.Agent({
                        rejectUnauthorized: false
                    })
                });
                
                await fs.writeFile(filePath, response.data);
                console.log(`  ✅ ${filename} (${(response.data.length / 1024).toFixed(1)}KB)`);
                downloaded++;
                
                // Small delay
                await new Promise(r => setTimeout(r, 300));
                
            } catch (error) {
                console.log(`  ❌ Failed: ${error.message}`);
                failed++;
            }
        }
    }
    
    console.log(`\n\nDone! Downloaded: ${downloaded}, Failed: ${failed}`);
}

downloadImages().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

