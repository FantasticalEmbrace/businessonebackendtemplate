# Gift Card Template

Standalone backup of the Your Store web gift card system, extracted from [hmherbs-main](../hmherbs-main).

**Backed up:** June 12, 2026

## What’s included

### Database
- `database/migrations/001_gift_cards_schema.sql` — `gift_cards`, `gift_card_transactions`, `pos_gift_cards`
- `database/migrations/20260604_gift_card_purchase.sql` — `products.gift_card_type`, `order_items.metadata`

### Backend
| File | Purpose |
|------|---------|
| `routes/gift-cards.js` | Public catalog API |
| `routes/admin-gift-cards.js` | Admin CRUD, issue, bulk register, adjust, redeem |
| `services/giftCardCheckout.js` | Redeem gift card as checkout payment |
| `services/giftCardFulfillment.js` | Issue cards after purchase, validate cart |
| `services/giftCardDeliveryEmail.js` | Recipient & purchaser emails |
| `services/giftCardRecipientAccount.js` | Create/find recipient accounts |
| `services/pos-giftcard.js` | POS gift card sync (Square/Shopify/Lightspeed) |
| `utils/giftCardCodes.js` | Code/PIN generation |
| `utils/ensureGiftCardCatalog.js` | Seed gift card products on startup |
| `utils/ensureGiftCardPurchaseSchema.js` | Schema bootstrap |

### Frontend
- `frontend/gift-cards.html` + `css/gift-cards.css` + `js/gift-cards.js` — purchase page
- `frontend/checkout.html` + `js/checkout.js` — gift card payment at checkout
- `frontend/account.html` + `js/account.js` — customer gift card list & balance lookup

### Admin
- `admin/admin.html` — Gift Cards section UI
- `admin/admin-customers.js` — gift card admin module (also contains customer/loyalty code)
- `admin/admin-app.js` — nav routing to gift cards section

### Integration references
- `integration/server-mounts.js` — Express route wiring
- `backend/routes/orders.js` — checkout order creation with gift cards
- `backend/services/finalizePaidOrder.js` — post-payment card issuance

## Architecture

Two parallel layers:

1. **Web gift cards** (`gift_cards` table) — purchase, issue, redeem, admin management
2. **POS gift cards** (`pos_gift_cards` table) — synced from external POS

### End-to-end flow

```
gift-cards.html → cart (recipient metadata) → checkout.js
  → orders.js (validate + create order) → payment
  → finalizePaidOrder.js → giftCardFulfillment.js (issue + email)

OR checkout with paymentMethod: 'gift_card'
  → giftCardCheckout.js (redeem balance)
```

## Integration checklist

1. Run `database/migrations/001_gift_cards_schema.sql` then `20260604_gift_card_purchase.sql`
2. Copy backend files into your project’s `backend/` tree
3. Wire routes per `integration/server-mounts.js`
4. Call `ensureGiftCardPurchaseSchema` and `ensureGiftCardCatalog` on startup
5. Hook `validateGiftCardCartItems` and `giftCardCheckout` into your orders route
6. Hook `fulfillGiftCardsForOrder` into post-payment finalization
7. Add admin nav link + Gift Cards section from `admin/admin.html`
8. Link to `gift-cards.html` from your products/nav pages

## API reference

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/gift-cards/catalog` | Public | Digital/physical denominations |
| `POST /api/gift-cards/check-balance` | Public | Balance by code + PIN |
| `GET /api/user/gift-cards` | Customer | Cards assigned to user |
| `GET /api/admin/gift-cards` | Admin | List/search all cards |
| `POST /api/admin/gift-cards/issue` | Admin | Issue digital card |
| `POST /api/admin/gift-cards/bulk-register` | Admin | Register physical cards |

## Dependencies

Requires existing tables: `users`, `products`, `product_variants`, `orders`, `order_items`, `categories`. Email service for delivery notifications.

## Source project

Extracted from `hmherbs-main` — Your Store e-commerce platform.
