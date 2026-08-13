// Test downloading ONE single image - minimal test
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');

async function testSingleImage() {
    console.log('🧪 Testing download of ONE image...\n');
    
    // Get first product's first image from scraped data
    const dataPath = path.join(__dirname, '../data/complete-scraped-products.json');
    console.log('📂 Loading data from:', dataPath);
    
    const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
    const product = data.products[0];
    
    console.log('\n📦 Product:', product.name);
    console.log('🔗 Product URL:', product.url);
    console.log('📸 Images found:', product.images ? product.images.length : 0);
    
    if (!product.images || product.images.length === 0) {
        console.error('❌ No images found for first product!');
        process.exit(1);
    }
    
    const imageUrl = product.images[0].url;
    console.log('\n🖼️  Image URL:', imageUrl);
    console.log('📝 Image Alt:', product.images[0].alt);
    
    // Create directory
    const imagesDir = path.join(__dirname, '../../images/products');
    await fs.mkdir(imagesDir, { recursive: true });
    console.log('\n📁 Images directory:', imagesDir);
    
    // Create filename
    const filename = 'test-single-image.jpg';
    const filePath = path.join(imagesDir, filename);
    console.log('💾 Target file:', filePath);
    
    // Check if already exists
    try {
        await fs.access(filePath);
        console.log('\n⚠️  File already exists! Deleting to test fresh download...');
        await fs.unlink(filePath);
    } catch {
        console.log('\n✓ File does not exist, proceeding with download...');
    }
    
    // Download with detailed logging
    console.log('\n📥 Starting download...');
    console.log('   Method: GET');
    console.log('   URL:', imageUrl);
    console.log('   Timeout: 30000ms');
    
    try {
        const startTime = Date.now();
        
        const response = await axios({
            method: 'GET',
            url: imageUrl,
            responseType: 'arraybuffer',
            timeout: 30000,
            maxRedirects: 5,
            validateStatus: function (status) {
                return status >= 200 && status < 400; // Accept 2xx and 3xx
            },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://hmherbs.com/',
                'Accept-Encoding': 'gzip, deflate, br'
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false
            }),
            // Add response interceptor for debugging
            transformResponse: [(data) => {
                console.log('   📊 Response received, size:', data.length, 'bytes');
                return data;
            }]
        });
        
        const downloadTime = Date.now() - startTime;
        console.log(`\n✅ Download successful!`);
        console.log('   Status:', response.status);
        console.log('   Status Text:', response.statusText);
        console.log('   Content-Type:', response.headers['content-type']);
        console.log('   Content-Length:', response.headers['content-length'], 'bytes');
        console.log('   Actual Data Size:', response.data.length, 'bytes');
        console.log('   Download Time:', downloadTime, 'ms');
        
        // Save file
        console.log('\n💾 Saving file...');
        await fs.writeFile(filePath, response.data);
        
        // Verify file was saved
        const stats = await fs.stat(filePath);
        console.log('\n✅ File saved successfully!');
        console.log('   File path:', filePath);
        console.log('   File size:', stats.size, 'bytes');
        console.log('   File size:', (stats.size / 1024).toFixed(2), 'KB');
        
        // Try to verify it's a valid image
        const firstBytes = response.data.slice(0, 4);
        const isJpeg = firstBytes[0] === 0xFF && firstBytes[1] === 0xD8;
        const isPng = firstBytes[0] === 0x89 && firstBytes[1] === 0x50 && firstBytes[2] === 0x4E && firstBytes[3] === 0x47;
        
        if (isJpeg) {
            console.log('   ✓ Valid JPEG image');
        } else if (isPng) {
            console.log('   ✓ Valid PNG image');
        } else {
            console.log('   ⚠️  Unknown image format (first bytes:', Array.from(firstBytes).map(b => '0x' + b.toString(16)).join(' '), ')');
        }
        
        console.log('\n🎉 Test completed successfully!');
        
    } catch (error) {
        console.error('\n❌ Download failed!');
        console.error('   Error type:', error.constructor.name);
        console.error('   Error message:', error.message);
        
        if (error.code) {
            console.error('   Error code:', error.code);
        }
        
        if (error.response) {
            console.error('   Response status:', error.response.status);
            console.error('   Response status text:', error.response.statusText);
            console.error('   Response headers:', JSON.stringify(error.response.headers, null, 2));
        }
        
        if (error.request) {
            console.error('   Request made but no response received');
            console.error('   Request config:', JSON.stringify({
                url: error.config?.url,
                method: error.config?.method,
                timeout: error.config?.timeout
            }, null, 2));
        }
        
        if (error.stack) {
            console.error('\n   Stack trace:');
            console.error(error.stack);
        }
        
        process.exit(1);
    }
}

testSingleImage().catch(err => {
    console.error('\n💥 Fatal error:', err);
    process.exit(1);
});

