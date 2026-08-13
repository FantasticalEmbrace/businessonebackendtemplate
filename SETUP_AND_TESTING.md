# HM Herbs - Complete Setup & Testing Guide

This guide will help you set up and test all functionality of the HM Herbs website.

## 📋 Prerequisites Checklist

- [ ] Node.js (v16 or higher) installed
- [ ] MySQL database server installed and running
- [ ] npm or yarn package manager
- [ ] Code editor (VS Code recommended)

## 🚀 Quick Setup Steps

### 1. Install Dependencies

```bash
# Install root dependencies
npm install

# Install backend dependencies
cd backend
npm install

# Install Google Calendar API package (for EDSA booking)
npm install googleapis
```

### 2. Database Setup

#### Option A: Using MySQL Command Line
```bash
# Login to MySQL
mysql -u root -p

# Create database
CREATE DATABASE hmherbs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# Exit MySQL
exit
```

#### Option B: Using MySQL Workbench
1. Open MySQL Workbench
2. Connect to your MySQL server
3. Create a new schema named `hmherbs`
4. Set charset to `utf8mb4` and collation to `utf8mb4_unicode_ci`

#### Run Database Schema
```bash
# From project root
mysql -u root -p hmherbs < database/schema.sql

# Seed initial data
mysql -u root -p hmherbs < database/seed-data.sql
```

### 3. Environment Configuration

Create `backend/.env` file:

```env
# Database Configuration
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=hmherbs

# Server Configuration
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:8000

# JWT Secret (generate a random string)
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production

# Admin Configuration
ADMIN_EMAIL=hmherbs1@gmail.com
ADMIN_PASSWORD=your_admin_password

# Google Calendar (Optional - for EDSA booking)
GOOGLE_CALENDAR_ID=hmherbs1@gmail.com
GOOGLE_CREDENTIALS_PATH=backend/config/google-credentials.json

# Email Configuration (Optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=hmherbs1@gmail.com
SMTP_PASSWORD=your_app_password

# Stripe (Optional - for payments)
STRIPE_SECRET_KEY=sk_test_your_stripe_key
STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_key
```

### 4. Start the Backend Server

```bash
cd backend
npm start
# Or for development with auto-reload:
npm run dev
```

The backend should start on `http://localhost:3001`

### 5. Start the Frontend

#### Option A: Python HTTP Server (Simple)
```bash
# From project root
python -m http.server 8000
# Or Python 2:
python -m SimpleHTTPServer 8000
```

#### Option B: Using npm script
```bash
npm run serve
```

#### Option C: Using VS Code Live Server Extension
1. Install "Live Server" extension in VS Code
2. Right-click on `index.html`
3. Select "Open with Live Server"

The frontend should be available at `http://localhost:8000`

## ✅ Functionality Testing Checklist

### Frontend Features

#### Home Page (`index.html`)
- [ ] Page loads without errors
- [ ] Navigation menu works (Home, Products, Health Conditions, etc.)
- [ ] Search icon is visible and clickable
- [ ] Shopping cart icon is visible and clickable
- [ ] Hero section displays correctly
- [ ] Product spotlight section shows products
- [ ] Health categories section displays
- [ ] EDSA service section displays
- [ ] Footer displays with correct contact information
- [ ] Cookie consent banner appears (if not accepted)
- [ ] No console errors

#### Products Page (`products.html`)
- [ ] Page loads without errors
- [ ] Product grid displays products
- [ ] Search functionality works
- [ ] Filter by category works
- [ ] Filter by brand works
- [ ] Add to cart button works
- [ ] Product cards are aligned properly
- [ ] Pagination works (if many products)

#### Shopping Cart
- [ ] Cart opens when cart icon is clicked
- [ ] Cart closes when X is clicked
- [ ] Items appear in cart when added
- [ ] Quantity can be updated
- [ ] Items can be removed
- [ ] Total price calculates correctly
- [ ] Cart persists on page refresh (localStorage)

#### EDSA Booking
- [ ] "Book EDSA Session" button opens modal
- [ ] Calendar displays correctly
- [ ] Can navigate between months
- [ ] Can select a date
- [ ] Time slots appear after date selection
- [ ] Can select a time slot
- [ ] Booking form displays
- [ ] Form validation works
- [ ] Can submit booking
- [ ] Success message appears

#### Navigation
- [ ] All navigation links work
- [ ] Mobile menu toggles correctly
- [ ] Search dropdown works
- [ ] No layout issues (everything on one line)
- [ ] Breadcrumb hidden on home page

### Backend API Testing

#### Test with curl or Postman

**1. Health Check**
```bash
curl http://localhost:3001/api/health
```

**2. Get Products**
```bash
curl http://localhost:3001/api/public/products?limit=10
```

**3. Get EDSA Info**
```bash
curl http://localhost:3001/api/edsa/info
```

**4. Get Available Time Slots**
```bash
curl "http://localhost:3001/api/edsa/available-slots?date=2024-12-25"
```

**5. Book EDSA Appointment**
```bash
curl -X POST http://localhost:3001/api/edsa/book \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "7068619454",
    "preferredDate": "2024-12-25",
    "preferredTime": "14:00",
    "notes": "Test booking"
  }'
```

**6. Admin Login**
```bash
curl -X POST http://localhost:3001/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "hmherbs1@gmail.com",
    "password": "your_admin_password"
  }'
```

### Admin Panel (`admin.html`)

- [ ] Can access admin panel
- [ ] Login form works
- [ ] Dashboard displays statistics
- [ ] Products section loads
- [ ] Can create new product
- [ ] Can edit existing product
- [ ] Orders section loads
- [ ] EDSA bookings section loads
- [ ] Settings section accessible

## 🔧 Troubleshooting

### Backend Won't Start

**Error: Cannot connect to database**
- Check MySQL is running: `mysql -u root -p`
- Verify database exists: `SHOW DATABASES;`
- Check `.env` file has correct credentials

**Error: Port already in use**
- Change PORT in `.env` file
- Or kill process using port 3001:
  ```bash
  # Windows
  netstat -ano | findstr :3001
  taskkill /PID <PID> /F
  
  # Mac/Linux
  lsof -ti:3001 | xargs kill
  ```

**Error: Module not found**
- Run `npm install` in backend directory
- Check `package.json` has all dependencies

### Frontend Issues

**CORS Errors**
- Make sure backend is running
- Check `FRONTEND_URL` in backend `.env` matches frontend URL
- Backend should allow CORS from frontend origin

**Images Not Loading**
- Check image paths are correct
- Verify images exist in `images/` folder
- Check browser console for 404 errors

**JavaScript Errors**
- Open browser console (F12)
- Check for error messages
- Verify all script files are loaded
- Check network tab for failed requests

### Database Issues

**Tables don't exist**
- Run schema: `mysql -u root -p hmherbs < database/schema.sql`
- Check database name matches `.env` file

**No data showing**
- Run seed data: `mysql -u root -p hmherbs < database/seed-data.sql`
- Or use admin panel to add products

## 📝 Testing Script

Run the automated test script:

```bash
node test-site.js
```

This will check:
- ✅ All required files exist
- ✅ Dependencies are installed
- ✅ Database connection
- ✅ Backend server responds
- ✅ Frontend files are accessible
- ✅ API endpoints work

## 🎯 Quick Test Commands

```bash
# Test backend is running
curl http://localhost:3001/api/health

# Test products API
curl http://localhost:3001/api/public/products?limit=5

# Test EDSA booking
curl http://localhost:3001/api/edsa/info

# Check database connection
mysql -u root -p -e "USE hmherbs; SHOW TABLES;"
```

## 📚 Additional Resources

- **Admin Guide**: `backend/ADMIN_GUIDE.md`
- **Google Calendar Setup**: `GOOGLE_CALENDAR_SETUP.md`
- **Deployment Guide**: `DEPLOYMENT.md`

## 🆘 Need Help?

If you encounter issues:
1. Check the browser console (F12) for errors
2. Check backend server logs
3. Verify all environment variables are set
4. Ensure database is running and accessible
5. Check that all dependencies are installed

