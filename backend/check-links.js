const axios = require('axios');
const cheerio = require('cheerio');

async function checkLinks() {
    const url = 'https://hmherbs.com/';
    try {
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        const $ = cheerio.load(res.data);
        console.log('--- Links ---');
        $('a').each((i, el) => {
            const text = $(el).text().trim();
            const href = $(el).attr('href');
            if (href && (href.includes('product') || href.includes('category') || text.length > 0)) {
                console.log(`Link: "${text}" -> ${href}`);
            }
        });
    } catch (err) {
        console.error(err.message);
    }
}

checkLinks();

