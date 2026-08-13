-- Global inventory behavior for the web store
INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
('inventory_global_low_stock_threshold', '5', 'Default low-stock warning threshold when a product has no per-item threshold', 'number'),
('inventory_allow_oversell', 'false', 'Allow website sales when inventory is zero (per-product allow_backorder can also enable)', 'boolean'),
('inventory_hide_out_of_stock', 'false', 'Hide out-of-stock products from category/browse grids (product pages still work by direct link)', 'boolean');
