const axios = require('axios');
const cheerio = require('cheerio');

const url = process.argv[2] || 'https://hmherbs.com/index.php/products/hm-womens-touch-body-cream';

axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then((r) => {
    const $ = cheerio.load(r.data);
    console.log('=== select options ===');
    $('select option').each((i, el) => console.log(i, $(el).text().trim(), $(el).attr('value')));
    console.log('=== selects ===');
    $('select').each((i, el) => {
        console.log('select', $(el).attr('name'), $(el).attr('id'), $(el).attr('class'));
    });
    console.log('=== variant-ish blocks ===');
    $('[class*="variant"], [class*="option"], [id*="variant"], .product-options').each((i, el) => {
        const tag = el.tagName;
        const cls = $(el).attr('class');
        const txt = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 200);
        console.log(tag, cls, txt);
    });
}).catch((e) => console.error(e.message));
