// Copy these routes into your Express server (requires authenticateToken middleware)

// GET /api/user/gift-cards — cards assigned to logged-in customer
// POST /api/gift-cards/check-balance — public balance lookup by code + PIN
// GET /api/gift-cards/catalog — purchasable gift card products
// app.use('/api/gift-cards', require('./routes/gift-cards'));
// app.use('/api/admin/gift-cards', require('./routes/admin-gift-cards'));

const { ensureGiftCardPurchaseSchema } = require('./utils/ensureGiftCardPurchaseSchema');
const { ensureGiftCardCatalog } = require('./utils/ensureGiftCardCatalog');

// On server startup:
// await ensureGiftCardPurchaseSchema(pool);
// await ensureGiftCardCatalog(pool);

// Product listing: exclude gift card products from general catalog
// whereConditions.push('(p.gift_card_type IS NULL)');
