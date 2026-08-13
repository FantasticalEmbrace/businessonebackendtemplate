-- POS cash discount settings + customer display sync
INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
('pos_cash_discount_enabled', 'true', 'Enable in-store cash discount (card price vs lower cash price)', 'boolean'),
('pos_cash_discount_percent', '3.5', 'Cash discount percent off merchandise (max 15)', 'number');

CREATE TABLE IF NOT EXISTS pos_display_snapshots (
    device_id VARCHAR(64) NOT NULL PRIMARY KEY,
    payload JSON NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
