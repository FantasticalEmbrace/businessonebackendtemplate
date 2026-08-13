# Quick Fix for 500 Error

## The Problem

The error log shows:
```
Access denied for user 'root'@'localhost' (using password: NO)
```

**Your `.env` file is missing the database password!**

## The Solution

### Step 1: Open `backend/.env` file

### Step 2: Add or update this line:

```env
DB_PASSWORD=your_mysql_password_here
```

**Replace `your_mysql_password_here` with your actual MySQL root password.**

### Step 3: Save the file

### Step 4: Restart the server

Stop the server (Ctrl+C) and restart:
```bash
cd backend
npm start
```

### Step 5: Check the console

You should see:
```
Database config: { host: 'localhost', user: 'root', database: 'hmherbs', hasPassword: true }
```

If you see `hasPassword: false`, the password is still not set correctly.

## Example .env File

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=MyPassword123
DB_NAME=hmherbs
JWT_SECRET=any_random_string_here
PORT=3001
NODE_ENV=development
```

## Still Not Working?

1. **Check if MySQL is running:**
   ```powershell
   Get-Service -Name MySQL*
   ```

2. **Test MySQL password manually:**
   ```bash
   mysql -u root -p
   ```
   (Enter your password when prompted)

3. **Check .env file location:**
   - Must be in `backend/` folder
   - File name is exactly `.env` (not `.env.txt`)

4. **Check for typos:**
   - Variable name must be exactly: `DB_PASSWORD`
   - No spaces around `=`
   - No quotes around the value

## After Fixing

Once you add the password and restart, the error message will change from:
- ❌ "Internal server error" 
- ✅ "Database connection failed. Please check server configuration."

This confirms the error handling is working and you just need to fix the password.

