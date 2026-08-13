const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/scraped-products.json'), 'utf8'));
const skus = ['12414', '654', '25407', '27967', 'HM-ADVANCEDBLOODPRESSURECHERRY'];
for (const s of skus) {
    const p = (data.products || []).find((x) => String(x.sku).toUpperCase() === String(s).toUpperCase());
    console.log(s, p ? p.price : 'NOT FOUND', p ? p.url : '');
}
