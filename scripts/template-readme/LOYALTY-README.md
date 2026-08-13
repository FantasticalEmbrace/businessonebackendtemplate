# Loyalty Program Template

Standalone backup of the H&M Herbs customer loyalty / rewards system, extracted from [hmherbs-main](../hmherbs-main).

**Backed up:** June 12, 2026

## What’s included

### Database
- `database/migrations/001_loyalty_schema.sql` — `customer_loyalty`, `loyalty_transactions`, POS sync tables

### Backend
| File | Purpose |
|------|---------|
| `routes/admin-customers.js` | Admin customer API incl. loyalty adjust, stats, profile |
| `services/pos-loyalty.js` | POS loyalty sync (Square/Shopify/Lightspeed) |
| `utils/provisionCustomerProfile.js` | Auto-create loyalty row on signup/login |
| `services/analytics.js` | Dashboard metrics for loyalty |

### Frontend
- `frontend/account.html` + `js/account.js` — Rewards section (points, tier, history)

### Admin
- `admin/admin.html` — loyalty dashboard stats + customer profile shell
- `admin/admin-customers.js` — loyalty tab, manual adjust, transaction history

### Integration references
- `integration/server-mounts.js` — Express route wiring
- `backend/routes/admin-pos-loyalty.snippet.js` — POS loyalty admin endpoints

## Architecture

Two parallel layers:

1. **Web loyalty** (`customer_loyalty` + `loyalty_transactions`) — per-user points on the website
2. **POS loyalty** (`pos_loyalty_programs` + `pos_customer_loyalty`) — synced from external POS

### End-to-end flow

```
User registers/logs in → provisionCustomerProfile → customer_loyalty row created
Customer visits account → GET /api/user/loyalty → points/tier/history displayed
Admin adjusts points → POST /api/admin/customers/:id/loyalty/adjust → ledger entry
Optional: POS sync → pos-loyalty.js → pos_* tables updated
```

## Integration checklist

1. Run `database/migrations/001_loyalty_schema.sql`
2. Copy backend files into your project’s `backend/` tree
3. Add `GET /api/user/loyalty` route (see `integration/server-mounts.js`)
4. Call `provisionWebCustomerProfile(pool, userId)` on register/login/OAuth
5. Mount admin-customers router at `/api/admin/customers`
6. Add Rewards section to account page from `frontend/account.html`
7. Wire loyalty stats in admin dashboard (`#statLoyaltyMembers`, `#statLoyaltyPoints`)
8. Optional: mount POS loyalty routes from `admin-pos-loyalty.snippet.js`

## API reference

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/user/loyalty` | Customer | Profile + last 25 transactions |
| `POST /api/admin/customers/:id/loyalty/adjust` | Admin | Manual point adjustment |
| `GET /api/admin/customers/stats` | Admin | `loyalty_members`, `total_points_outstanding` |
| `GET /api/admin/pos/loyalty/programs` | Admin | POS program list |
| `POST /api/admin/pos/systems/:id/sync-loyalty` | Admin | Trigger POS sync |

## Transaction types

`earn`, `redeem`, `adjust`, `expire`, `refund`, `signup_bonus`, `referral_bonus`, `birthday_bonus`

## Dependencies

Requires existing `users` table. Admin auth middleware for admin routes. Optional POS integration for sync features.

## Source project

Extracted from `hmherbs-main` — H&M Herbs e-commerce platform.
