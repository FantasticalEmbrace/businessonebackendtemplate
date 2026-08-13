const axios = require('axios');
const cheerio = require('cheerio');

const urls = [
    'https://hmherbs.com/index.php/products/buried-treasure-acf-pm',
    'https://hmherbs.com/index.php/products/buried-treasure-acf-pm-sku-28710',
    'https://hmherbs.com/index.php/products/regal-labs-biotin-10000',
    'https://hmherbs.com/index.php/products/newton-labs-incontinence'
];

(async () => {
    for (const url of urls) {
        try {
            const res = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 15000,
                validateStatus: (s) => s < 500
            });
            const $ = cheerio.load(res.data);
            const h1 = $('h1').first().text().trim();
            const priceEl = $('.store-product-price, .product-price, .price').first().text().trim();
            const ld = [];
            $('script[type="application/ld+json"]').each((_, el) => {
                try {
                    const j = JSON.parse($(el).html());
                    ld.push(j);
                } catch (_) {}
            });
            console.log({ url, status: res.status, h1: h1.slice(0, 80), priceEl, ldOffers: ld[0]?.offers });
        } catch (e) {
            console.log({ url, error: e.message });
        }
    }
})();
