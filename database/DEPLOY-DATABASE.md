# Database deploy (Linode Managed MySQL)

## Build the import bundle

```bash
npm run db:build-staging
```

Output: **`database/deploy-staging.sql`** (~0.3 MB) — backup + migrations in one file.

## Import from your computer

1. In Cloud Manager → **Databases** → your cluster → **Manage Access Controls** → add your **public IP** (temporary).
2. Install MySQL client locally if needed.
3. Copy `deploy/db-connection.env.example` → `deploy/db-connection.env` and fill in values.
4. Run:

```bash
# Windows
.\deploy\import-database.ps1

# Linux / macOS
bash deploy/import-database.sh database/deploy-staging.sql
```

Or manually:

```bash
mysql -h lin-xxxxx-xxxx.servers.linodedb.net \
  -P 3306 \
  -u akmadmin \
  -p \
  --ssl-mode=REQUIRED \
  hmherbs < database/deploy-staging.sql
```

Use the host, port, user, and database name from Connection Details.

## Import from a Linode (recommended for production)

1. Add the Linode’s public IP to the database **allow list**.
2. Upload the SQL file:

```bash
scp database/deploy-staging.sql user@YOUR_LINODE_IP:/tmp/
```

3. On the Linode:

```bash
bash deploy/import-database.sh /tmp/deploy-staging.sql
```

Or set env vars and run the script (see script header).

## After import

1. Point `backend/.env` at the cluster (`DB_HOST`, `DB_PORT`, `DB_SSL=true`, CA cert path).
2. Restart the API (`pm2 restart hmherbs-api`).
3. Rotate admin passwords.

## Rebuild when catalog changes

1. Export fresh data from local MySQL into `database/` (new `hmherbs_backup_*.sql`).
2. Update the backup path in `database/build-deploy-bundle.js`.
3. Run `npm run db:build-staging` again and re-import.
