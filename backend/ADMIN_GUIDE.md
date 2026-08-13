# HM Herbs Admin Panel & Import Tools Guide

Complete guide for managing your 10,000+ product catalog, orders, customers, and EDSA bookings.

## 🚀 Quick Start

### 1. Setup Backend
```bash
cd backend
npm install
cp .env.example .env
# Configure your database settings in .env
npm run migrate
npm run seed
npm start
```

### 2. Admin Login
- **Default Admin**: hmherbs1@gmail.com
- **Password**: Use the hashed password from seed data or create new admin
- **Login URL**: `POST /api/admin/auth/login`

## 📊 Admin Panel Features

### Dashboard Statistics
- **Products**: Total, active, featured, low stock counts
- **Orders**: 30-day order stats and revenue
- **Users**: Total users and new registrations
- **EDSA Bookings**: Booking statistics and pending appointments

**Endpoint**: `GET /api/admin/dashboard/stats`

### Product Management
- **List Products**: Paginated with search, brand, category, status filters
- **Create Product**: Add new products with health categories, images, variants
- **Update Product**: Modify existing product details
- **Delete Product**: Remove products (admin+ permission required)

**Endpoints**:
- `GET /api/admin/products` - List products
- `POST /api/admin/products` - Create product
- `PUT /api/admin/products/:id` - Update product
- `DELETE /api/admin/products/:id` - Delete product

### Order Management
- **View Orders**: List all orders with filtering by status
- **Order Details**: Complete order information with line items
- **Status Updates**: Update order and fulfillment status

**Endpoints**:
- `GET /api/admin/orders` - List orders
- `PUT /api/admin/orders/:id` - Update order status

### EDSA Booking Management
- **View Bookings**: List all EDSA appointments
- **Confirm Bookings**: Set confirmed date/time
- **Update Status**: Change booking status (pending, confirmed, completed, cancelled)
- **Admin Notes**: Add internal notes to bookings

**Endpoints**:
- `GET /api/admin/edsa/bookings` - List bookings
- `PUT /api/admin/edsa/bookings/:id` - Update booking

### System Settings
- **View Settings**: All system configuration
- **Update Settings**: Modify EDSA pricing, shipping thresholds, tax rates

**Endpoints**:
- `GET /api/admin/settings` - View settings
- `PUT /api/admin/settings` - Update settings

## 📥 Product Import System

### CSV Import Tool

Import thousands of products from CSV files with full support for:
- Product details (SKU, name, description, pricing)
- Brand and category assignment
- Health condition categorization
- Product variants and images
- Inventory management

### Usage

```bash
# Import products from CSV
node scripts/import-products.js ./data/your-products.csv

# Example with sample data
node scripts/import-products.js ./data/product-import-template.csv
```

### CSV Format

The import tool supports flexible CSV column mapping. Use these column headers:

#### Required Columns
- `sku` or `SKU` or `Product Code` - Unique product identifier
- `name` or `Name` or `Product Name` - Product name
- `price` or `Price` - Product price
- `brand` or `Brand` - Brand name
- `category` or `Category` - Product category

#### Optional Columns
- `short_description` or `Short Description` - Brief product description
- `description` or `Description` or `Long Description` - Detailed description
- `compare_price` or `Compare Price` or `msrp` - Compare at price
- `weight` or `Weight` - Product weight
- `inventory` or `Inventory` or `stock` - Stock quantity
- `health_categories` or `Health Categories` - Comma-separated health conditions
- `images` or `Images` or `image_url` - Comma-separated image URLs
- `variants` or `Variants` - JSON array of product variants
- `active` or `Active` - Product active status (true/false)
- `featured` or `Featured` - Featured product status (true/false)

### Sample CSV Row
```csv
sku,name,brand,category,price,health_categories,images
TN-CURA-375,Terry Naturally Cura Med 375mg,Terry Naturally,Herbs & Botanicals,69.95,"Joint & Arthritis,Anti-Aging",https://example.com/image.jpg
```

### Health Categories
Products can be assigned to multiple health categories:
- Blood Pressure
- Heart Health  
- Allergies
- Digestive Health
- Joint & Arthritis
- Immune Support
- Stress & Anxiety
- Sleep Support
- Energy & Vitality
- Brain Health
- Women's Health
- Men's Health
- Pet Health
- Weight Management
- Skin Health
- Eye Health
- Liver Support
- Respiratory Health
- Bone Health
- Anti-Aging

### Product Variants
For products with multiple sizes or options, use JSON format:
```json
[
  {"sku": "PROD-1OZ", "name": "1oz Bottle", "price": 19.99},
  {"sku": "PROD-2OZ", "name": "2oz Bottle", "price": 34.99}
]
```

### Import Features
- **Automatic Brand/Category Creation**: Creates brands and categories if they don't exist
- **Duplicate Handling**: Updates existing products based on SKU
- **Health Category Mapping**: Automatically assigns products to health conditions
- **Image Processing**: Supports multiple product images
- **Variant Support**: Handles product variants with separate pricing
- **Error Handling**: Detailed error reporting and rollback on failures
- **Progress Tracking**: Shows import progress for large datasets

### Import Statistics
After import completion, you'll see:
```
=== IMPORT SUMMARY ===
Total products processed: 10,247
Successfully imported: 10,198
Errors: 49
Skipped: 0
======================
```

## 🔐 Admin Permissions

### Role Hierarchy
1. **Staff** - View only access
2. **Manager** - Can create/edit products and manage orders
3. **Admin** - Full access except super admin functions
4. **Super Admin** - Complete system access

### Permission Requirements
- **Product Creation**: Manager+
- **Product Deletion**: Admin+
- **System Settings**: Admin+
- **User Management**: Super Admin

## 🛠️ Advanced Features

### Bulk Operations
- **Bulk Product Updates**: Update multiple products at once
- **Bulk Status Changes**: Activate/deactivate multiple products
- **Bulk Category Assignment**: Assign products to health categories

### Data Export
- **Product Export**: Export product catalog to CSV
- **Order Export**: Export order data for accounting
- **Customer Export**: Export customer data (with privacy compliance)

### Inventory Management
- **Low Stock Alerts**: Automatic notifications for low inventory
- **Inventory Tracking**: Real-time stock level updates
- **Reorder Points**: Set automatic reorder thresholds

### EDSA Service Management
- **Appointment Calendar**: Visual calendar for EDSA bookings
- **Availability Management**: Set available time slots
- **Customer Communication**: Automated booking confirmations
- **Service Pricing**: Configurable pricing ($75 default)

## 📈 Reporting & Analytics

### Sales Reports
- **Revenue Tracking**: Daily, weekly, monthly revenue
- **Product Performance**: Best-selling products
- **Category Analysis**: Sales by health condition

### Customer Analytics
- **Registration Trends**: New customer acquisition
- **Order Patterns**: Customer buying behavior
- **Geographic Distribution**: Customer location analysis

### EDSA Service Reports
- **Booking Trends**: EDSA appointment patterns
- **Service Revenue**: EDSA service income tracking
- **Customer Satisfaction**: Booking completion rates

## 🔧 Technical Details

### Database Optimization
- **Indexing**: Optimized for 10,000+ products
- **Connection Pooling**: Efficient database connections
- **Query Optimization**: Fast search and filtering

### Security Features
- **JWT Authentication**: Secure admin sessions
- **Role-Based Access**: Granular permission control
- **Input Validation**: Comprehensive data validation
- **SQL Injection Prevention**: Parameterized queries

### Performance
- **Pagination**: Efficient large dataset handling
- **Caching**: Optimized for frequent queries
- **Bulk Operations**: Efficient mass data processing

## 🚨 Troubleshooting

### Common Import Issues
1. **CSV Format Errors**: Ensure proper column headers
2. **Duplicate SKUs**: Check for existing products
3. **Invalid Health Categories**: Use exact category names
4. **Image URL Issues**: Verify image accessibility

### Admin Panel Issues
1. **Authentication Errors**: Check JWT token validity
2. **Permission Denied**: Verify admin role permissions
3. **Database Errors**: Check database connection

### Performance Issues
1. **Slow Imports**: Process in smaller batches
2. **Memory Issues**: Increase Node.js memory limit
3. **Database Timeouts**: Optimize query performance

## 📞 Support

For technical support with the admin panel or import tools:
1. Check error logs in the console
2. Verify database connectivity
3. Ensure proper environment configuration
4. Review API endpoint documentation

---

**Built for Scale and Efficiency**

This admin system is designed to handle HM Herbs' complete 10,000+ product catalog with professional-grade tools for inventory management, order processing, and EDSA service coordination.
