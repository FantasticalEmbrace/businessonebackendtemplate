# Local development (keeps working after GitHub sync)

This repo is **`https://github.com/FantasticalEmbrace/HMHerbs`**. Production deploys use Miami Linode; your PC is for day-to-day testing.

## What stays on your machine only (never committed)

| File | Purpose |
|------|---------|
| `backend/.env` | Local DB, JWT, NMI, SMTP, Google OAuth |
| `deploy/db-connection.env` | Miami managed MySQL credentials |
| `deploy/hmherbs-miami-ca-certificate.crt` | DB SSL CA |

These are listed in `.gitignore`. Pulling or pushing from GitHub does **not** overwrite them.

## After `git pull` on your PC

```powershell
cd "C:\Users\donal\Desktop\Web SItes\hmherbs-main"
npm install
cd backend
npm install
```

Run new migrations against your local or Miami DB:

```powershell
cd backend
node scripts/run-migration.js ../database/migrations/20260701_pos_auto_promotions.sql
node scripts/run-migration.js ../database/migrations/20260702_pos_employee_allow_manual_discounts.sql
```

Start the site locally:

```powershell
cd backend
npm run dev
```

Open http://127.0.0.1:3001 — uses **`backend/.env`**, not production.

Copy from `backend/.env.example` if you need new env keys after an update.

## POS register (separate platform — not on HM Herbs)

The register UI lives in **`https://github.com/FantasticalEmbrace/business-one-pos`**. Production host:

**`https://pos.businessonecomprehensive.com`** — its own Linode + domain.

Each merchant opens that site, enters **their store URL** (e.g. `https://www.hmherbs.com`) and **device key**. HM Herbs only runs the **POS API** (`/api/pos/v1`), not the register UI.

Deploy POS platform: `../business-one-pos/deploy/sync-pos-linode.ps1`

Local dev: `npm run serve` in `business-one-pos`, or set `SERVE_POS_UI=true` on the store backend to mount `/pos/` locally.

## Deploy to Miami (optional)

From repo root:

```powershell
.\deploy\sync-full-linode.ps1
```

Server keeps its own `backend/.env`; the tarball excludes `.env` and `deploy/db-connection.env`.
