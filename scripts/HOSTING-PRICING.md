# Business One — four-tier web hosting pricing

Managed hosting for Business One website clients — **informational pages through full e-commerce**. **Month-to-month** — see `scripts/generate_hosting_agreement_pdf.py` in this repo for the fillable agreement PDF.

Website **build** tiers are documented in `business-one-webpage/WEBSITE-BUILD-PRICING.md` (marketing site repo).

POS register fees are **billed separately**.

## Public rates (+$150 per tier step)

| Tier | Plan | Monthly | Traffic / bandwidth (whichever hits first) | Best for |
|------|------|---------|---------------------------------------------|----------|
| **1** | **Essential** | **$150/mo** | Up to 15,000 visits/mo or 40 GB/mo | Informational site, hours, contact, light retail |
| **2** | **Standard** | **$300/mo** | 15,001–50,000 visits or 41–100 GB | Small catalog, basic retail |
| **3** | **Growth** | **$450/mo** | 50,001–150,000 visits or 101–250 GB | Larger catalogs, growing stores |
| **4** | **Enterprise** | **$600/mo** | 150,001+ visits or 251 GB+ | Full e-commerce at high traffic |

Each tier step is **+$150/mo** when sustained traffic exceeds the current band.

## Principal / designated accounts

Custom monthly amounts are set in the **billing backend only** (`backend/services/platformBillingPricing.js`, `monthly_amount_override`) — never on the public signup form.

## Tier change rules

- **Upgrade:** Client exceeds the current tier for **2 consecutive calendar months**.
- **Notice:** Business One gives **30 days** written notice before the new rate applies (+$150/mo per step).
- **Downgrade (optional):** Client stays below a lower tier for **3 consecutive months**.
- **Measurement:** Google Analytics 4 visits **or** Akamai/Linode outbound bandwidth — **whichever is higher**.

## What's included (all tiers)

- Website hosting & server management
- SSL certificate
- Scheduled backups
- Security monitoring
- Technical support during business hours
- Website maintenance (updates & upkeep) per agreement

## Related files

| File | Purpose |
|------|---------|
| `backend/services/platformBillingPricing.js` | Billing source of truth |
| | `scripts/generate_hosting_agreement_pdf.py` | Agreement PDF |
| `business-one-webpage/js/web-build-pricing-tiers.js` | Unified package cards (build + hosting) |
| `business-one-webpage/js/web-hosting-pricing-tiers.js` | Hosting limits + signup tier picker |
