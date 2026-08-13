# Business One Menu System - Setup Guide

This guide will help you set up the menu management system for your Business One website.

## Files Created

1. **Database Migration**: `database/migrations/create_menu_tables.sql`
2. **API Routes**: `backend/routes/menu.js`
3. **Admin Interface**: `menu-admin.html`, `menu-admin.css`, `menu-admin.js`

## Setup Steps

### 1. Run Database Migration

Execute the SQL migration to create the necessary tables:

```bash
# Option 1: Using MySQL command line
mysql -u your_username -p your_database < database/migrations/create_menu_tables.sql

# Option 2: Using mysql CLI or MySQL Workbench
# Open the SQL file and execute it in your database
```

This will create:
- `menu_api_keys` table for API key management
- `menu_items` table for menu items
- Insert default Business One services

### 2. Add Menu Routes to Server

The menu routes have been added to `backend/server.js`. The routes are mounted at `/api/menu`.

### 3. Access the Admin Interface

1. Upload `menu-admin.html`, `menu-admin.css`, and `menu-admin.js` to your website root
2. Access it at: `https://businessonecomprehensive.com/menu-admin.html`

Or integrate it into your existing admin system.

## API Endpoints

### Public API (Requires API Key)

- `GET /api/menu/items` - Get all menu items
  - Header: `X-API-Key: your_api_key`
  - Query: `?category=pos` (optional)

- `GET /api/menu` - Get menu structure with categories
  - Header: `X-API-Key: your_api_key`

### Admin API (No authentication - add your own!)

- `GET /api/menu/admin/items` - Get all menu items for admin
- `POST /api/menu/admin/items` - Create menu item
- `PUT /api/menu/admin/items/:id` - Update menu item
- `DELETE /api/menu/admin/items/:id` - Delete menu item

- `GET /api/menu/admin/keys` - Get all API keys
- `POST /api/menu/admin/keys` - Generate new API key
- `PUT /api/menu/admin/keys/:id` - Update API key (activate/deactivate)
- `DELETE /api/menu/admin/keys/:id` - Delete API key

## Security Note

⚠️ **Important**: The admin routes currently have no authentication. You should add authentication middleware before deploying to production. You can use your existing admin authentication system.

Example:
```javascript
// In backend/routes/menu.js, add authentication middleware
const { authenticateAdmin } = require('../middleware/auth'); // Your auth middleware

router.get('/admin/items', authenticateAdmin, async (req, res) => {
    // ... existing code
});
```

## Using the Admin Interface

### Managing Menu Items

1. Click "Menu Items" tab
2. Click "+ Add Menu Item" to create new items
3. Fill in the form:
   - **Item ID**: Unique identifier (e.g., "pos", "payment")
   - **Name**: Display name
   - **Description**: Full description
   - **Category**: Category name (e.g., "pos", "payment", "phone", "website")
   - **Price**: Optional price
   - **Image URL**: Optional image
   - **Display Order**: Order in list (lower numbers first)
   - **Active**: Enable/disable item

4. Click "Edit" to modify existing items
5. Click "Delete" to remove items

### Managing API Keys

1. Click "API Keys" tab
2. Click "+ Generate API Key"
3. Enter a descriptive name (e.g., "Android App", "Website Integration")
4. Copy the generated API key immediately (you won't see it again!)
5. Use this API key in your Android app configuration

## Testing the API

You can test the API using curl:

```bash
# First, generate an API key from the admin interface

# Test getting menu items
curl -H "X-API-Key: your_api_key_here" \
     https://businessonecomprehensive.com/api/menu/items

# Test with category filter
curl -H "X-API-Key: your_api_key_here" \
     https://businessonecomprehensive.com/api/menu/items?category=pos
```

## Android App Configuration

1. Open your Android app
2. Go to Settings
3. Click "Configure API Key"
4. Enter:
   - **API Key**: The key you generated from the admin interface
   - **API URL**: `https://businessonecomprehensive.com`
5. Click "Save"

The app will now fetch menu data from your website!

## Default Menu Items

The migration includes default Business One services:
- Point of Sale (POS)
- Payment Processing
- Phone Service
- Website Development

You can edit or delete these as needed.

## Troubleshooting

### API Returns 401 Unauthorized
- Check that the API key is correct
- Verify the API key is active in the admin interface
- Ensure the `X-API-Key` header is being sent

### Menu Items Not Showing
- Check that items are marked as "Active"
- Verify the database connection
- Check server logs for errors

### Admin Interface Not Loading
- Verify all three files are uploaded (HTML, CSS, JS)
- Check browser console for JavaScript errors
- Ensure the API base URL is correct in `menu-admin.js`

## Support

For issues or questions:
- Email: info@businessonecomprehensive.com
- Phone: (850) 290-2084

