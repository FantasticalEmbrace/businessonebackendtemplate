-- COA files live under /images/coa/ (see backend/scripts/apply-product-coa-map.js to re-apply).
-- Run only if you prefer SQL over the Node script.

UPDATE products SET coa_url = '/images/coa/herbs-for-life-15mg-coa-2024-09-19.pdf', coa_updated_at = '2024-09-19', is_cannabis = 1
WHERE slug = 'herbs-for-life-cbd-gummies-sleep';

UPDATE products SET coa_url = '/images/coa/herbs-for-life-30mg-coa-2024-09-19.pdf', coa_updated_at = '2024-09-19', is_cannabis = 1
WHERE slug = 'herbs-for-life-cbd-gummies-30mg';

UPDATE products SET coa_url = '/images/coa/herbs-for-life-delta-9-coa.pdf', coa_updated_at = '2024-09-19', is_cannabis = 1
WHERE slug = 'herbs-for-life-delta-9-gummies-10mg-ea';

UPDATE products SET coa_url = '/images/coa/hippie-jacks-extreme-pain-cream-coa.pdf', coa_updated_at = '2026-04-16', is_cannabis = 1
WHERE slug = 'hippie-jack-s-cbd-extreme-1000mg-pain-cream';

UPDATE products SET coa_url = '/images/coa/regalabs-cannabis-care-coa.html', coa_updated_at = '2026-04-16', is_cannabis = 1
WHERE slug IN ('regalabs-cannabis-care-cream-free-shipping', 'regalabs-cannabis-care-roll-on');

UPDATE products SET coa_url = '/images/coa/regalabs-organic-cbd-oils-coas.html', coa_updated_at = '2025-07-25', is_cannabis = 1
WHERE slug = 'regalabs-organic-cbd-oils';
