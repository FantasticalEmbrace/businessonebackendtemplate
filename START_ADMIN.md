# 🚀 Quick Start: Admin Panel

## Step 1: Start the Backend Server

Open a terminal/command prompt and run:

```bash
cd backend
npm start
```

You should see:
```
H&M Herbs API Server running on port 3001
Environment: development
Frontend URL: http://localhost:8000
```

## Step 2: Open Admin Panel in Browser

**DO NOT** double-click `admin.html` - instead:

1. Open your web browser
2. Go to: **http://localhost:3001/admin.html**

## Step 3: Login

- **Email:** `hmherbs1@gmail.com`
- **Password:** `admin1`

---

## ⚠️ Common Issues

### "Cannot GET /admin.html"
- Make sure the backend server is running
- Check that you're accessing `http://localhost:3001/admin.html` (not `file://`)

### "Connection refused" or API errors
- Verify backend server is running on port 3001
- Check `backend/.env` file has correct database settings
- Make sure MySQL is running

### Still seeing file:// warnings?
- Close the file:// tab
- Start the backend server
- Open `http://localhost:3001/admin.html` in a new tab

---

## 📝 Alternative: Use a Simple HTTP Server

If you prefer not to run the full backend for testing:

```bash
# Install http-server globally
npm install -g http-server

# From project root, start server
http-server -p 8000 -c-1

# Then access: http://localhost:8000/admin.html
# (But you'll still need backend API on port 3001)
```

