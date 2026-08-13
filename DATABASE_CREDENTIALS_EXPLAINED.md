# Database credentials explained

Local development and Linode production use **separate** databases. Values in `backend/.env` must match the database you are connecting to.

## Local MySQL (development)

| Variable | Typical value |
|----------|----------------|
| `DB_HOST` | `localhost` |
| `DB_PORT` | `3306` |
| `DB_USER` | `root` (or your local user) |
| `DB_PASSWORD` | your local password |
| `DB_NAME` | `hmherbs` |
| `DB_SSL` | omit or `false` |

## Linode Managed MySQL (production / staging)

Copy **[backend/.env.linode.example](./backend/.env.linode.example)** and fill in values from:

**Cloud Manager → Databases → your cluster → Connection details**

| Variable | Example / notes |
|----------|-----------------|
| `DB_HOST` | `lin-xxxxx-xxxx.servers.linodedb.net` |
| `DB_PORT` | Often `3306` (use panel value) |
| `DB_USER` | `akmadmin` or your app user |
| `DB_PASSWORD` | From Connection details |
| `DB_NAME` | `hmherbs` (database you created) |
| `DB_SSL` | `true` |
| `DB_SSL_CA_PATH` | `./certs/ca-certificate.crt` on the server |

Add your **Linode** (or your IP for one-time import) under **Manage Access Controls** on the database cluster.

## Important

- Local `.env` stays on your machine; production `.env` lives only on the Linode.
- `DB_NAME`, `DB_USER`, and `DB_PASSWORD` must match what you created in Cloud Manager — they do not need to match local names.

See **[LINODE_DEPLOY.md](./LINODE_DEPLOY.md)** for full deployment steps.
