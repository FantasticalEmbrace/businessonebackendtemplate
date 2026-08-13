-- POS receipt display and print options (no card data on receipt)
INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
('pos_receipt_show_cashier', 'true', 'Show cashier name on POS receipts', 'boolean'),
('pos_receipt_show_cash_savings', 'true', 'Show cash savings line on POS receipts', 'boolean'),
('pos_receipt_auto_print', 'true', 'Auto-open print dialog after each sale', 'boolean'),
('pos_receipt_copy_count', '2', 'Number of receipt copies to print (1–3)', 'number'),
('pos_receipt_show_order_barcode', 'true', 'Show order number as barcode on receipts', 'boolean');
