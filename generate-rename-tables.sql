-- ============================================
-- Generate RENAME TABLE statements for all tables
-- ============================================
-- Run this query in mysql CLI or a SQL client to generate RENAME TABLE statements
-- Copy the output and execute it
-- ============================================

-- Replace 'old_database' with your current database name
-- Replace 'new_database' with your desired database name

SELECT CONCAT('RENAME TABLE `old_database`.`', table_name, '` TO `new_database`.`', table_name, '`;') AS rename_statement
FROM information_schema.tables
WHERE table_schema = 'old_database'
ORDER BY table_name;

-- ============================================
-- Example output will look like:
-- ============================================
-- RENAME TABLE `old_database`.`admin_users` TO `new_database`.`admin_users`;
-- RENAME TABLE `old_database`.`brands` TO `new_database`.`brands`;
-- RENAME TABLE `old_database`.`products` TO `new_database`.`products`;
-- ... etc

