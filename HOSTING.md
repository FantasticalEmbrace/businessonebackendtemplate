# Hosting (later — not this phase)

This merchant template stays **local only** until you ask to go live. Do not push the merchant Node API or Asterisk to Linode as part of the current work.

## Intended placement (when ready)

| Piece | Host | Notes |
|-------|------|--------|
| Marketing site | SiteGround | Unchanged; keep relative links / empty API meta for local dev |
| Merchant Node + MySQL | Linode | One stack per merchant or multi-tenant later |
| Asterisk / PBX | Linode (or same VPS) | Siptrunk for PSTN; provision URLs public |
| Ops Admin | As today (marketing + `business-one-backend`) | Staff login for lines / MAC / milestones |

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
