-- ============================================
-- MySQL Database Rename Script
-- ============================================
-- WARNING: MySQL does not support RENAME DATABASE
-- This script provides the steps to rename a database
-- ============================================

-- Step 1: Create the new database
CREATE DATABASE IF NOT EXISTS `hmherbs_new` 
    CHARACTER SET utf8mb4 
    COLLATE utf8mb4_unicode_ci;

-- Step 2: Get list of all tables (run this query first to see what needs to be moved)
-- SELECT CONCAT('RENAME TABLE `hmherbs`.`', table_name, '` TO `hmherbs_new`.`', table_name, '`;')
-- FROM information_schema.tables
-- WHERE table_schema = 'hmherbs';

-- Step 3: Move each table (example - you'll need to do this for ALL tables)
-- RENAME TABLE `hmherbs`.`admin_users` TO `hmherbs_new`.`admin_users`;
-- RENAME TABLE `hmherbs`.`brands` TO `hmherbs_new`.`brands`;
-- RENAME TABLE `hmherbs`.`categories` TO `hmherbs_new`.`categories`;
-- RENAME TABLE `hmherbs`.`products` TO `hmherbs_new`.`products`;
-- ... (repeat for all tables)

-- Step 4: After moving all tables, drop the old database
-- DROP DATABASE IF EXISTS `hmherbs`;

-- Step 5: Rename the new database to the desired name
-- RENAME DATABASE `hmherbs_new` TO `hmherbs`;  -- This doesn't work in MySQL
-- Instead, you'll need to:
-- CREATE DATABASE `hmherbs` ... (then move tables back)

-- ============================================
-- RECOMMENDED APPROACH: Use mysqldump instead
-- ============================================
-- 1. Export: mysqldump -u user -p old_database > dump.sql
-- 2. Create new: CREATE DATABASE new_database;
-- 3. Import: mysql -u user -p new_database < dump.sql
-- 4. Drop old: DROP DATABASE old_database;

