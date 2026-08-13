-- Per-variant wholesale/cost for POS margin and receiving.
ALTER TABLE product_variants
    ADD COLUMN IF NOT EXISTS cost_price DECIMAL(10,2) NULL DEFAULT NULL AFTER compare_price;
