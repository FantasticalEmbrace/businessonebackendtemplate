-- COA files pulled from legacy hmherbs.com (see backend/scripts/fetch-coa-from-old-site.js).
-- Only sets coa_url when not already populated.

UPDATE products SET coa_url = '/images/coa/hippie-jacks-yummy-hemp-gummie-coa.pdf', coa_updated_at = '2026-06-12', is_cannabis = 1
WHERE slug = 'hippie-jack-s-yummy-hemp-gummie' AND (coa_url IS NULL OR TRIM(coa_url) = '');

UPDATE products SET coa_url = '/images/coa/hemp-bombs-cbd-gummies-w-mushroom-coas.html', coa_updated_at = '2026-06-12', is_cannabis = 1
WHERE slug = 'hemp-bombs-cbd-gummies-w-mushroom' AND (coa_url IS NULL OR TRIM(coa_url) = '');
