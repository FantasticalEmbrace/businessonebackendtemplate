# Hosting

Local first. Production only when you ask.

## Architecture (Merchant Accounts)

| Piece | Role |
|-------|------|
| **Merchant Accounts** (`business-one-merchant-accounts`) | Creates accounts + private MySQL DB per merchant; website keys; device-key directory |
| **This repo (shared POS backend)** | One Node API; `MERCHANT_ACCOUNTS_ENABLED=true` routes each request to that merchant’s private DB |
| **Website** | Separate process / Linode; calls shared POS API with `X-Website-Api-Key` only |
| **POS app** | `business-one-pos`; store URL = shared POS API; device key registered in Merchant Accounts |
| Marketing / Ops Admin | SiteGround + `business-one-backend` | Billing / signup; not merchant store data |

See `../business-one-merchant-accounts/README.md`.

## Local Merchant Accounts

```env
MERCHANT_ACCOUNTS_ENABLED=true
MERCHANT_ACCOUNTS_ORIGIN=http://127.0.0.1:3015
```

## Intended production placement

| Piece | Host | Notes |
|-------|------|--------|
| Marketing site | SiteGround | Unchanged |
| Merchant Accounts + shared POS API + MySQL | Linode | Private DB per Merchant Account |
| Merchant websites | Separate Linode each (or shared static host) | Talk to shared POS API with website key |
| Asterisk / PBX | Linode (or same VPS) | Siptrunk for PSTN |
| Ops Admin | Marketing + `business-one-backend` | Staff login for lines / MAC / milestones |

## GAPS / MAC provisioning checklist (later)

When handsets should zero-touch provision in production:

1. Register MAC on the merchant in Ops Admin or PBX **Lines & devices**.
2. Point Grandstream (or GAPS redirect) config server to  
   `https://<pbx-host>/provision/<MAC>.xml`  
   (local stub already serves XML from `GET /provision/:mac`).
3. Ensure `PROVISION_SIP_HOST` on the PBX points at the reachable SIP host (not `127.0.0.1` in prod).
4. Confirm Siptrunk credentials and line qty ($75 × concurrent channels) before go-live.
5. Link POS `pbxOrigin` / `pbxMerchantId` / `pbxPosToken` for caller-ID → customer.

## Explicit non-goals right now

- No deploy of this template
- No GAPS automation beyond the local provision XML stub
- No assumption that every merchant has a public storefront
