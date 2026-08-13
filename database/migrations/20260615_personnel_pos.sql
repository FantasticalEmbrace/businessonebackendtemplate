-- Business One POS personnel, shifts, timesheets, cash drawer
-- Applied automatically via ensurePersonnelSchema on server start

CREATE TABLE IF NOT EXISTS pos_employees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_code VARCHAR(8) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NULL,
    pin_hash VARCHAR(255) NOT NULL,
    admin_user_id INT NULL,
    hourly_rate DECIMAL(8,2) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_pos_employee_code (employee_code)
);

CREATE TABLE IF NOT EXISTS pos_scheduled_shifts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    starts_at DATETIME NOT NULL,
    ends_at DATETIME NOT NULL,
    notes VARCHAR(500) NULL,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pos_shift_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    scheduled_shift_id INT NULL,
    device_id VARCHAR(64) NULL,
    status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
    opened_at DATETIME NOT NULL,
    closed_at DATETIME NULL,
    opening_cash DECIMAL(10,2) NOT NULL DEFAULT 0,
    closing_cash DECIMAL(10,2) NULL,
    expected_cash DECIMAL(10,2) NULL,
    over_short_amount DECIMAL(10,2) NULL,
    cash_sales_total DECIMAL(10,2) NOT NULL DEFAULT 0,
    card_sales_total DECIMAL(10,2) NOT NULL DEFAULT 0,
    check_sales_total DECIMAL(10,2) NOT NULL DEFAULT 0,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pos_cash_drawer_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shift_session_id INT NOT NULL,
    event_type ENUM('paid_out', 'drop', 'cash_in') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    reason VARCHAR(255) NULL,
    recorded_by_employee_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pos_time_entries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    shift_session_id INT NULL,
    clock_in DATETIME NOT NULL,
    clock_out DATETIME NULL,
    source ENUM('pos', 'admin') NOT NULL DEFAULT 'pos',
    notes VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
