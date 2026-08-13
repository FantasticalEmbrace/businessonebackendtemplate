-- Customer type: retail and employee only (employee discount eligibility)
UPDATE users SET customer_type = 'retail' WHERE customer_type IN ('wholesale', 'staff');
UPDATE users SET customer_type = 'employee' WHERE customer_type = 'employee';

ALTER TABLE users
  MODIFY COLUMN customer_type ENUM('retail', 'employee') NOT NULL DEFAULT 'retail';

INSERT INTO settings (key_name, value, description, type) VALUES
('employee_discount_enabled', 'false', 'Apply a merchandise discount for customers marked Employee', 'boolean'),
('employee_discount_percent', '0', 'Employee merchandise discount percentage (0–100)', 'number')
ON DUPLICATE KEY UPDATE key_name = key_name;
