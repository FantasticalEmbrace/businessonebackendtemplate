# Admin Panel Setup Guide

## ⚠️ Important: Admin Panel Must Be Served Through Web Server

The admin panel **cannot** be opened directly by double-clicking the HTML file (`file://` protocol). It must be served through a web server because:

1. **CORS Policy**: Browsers block API requests from `file://` protocol
2. **API Endpoints**: The admin panel needs to communicate with the backend API
3. **Security**: Modern browsers restrict local file access

## 🚀 How to Access the Admin Panel

### Option 1: Use the Backend Server (Recommended)

1. **Start the backend server:**
   ```bash
   cd backend
   npm install  # If not already done
   npm start
   ```

2. **Access the admin panel:**
   Open your browser and go to:
   ```
   http://localhost:3001/admin.html
   ```

The backend server is now configured to serve the admin panel and all frontend files.

### Option 2: Use a Simple HTTP Server

If you prefer not to run the full backend:

1. **Install a simple HTTP server:**
   ```bash
   npm install -g http-server
   ```

2. **Start the server from project root:**
   ```bash
   http-server -p 8000 -c-1
   ```

3. **Access the admin panel:**
   ```
   http://localhost:8000/admin.html
   ```

   **Note:** You'll still need the backend API running on port 3001 for the admin panel to work.

### Option 3: Use Python's Built-in Server

1. **From project root:**
   ```bash
   # Python 3
   python -m http.server 8000
   
   # Python 2
   python -m SimpleHTTPServer 8000
   ```

2. **Access:**
   ```
   http://localhost:8000/admin.html
   ```

## 🔧 Configuration

### Backend Server Port
The backend server runs on port **3001** by default. You can change this in `backend/.env`:
```env
PORT=3001
```

### API Base URL
The admin panel automatically detects the correct API URL:
- If served from `localhost:3001` → Uses `/api` (relative)
- If served from other port → Uses `http://localhost:3001/api`
- If opened via `file://` → Shows warning and uses `http://localhost:3001/api`

## 🐛 Troubleshooting

### Error: "Failed to load resource: net::ERR_FILE_NOT_FOUND"
**Solution:** You're opening the file directly. Use a web server instead.

### Error: "CORS policy blocked"
**Solution:** The admin panel must be served through HTTP, not `file://`.

### Error: "Connection refused"
**Solution:** Make sure the backend server is running on port 3001.

### API calls not working
**Solution:** 
1. Check that backend server is running: `http://localhost:3001/api/health`
2. Check browser console for errors
3. Verify CORS is configured in `backend/server.js`

## ✅ Quick Start Checklist

- [ ] Backend dependencies installed (`cd backend && npm install`)
- [ ] Database configured in `backend/.env`
- [ ] Backend server running (`cd backend && npm start`)
- [ ] Access admin panel at `http://localhost:3001/admin.html`
- [ ] Login with: `hmherbs1@gmail.com` / `admin1`

## 📝 Notes

- The backend server now serves all static files from the project root
- Admin panel is accessible at: `http://localhost:3001/admin.html`
- Main site is accessible at: `http://localhost:3001/index.html`
- All API endpoints are at: `http://localhost:3001/api/*`

