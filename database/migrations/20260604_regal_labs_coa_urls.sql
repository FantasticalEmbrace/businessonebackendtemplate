-- Regal Labs COA assets are hosted under /images/coa/ (HTML index + PDF/JPG files).

UPDATE products
SET coa_url = '/images/coa/regalabs-cannabis-care-coa.html',
    coa_updated_at = '2026-06-04',
    is_cannabis = 1
WHERE slug IN ('regalabs-cannabis-care-cream-free-shipping', 'regalabs-cannabis-care-roll-on');

UPDATE products
SET coa_url = '/images/coa/regalabs-organic-cbd-oils-coas.html',
    coa_updated_at = '2026-06-04',
    is_cannabis = 1
WHERE slug = 'regalabs-organic-cbd-oils';
