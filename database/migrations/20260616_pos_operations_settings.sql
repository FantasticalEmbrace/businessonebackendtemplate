-- POS operations, reporting, and register help settings
INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
('pos_daily_sales_email_enabled', 'false', 'Email daily in-store sales summary to owner', 'boolean'),
('pos_daily_sales_email_to', '', 'Recipient for daily POS sales email (defaults to store email)', 'string'),
('pos_daily_sales_email_hour', '21', 'Hour to send daily sales email (0-23 local server time)', 'number'),
('pos_daily_sales_email_minute', '0', 'Minute to send daily sales email', 'number'),
('pos_eod_reminder_enabled', 'true', 'Remind register if shift still open after end-of-day time', 'boolean'),
('pos_eod_reminder_hour', '20', 'End-of-day reminder hour (0-23)', 'number'),
('pos_eod_reminder_minute', '0', 'End-of-day reminder minute', 'number'),
('pos_support_phone', '', 'Support phone shown on POS register help', 'string'),
('pos_help_url', '', 'Help URL shown on POS register', 'string'),
('pos_remote_support_notice', 'Authorized IT or Business One support may connect to this register remotely only with your permission. You will be asked to approve each session.', 'Remote support notice on register', 'string'),
('pos_catalog_refresh_minutes', '60', 'Auto-refresh product catalog interval in minutes (15-1440)', 'number');
