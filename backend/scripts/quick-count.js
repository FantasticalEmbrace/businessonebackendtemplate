// Quick script to count total products across all pages
const axios = require('axios');
const cheerio = require('cheerio');

async function countProducts() {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };
    
    let totalProducts = 0;
    let totalPages = 0;
    
    console.log('🔍 Counting products across all pages...');
    
    for (let page = 1; page <= 37; page++) {
        try {
            const url = page === 1 
                ? 'https://hmherbs.com/index.php/products'
                : `https://hmherbs.com/index.php/products?ccm_paging_p=${page}`;
            
            console.log(`📄 Checking page ${page}...`);
            
            const response = await axios.get(url, { headers, timeout: 10000 });
            const $ = cheerio.load(response.data);
            
            // Count product links on this page
            const productLinks = [];
            const selectors = [
                'a[href*="/index.php/products/"]',
                'a[href*="/products/"]'
            ];
            
            selectors.forEach(selector => {
                $(selector).each((i, el) => {
                    const href = $(el).attr('href');
                    if (href && href.includes('/products/') && !href.includes('?ccm_paging_p=')) {
                        productLinks.push(href);
                    }
                });
            });
            
            const uniqueProducts = [...new Set(productLinks)].length;
            console.log(`   Found ${uniqueProducts} products on page ${page}`);
            
            if (uniqueProducts === 0) {
                console.log(`   No products found on page ${page}, stopping...`);
                break;
            }
            
            totalProducts += uniqueProducts;
            totalPages = page;
            
            // Small delay to be respectful
            await new Promise(resolve => setTimeout(resolve, 500));
            
        } catch (error) {
            console.log(`   Error on page ${page}: ${error.message}`);
            break;
        }
    }
    
    console.log(`\n📊 SUMMARY:`);
    console.log(`   Total pages checked: ${totalPages}`);
    console.log(`   Total unique products found: ${totalProducts}`);
    console.log(`   Average products per page: ${(totalProducts / totalPages).toFixed(1)}`);
}

countProducts().catch(console.error);
