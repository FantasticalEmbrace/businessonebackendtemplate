const all = JSON.parse(require('fs').readFileSync('all-products-image-audit.json'));
const missing = all.filter(r => !r.image_url || r.image_url === 'null' || r.image_url === '').map(p => {
  return { id: p.id, sku: p.sku, name: p.name, brand: p.brand_name, slug: p.slug };
});
require('fs').writeFileSync('all-products-missing-image-info.json', JSON.stringify(missing, null, 2));
require('fs').writeFileSync('all-products-missing-image-info.csv', 'sku,name,brand,slug\n' + missing.map(x => `"${x.sku}","${x.name.replace(/"/g, '""')}","${x.brand.replace(/"/g, '""')}","${x.slug}"`).join('\n'));

