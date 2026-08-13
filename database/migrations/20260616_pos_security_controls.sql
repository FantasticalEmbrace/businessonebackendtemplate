-- POS manager controls: sign-out after sale, discount limits, void/refund PIN policy
INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
('pos_sign_out_after_sale', 'false', 'Sign cashier out after each completed sale (shared registers)', 'boolean'),
('pos_require_manager_pin_discounts', 'true', 'Require manager PIN for line discounts above threshold', 'boolean'),
('pos_require_manager_pin_void_refund', 'true', 'Require manager PIN to void sales or process refunds', 'boolean'),
('pos_max_line_discount_percent', '10', 'Max line discount percent without manager PIN (0 = manager required for any discount)', 'number');
