# Install All Dependencies - HM Herbs

This guide will help you install all required dependencies for the HM Herbs website.

## 📦 Required Dependencies

### 1. Node.js and npm

**Check if installed:**
```bash
node --version
npm --version
```

**If not installed:**
- Download from: https://nodejs.org/
- Install version 16 or higher
- Restart your terminal after installation

### 2. MySQL Database

**Check if installed:**
```bash
mysql --version
```

**If not installed:**
- Windows: Download MySQL Installer from https://dev.mysql.com/downloads/installer/
- Mac: `brew install mysql` or download from MySQL website
- Linux: `sudo apt-get install mysql-server` (Ubuntu/Debian)

**Start MySQL:**
- Windows: Services → MySQL → Start
- Mac/Linux: `sudo service mysql start` or `brew services start mysql`

## 🔧 Install Project Dependencies

### Step 1: Install Root Dependencies

```bash
# From project root directory
npm install
```

### Step 2: Install Backend Dependencies

```bash
cd backend
npm install
```

This installs:
- Express.js (web server)
- MySQL2 (database driver)
- JWT (authentication)
- And all other backend packages

### Step 3: Install Google Calendar API (for EDSA booking)

```bash
# Still in backend directory
npm install googleapis
```

This enables automatic Google Calendar sync for EDSA bookings.

## ✅ Verify Installation

### Check Backend Dependencies

```bash
cd backend
npm list --depth=0
```

You should see packages like:
- express
- mysql2
- jsonwebtoken
- googleapis
- etc.

### Check if node_modules exists

```bash
# Backend
ls backend/node_modules

# Root (if any)
ls node_modules
```

## 🚨 Troubleshooting

### "npm is not recognized"
- Node.js is not installed or not in PATH
- Reinstall Node.js and restart terminal

### "Permission denied" errors
- Windows: Run terminal as Administrator
- Mac/Linux: Use `sudo` (not recommended) or fix npm permissions

### "Cannot find module" errors
- Run `npm install` again
- Delete `node_modules` and `package-lock.json`, then reinstall
- Check `package.json` has correct dependencies

### MySQL connection errors
- Make sure MySQL is running
- Check username/password in `.env` file
- Verify database exists: `mysql -u root -p -e "SHOW DATABASES;"`

## 📋 Quick Install Script

For Windows (PowerShell):
```powershell
# Install root dependencies
npm install

# Install backend dependencies
cd backend
npm install
npm install googleapis
cd ..
```

For Mac/Linux:
```bash
# Install root dependencies
npm install

# Install backend dependencies
cd backend && npm install && npm install googleapis && cd ..
```

## 🎯 Next Steps

After installing dependencies:

1. **Setup Database:**
   ```bash
   mysql -u root -p hmherbs < database/schema.sql
   ```

2. **Configure Environment:**
   - Copy `backend/.env.example` to `backend/.env`
   - Edit with your database credentials

3. **Start Backend:**
   ```bash
   cd backend
   npm start
   ```

4. **Start Frontend:**
   ```bash
   python -m http.server 8000
   ```

5. **Test:**
   - Open `http://localhost:8000`
   - Run `node test-site.js` (if Node.js is in PATH)

## 📚 Additional Resources

- **Full Setup Guide:** `SETUP_AND_TESTING.md`
- **Quick Start:** `QUICK_START.md`
- **Testing Checklist:** `TESTING_CHECKLIST.md`

