-- POS register experience: touch mode, scan beep, quick keys, display hours, personnel mode, return policy
INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
('pos_large_touch_mode', 'false', 'Larger category and product buttons on POS register', 'boolean'),
('pos_scan_beep_enabled', 'true', 'Play beep when barcode scan finds a product', 'boolean'),
('pos_quick_keys', '[]', 'Pinned quick keys JSON: SKU or category shortcuts on register', 'string'),
('pos_display_store_hours_idle', 'true', 'Show store hours on idle customer display', 'boolean'),
('pos_personnel_mode', 'time_clock_and_pos', 'Personnel mode: time_clock_only or time_clock_and_pos', 'string'),
('pos_receipt_return_policy', '', 'Return policy line printed on POS receipts (text only)', 'string'),
('pos_show_cost_in_cart', 'false', 'Show product cost in POS cart for manual discount decisions', 'boolean');
