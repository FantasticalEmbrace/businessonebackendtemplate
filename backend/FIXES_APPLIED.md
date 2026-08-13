# Fixes Applied for ERR_CONNECTION_REFUSED Issue

## Root Cause
The server was crashing due to `logger.logError()` method calls, which don't exist in the Winston logger. When the admin login route was hit, it would crash the server, causing subsequent requests to fail with `ERR_CONNECTION_REFUSED`.

## Fixes Applied

### 1. Fixed `logger.logError()` Calls in `backend/routes/admin.js`
   - **Line 147**: Changed `logger.logError('Admin login error', error, {...})` → `logger.error('Admin login error:', error)`
   - **Line 233**: Changed `logger.logError('Forgot password error', error)` → `logger.error('Forgot password error:', error)`
   - **Line 278**: Changed `logger.logError('Reset password error', error)` → `logger.error('Reset password error:', error)`
   - **Line 330**: Changed `logger.logError('Dashboard stats error', error)` → `logger.error('Dashboard stats error:', error)`

### 2. Fixed Database Pool Access in `backend/routes/public.js`
   - **Line 12**: Removed incorrect `req.app.locals.pool` access
   - Added proper check for `req.pool` which is set by server.js middleware
   - Added error handling if pool is not available

### 3. Fixed Database Pool Access in `backend/routes/payment-cards.js`
   - **Line 13**: Removed incorrect fallback to `req.app.locals.pool`
   - **Line 34**: Removed incorrect fallback to `req.app.locals.pool`
   - Now uses `req.pool` directly (set by server.js middleware)

## Testing
After these fixes, the server should:
1. Start without errors
2. Handle admin login requests without crashing
3. Properly log errors using the correct logger methods
4. Access database pool correctly in all routes

## Next Steps
1. Restart the backend server: `cd backend && npm start`
2. Test admin login at: `http://localhost:3001/admin.html`
3. Verify no errors in server console

