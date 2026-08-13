const axios = require('axios');
const cheerio = require('cheerio');

async function checkBreadcrumbs() {
    const url = 'https://hmherbs.com/index.php/products/1lifescience-glp-1-pro';
    try {
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        const $ = cheerio.load(res.data);
        console.log('--- Breadcrumbs ---');
        $('.breadcrumb a, .breadcrumbs a, .nav-breadcrumb a').each((i, el) => {
            console.log(`Breadcrumb ${i}: "${$(el).text().trim()}" - ${$(el).attr('href')}`);
        });

        console.log('\n--- h1 ---');
        console.log($('h1').text().trim());

        console.log('\n--- Possible category elements ---');
        $('*').each((i, el) => {
            const text = $(el).text().trim().toLowerCase();
            if (text.includes('category') || $(el).hasClass('category')) {
                // Only print if it's small/likely a label
                if ($(el).text().length < 100) {
                    console.log(`Element ${i}: Tag: ${el.tagName}, Class: ${$(el).attr('class')}, Text: "${$(el).text().trim()}"`);
                }
            }
        });
    } catch (err) {
        console.error(err.message);
    }
}

checkBreadcrumbs();

