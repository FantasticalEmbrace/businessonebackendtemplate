-- Per-variant product photo for storefront option switching.
ALTER TABLE product_variants
    ADD COLUMN IF NOT EXISTS image_url VARCHAR(500) NULL DEFAULT NULL AFTER cost_price;
