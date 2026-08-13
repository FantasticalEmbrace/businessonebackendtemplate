#!/usr/bin/env node
'use strict';
const { createPool } = require('../utils/dbConfig');

const SQL = `
CREATE TABLE IF NOT EXISTS order_payment_tenders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    tender_type ENUM('cash','card_terminal','check','gift_card','loyalty_cash','loyalty_points') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    loyalty_points INT NULL,
    gift_card_id INT NULL,
    payment_reference VARCHAR(120) NULL,
    cash_tendered DECIMAL(10,2) NULL,
    cash_change DECIMAL(10,2) NULL,
    check_number VARCHAR(32) NULL,
    terminal_last_four VARCHAR(4) NULL,
    terminal_auth_code VARCHAR(64) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    INDEX idx_order_tenders_order (order_id),
    INDEX idx_order_tenders_type (tender_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

async function main() {
    const pool = createPool({ connectionLimit: 1 });
    const [tbl] = await pool.query("SHOW TABLES LIKE 'order_payment_tenders'");
    if (tbl.length) {
        console.log('Table already exists: order_payment_tenders');
    } else {
        await pool.query(SQL);
        console.log('Migration applied: order_payment_tenders');
    }
    await pool.end();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
