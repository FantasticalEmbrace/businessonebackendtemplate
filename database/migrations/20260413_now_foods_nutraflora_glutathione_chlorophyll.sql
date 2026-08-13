-- NOW Foods products: source site had $0 / placeholder copy; align DB with catalog overrides.
-- SKUs: 28673 NutraFlora FOS, 28696 Glutathione 250mg, 28709 Liquid Chlorophyll mint 4oz

UPDATE products
SET
    price = CASE TRIM(sku)
        WHEN '28673' THEN 14.99
        WHEN '28696' THEN 22.99
        WHEN '28709' THEN 14.99
        ELSE price
    END,
    short_description = CASE slug
        WHEN 'now-foods-nutraflora-fos' THEN 'NutraFlora FOS prebiotic powder supports friendly gut bacteria.'
        WHEN 'now-glutathione-250mg' THEN 'Free-form L-glutathione for antioxidant and cellular support.'
        WHEN 'now-liquid-chlorophyll-mint-4oz' THEN 'Liquid chlorophyll with a cool mint flavor — internal freshener.'
        ELSE short_description
    END
WHERE slug IN (
    'now-foods-nutraflora-fos',
    'now-glutathione-250mg',
    'now-liquid-chlorophyll-mint-4oz'
);
