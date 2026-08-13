-- Remove placeholder admin account (email does not exist)
DELETE FROM admin_users WHERE email = 'admin@hmherbs.com';
