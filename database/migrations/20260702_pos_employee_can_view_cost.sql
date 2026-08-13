-- Per-personnel permission to see product cost at the register.
ALTER TABLE pos_employees
    ADD COLUMN can_view_cost TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'May see product cost in POS cart when store cost display is enabled';
