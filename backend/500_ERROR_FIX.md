# 500 Internal Server Error Fix

## Root Cause Identified

From error logs (`backend/logs/error.log`):
```
Access denied for user 'root'@'localhost' (using password: NO)
```

**Issue:** The database password is not being loaded from the `.env` file, causing database authentication to fail.

## Fixes Applied

### 1. ✅ Improved .env Loading
   - **File:** `backend/server.js`
   - **Fix:** Moved `require('dotenv').config()` to the very top of the file, before any other requires
   - **Reason:** Ensures environment variables are loaded before database config is created

### 2. ✅ Better Error Handling in Admin Login
   - **File:** `backend/routes/admin.js`
   - **Fix:** Added specific error handling for database connection errors
   - **Result:** Returns more helpful error messages:
     - Database connection errors → "Database connection failed. Please check server configuration."
     - Missing table errors → "Database table not found. Please run database migrations."

### 3. ✅ Database Config Logging
   - **File:** `backend/server.js`
   - **Fix:** Added logging of database config (without password) in development mode
   - **Result:** Helps debug if .env is being loaded correctly

## Next Steps

### Check Your .env File

Make sure `backend/.env` exists and has the correct database credentials:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_actual_password_here
DB_NAME=hmherbs
JWT_SECRET=your_jwt_secret_here
```

### Verify Database Connection

1. **Check if MySQL is running:**
   ```powershell
   Get-Service -Name MySQL*
   ```

2. **Test database connection manually:**
   ```bash
   mysql -u root -p
   ```

3. **Verify database exists:**
   ```sql
   SHOW DATABASES;
   USE hmherbs;
   SHOW TABLES;
   ```

### If Database Doesn't Exist

Run the database migrations:
```bash
cd backend
npm run migrate
```

### If Admin User Doesn't Exist

Create an admin user:
```bash
cd backend
node scripts/set-admin-password.js
```

## Testing

After fixing the .env file:

1. **Restart the server:**
   ```bash
   cd backend
   npm start
   ```

2. **Check console output:**
   - Should see: "Database config: { host: 'localhost', user: 'root', database: 'hmherbs', hasPassword: true }"
   - Should NOT see: "Access denied" errors

3. **Test admin login:**
   - Open: `http://localhost:3001/admin.html`
   - Try logging in
   - Should work without 500 errors

## Summary

The 500 error was caused by database authentication failure due to missing/incorrect password in .env file. The fixes ensure:
- ✅ .env is loaded early
- ✅ Better error messages for debugging
- ✅ Database config is logged for verification

