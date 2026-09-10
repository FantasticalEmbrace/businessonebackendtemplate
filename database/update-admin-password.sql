-- Update admin password to "admin1"
-- Run this SQL script to set the admin password
-- Password: admin1
-- Email: admin@example.com

-- Note: This uses a pre-generated bcrypt hash for "admin1"
-- If you need to generate a new hash, use: node -e "const bcrypt=require('bcrypt');bcrypt.hash('admin1',12).then(h=>console.log(h))"

UPDATE admin_users 
SET password_hash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6hsxq5S/kS',
    updated_at = NOW()
WHERE email = 'admin@example.com';

-- If admin doesn't exist, create it:
INSERT INTO admin_users (email, password_hash, first_name, last_name, role, is_active, created_at, updated_at)
SELECT 'admin@example.com',
       '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6hsxq5S/kS',
       'Admin',
       'User',
       'admin',
       1,
       NOW(),
       NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = 'admin@example.com'
);

