-- =============================================================================
-- H&M Herbs - Tax accountant monthly report (county + delivery log)
-- Migration: 20260601
-- =============================================================================

ALTER TABLE tax_entries
    ADD COLUMN county_name VARCHAR(100) NULL AFTER zip_code,
    ADD INDEX idx_tax_entries_county (county_name);

CREATE TABLE IF NOT EXISTS tax_report_deliveries (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    trigger_type ENUM('scheduled', 'manual') NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    row_count INT NOT NULL DEFAULT 0,
    sent_at DATETIME NOT NULL,
    INDEX idx_tax_report_deliveries_period (period_start, period_end),
    INDEX idx_tax_report_deliveries_sent (sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
