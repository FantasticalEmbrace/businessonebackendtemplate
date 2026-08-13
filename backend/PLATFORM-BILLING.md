# Business One Platform Billing (NMI)

**Business One bills merchants** (you collect revenue). **HM Herbs is a merchant store** — it does not own this billing UI.

| What | Where |
|------|--------|
| **Billing UI** (NMI Collect.js card/ACH) | `business-one-webpage` → `billing-portal.html` / `pos-signup.html` on **businessonecomprehensive.com** |
| **Public signup** | `business-one-webpage/pos-signup.html` |
| **Billing API** | Hub backend — deploy on **signup.businessonecomprehensive.com** Linode |
| **Credentials UI** | Business One Admin → **Payments** (proxies to hub) |
| **HM Herbs admin** | License tab links out to Business One billing |

Form styles use `business-one-webpage/css/platform-billing.css` — **not** HM Herbs admin CSS.

## Payment processors (clarified)

| Flow | Processor |
|------|-----------|
| **Merchants → Business One** (POS fee, hosting, internet, hardware, invoices) | **NMI** (Business One platform MID) |
| **Customers → standard merchant** | **EPI** (merchant’s ISO keys) |
| **Customers → high-risk merchant** | **NMI** (that merchant’s keys — store `NMI_*`) |
| **Customers → MX gateway merchant** | **MX** |

Platform billing uses **`PLATFORM_NMI_*`** (or Admin → Payments). It does **not** use store `NMI_*` / `POS_NMI_*`.

## Environment (`backend/.env` on the **Business One billing hub**)

```env
PLATFORM_NMI_SANDBOX=1
PLATFORM_NMI_PUBLIC_TOKENIZATION_KEY=
PLATFORM_NMI_PRIVATE_API_KEY=
# Optional:
# PLATFORM_NMI_COLLECT_JS_URL=
# PLATFORM_NMI_API_URL=

BILLING_DRY_RUN=true
BILLING_SCHEDULER_ENABLED=false
BILLING_PORTAL_URL=https://businessonecomprehensive.com/billing-portal.html
BUSINESS_ONE_POS_SIGNUP_ENABLED=false
```

Or save the same keys in **Business One Admin → Payments** (stored in hub `settings`).

`GET /api/platform/billing/client-config` and `GET /api/business-one/pos/client-config` return `collectJs.tokenizationKey`, `collectJs.collectJsUrl`, `processor: 'nmi'`, and `achEnabled`.

## Ops admin payment settings

- `GET/PUT /api/platform/billing/payment-settings` (admin JWT or `BO_TAX_OPS_KEY`)
- Proxied from Business One ops: `GET/PUT /api/admin/payment-settings`

## Vault / charge

- Collect.js `payment_token` (card or eCheck) → NMI customer vault → `nmi_customer_vault_id` / `nmi_billing_id` on `billing_accounts`
- Recurring and one-time charges use Direct Post vault sale
- Legacy ProCharge tokens are **not** migrated

## Related frontend

| File | Role |
|------|------|
| `business-one-webpage/js/business-one-nmi-collect.js` | Collect.js mount (card + ACH) |
| `business-one-webpage/js/business-one-collect.js` | Shared Collect.js field styling |
| `business-one-webpage/css/platform-billing.css` | Signup / pay form styling |
