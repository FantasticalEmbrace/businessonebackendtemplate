-- Managers who can approve discounts, voids, and refunds at the register
ALTER TABLE pos_employees
    ADD COLUMN can_authorize TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'May approve POS discounts, voids, and refunds with their PIN'
    AFTER is_active;
