# Business One merchant platform (local template)

Local-only copy of the merchant stack for **admin + POS**. There is **no public website face by default**.

**Do not deploy** this template until you explicitly decide to. Do not edit `hmherbs-main` — this folder is the Business One fork.

## Branding

Admin chrome and default tokens follow **Business One** (`businessonecomprehensive.com`): orange `#ff9b1f`, slate/navy sidebar — **not** HM Herbs green. See `css/brand-tokens.css` and `data/branding.json`.

Remote support for technicians is on **Business One ops admin** (marketing site), not this merchant admin.

## Default product

| Included | Optional later |
|----------|----------------|
| Backend / admin (inventory, customers, loyalty, gift cards, personnel, settings) | Public storefront (`FEATURE_WEBSITE=true`) |
| POS (day-to-day face at the register) | Full website brand pack |
| Simple Phone settings (hours, voicemail, hold music → local PBX) | |

Website nav items stay greyed with “Not on your plan — add a website build” until `websiteEnabled` is on.

## Local stack

| Service | Typical URL |
|---------|-------------|
| This merchant API + static admin | `http://127.0.0.1:3011` |
| Business One Phone (PBX) | `http://127.0.0.1:3040` |
| Ops Admin (marketing site) | `http://localhost:8080` + `business-one-backend` `:3002` |
| POS app | sibling `business-one-pos` |

## Quick start

1. Copy env: `copy .env.example backend\.env` (Windows) and set MySQL `DB_*` for a **separate** database (not HM Herbs).
2. From `backend/`: `npm install` then `npm run dev` (or whatever script starts `server.js` on port **3011**).
3. Open admin at `http://127.0.0.1:3011/admin.html`.
4. Optional phones: run `business-one-pbx`, set `PBX_MERCHANT_ID` in `.env` to the merchant id from Phone admin.
5. Branding: **Store branding** in admin updates POS/receipt/admin chrome. Storefront theme APIs stay locked while `FEATURE_WEBSITE=false`.
6. Set **Point of Sale → Registers → Store website address** so device keys and Business One ops remote support resolve correctly.

## Feature flags (`.env`)

```
FEATURE_WEBSITE=false   # default — no storefront face
FEATURE_PHONES=true
FEATURE_LOYALTY=true
FEATURE_GIFT_CARDS=true
```

## Ops vs client phone

| Who | Where | What |
|-----|--------|------|
| You (ops) | Marketing Ops Admin + PBX Phone admin | Siptrunk, **$75/line** qty, MAC devices, `/provision/<MAC>.xml` |
| Merchant | This admin → Phone | Hours, voicemail greeting, hold music — works **without** a website |

## Related repos (siblings)

- `business-one-pbx` — local PBX / softphone / provision
- `business-one-backend` — ops API (proxies lines & devices)
- `business-one-webpage` — marketing + ops Admin UI
- `business-one-pos` — register UI

See [HOSTING.md](./HOSTING.md) for **later** production placement (not this phase).
