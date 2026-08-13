#!/usr/bin/env node
const axios = require('axios');
const { extractAllHmherbsVariationData } = require('../utils/extractHmherbsVariationData');
const { extractHmherbsVariantsFromHtml } = require('../utils/extractHmherbsVariants');

const url = process.argv[2] || 'https://hmherbs.com/index.php/products/equalizer-plus-arthritis-relief-cream-w-peppermint';

axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 25000 }).then((r) => {
    const vars = extractHmherbsVariantsFromHtml(r.data);
    const vdata = extractAllHmherbsVariationData(r.data);
    console.log('variants from options:', vars.variants.length);
    console.log('variationData entries:', vdata.length);
    vars.variants.slice(0, 3).forEach((v) => console.log('  opt', v.name, v.price, v.image_url || v.imageUrl || 'no img'));
    vdata.slice(0, 5).forEach((v) => console.log('  vdata', v.sku, v.price, v.imageUrl));
}).catch((e) => console.error(e.message));
