# Quick Start Guide - HM Herbs Website

## 🚀 Fastest Way to Get Running

### Step 1: Install Dependencies (2 minutes)

```bash
# Install backend dependencies
cd backend
npm install

# Install Google Calendar API (for EDSA booking)
npm install googleapis
```

### Step 2: Setup Database (3 minutes)

```bash
# Create database
mysql -u root -p -e "CREATE DATABASE hmherbs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Import schema
mysql -u root -p hmherbs < database/schema.sql

# Import seed data
mysql -u root -p hmherbs < database/seed-data.sql
```

### Step 3: Configure Environment (1 minute)

Create `backend/.env` file:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=hmherbs
PORT=3001
JWT_SECRET=your_random_secret_key_here
FRONTEND_URL=http://localhost:8000
```

### Step 4: Start Servers (1 minute)

**Terminal 1 - Backend:**
```bash
cd backend
npm start
```

**Terminal 2 - Frontend:**
```bash
# From project root
python -m http.server 8000
```

### Step 5: Test It!

1. Open browser: `http://localhost:8000`
2. Test features:
   - Browse products
   - Add to cart
   - Book EDSA session
   - Search functionality

## ✅ Quick Verification

Run the test script:
```bash
node test-site.js
```

This checks:
- ✓ All files exist
- ✓ Dependencies installed
- ✓ Backend API responding
- ✓ Database connection

## 🎯 What to Test

### Must Test:
- [ ] Home page loads
- [ ] Products page works
- [ ] Shopping cart functions
- [ ] EDSA booking modal opens
- [ ] Search works
- [ ] Navigation works

### Optional:
- [ ] Admin panel login
- [ ] Google Calendar integration
- [ ] Email notifications

## 📚 Full Documentation

See `SETUP_AND_TESTING.md` for complete setup instructions.

