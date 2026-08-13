# How to import the database

This project deploys to **Linode Managed MySQL** (Akamai Cloud), not phpMyAdmin.

1. Build the bundle: `npm run db:build-staging`
2. Import: see **[database/DEPLOY-DATABASE.md](./database/DEPLOY-DATABASE.md)**
3. Configure the API: **[backend/.env.linode.example](./backend/.env.linode.example)**

Full server setup: **[LINODE_DEPLOY.md](./LINODE_DEPLOY.md)**

## Local development

Use local MySQL and `backend/.env` (from `backend/.env.example`).

Then run migrations listed in `database/DEPLOY-DATABASE.md`, or use `deploy-staging.sql` for the full catalog.
