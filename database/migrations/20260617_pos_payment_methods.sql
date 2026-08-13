-- POS payment method toggles + website (host) cash discount settings
INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
('pos_payment_cash_enabled', 'true', 'Allow cash payments on Business One POS', 'boolean'),
('pos_payment_check_enabled', 'true', 'Allow check payments on Business One POS', 'boolean'),
('pos_payment_card_enabled', 'true', 'Allow card terminal payments on Business One POS', 'boolean'),
('store_cash_discount_enabled', 'false', 'Enable website/host cash discount (card price vs lower cash price)', 'boolean'),
('store_cash_discount_percent', '0', 'Website cash discount percent off merchandise (max 15)', 'number');
