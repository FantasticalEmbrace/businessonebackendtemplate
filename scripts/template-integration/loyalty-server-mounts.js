// Copy into your Express server (requires authenticateToken middleware)

// GET /api/user/loyalty — customer loyalty profile + last 25 transactions

// On user registration / login / OAuth:
// const { provisionWebCustomerProfile } = require('./utils/provisionCustomerProfile');
// await provisionWebCustomerProfile(pool, userId);

// Admin routes (in admin-customers router):
// POST /api/admin/customers/:id/loyalty/adjust — manual point adjustment
// GET /api/admin/customers/stats — includes loyalty_members, total_points_outstanding

// Optional POS sync (admin.js):
// GET /api/admin/pos/loyalty/programs
// POST /api/admin/pos/systems/:id/sync-loyalty
// GET /api/admin/pos/loyalty/customers
// GET /api/admin/pos/loyalty/analytics
