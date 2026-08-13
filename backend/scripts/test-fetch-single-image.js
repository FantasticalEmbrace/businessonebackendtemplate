/**
 * Test script to fetch a single product image
 */

const { searchProductOnBrandWebsite, downloadImage } = require('./fetch-product-images-from-brands');

async function testSingleImage() {
    // Test with a Now Foods product
    const brandName = 'Now Foods';
    const productName = 'NOW FOODS CoQ10 - 100MG';
    const brandWebsite = 'https://www.nowfoods.com';

    console.log(`Testing image fetch for: ${productName}`);
    console.log(`Brand website: ${brandWebsite}\n`);

    try {
        const imageUrl = await searchProductOnBrandWebsite(brandName, productName, brandWebsite);
        
        if (imageUrl) {
            console.log(`\n✅ Found image URL: ${imageUrl}`);
            
            // Try to download it
            const localPath = await downloadImage(imageUrl, 1518, 'now-foods-coq10-100mg');
            if (localPath) {
                console.log(`✅ Downloaded to: ${localPath}`);
            }
        } else {
            console.log('\n❌ Could not find image');
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testSingleImage();

