// Quick test to download a single image
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

async function testDownload() {
    console.log('🧪 Testing image download...\n');
    
    // Get first product from scraped data
    const dataPath = path.join(__dirname, '../data/complete-scraped-products.json');
    const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
    const product = data.products[0];
    
    console.log('Product:', product.name);
    console.log('Images found:', product.images ? product.images.length : 0);
    
    if (!product.images || product.images.length === 0) {
        console.log('❌ No images found for first product');
        return;
    }
    
    const imageUrl = product.images[0].url;
    console.log('Image URL:', imageUrl);
    
    // Create directory
    const imagesDir = path.join(__dirname, '../../images/products');
    await fs.mkdir(imagesDir, { recursive: true });
    console.log('Directory:', imagesDir);
    
    // Download
    try {
        console.log('\n📥 Downloading image...');
        const response = await axios({
            method: 'GET',
            url: imageUrl,
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        const filename = 'test-image.jpg';
        const filePath = path.join(imagesDir, filename);
        await fs.writeFile(filePath, response.data);
        
        console.log('✅ Image downloaded successfully!');
        console.log('Saved to:', filePath);
        console.log('File size:', (response.data.length / 1024).toFixed(2), 'KB');
        
    } catch (error) {
        console.error('❌ Download failed:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Status text:', error.response.statusText);
        }
        if (error.code) {
            console.error('Error code:', error.code);
        }
    }
}

testDownload().catch(console.error);

