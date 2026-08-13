# HM Herbs — Linode / Akamai Cloud deployment

Deploy the static storefront + Node API on a **Linode**, with **Managed MySQL** for the database. Use a **NodeBalancer** as the public entry point.

> **Region (required):** Use a **core** region with **private IP + NodeBalancer backends** — e.g. **Miami, FL (`us-mia`)** or **Washington, DC (`us-east`)**.
>
> **Do not use Atlanta** for new HM Herbs stacks: NodeBalancer backends need a private IP or VPC, and Atlanta supports neither. See [deploy/MIAMI-MIGRATION.md](deploy/MIAMI-MIGRATION.md) if you already deployed elsewhere.

## Architecture

```text
Internet → NodeBalancer (80/443) → Linode: Nginx (443)
                                 → static HTML/CSS/JS (repo root)
                                 → /api/* → Node (PM2, port 3001)
                                 → Managed MySQL (SSL, allow list)
```

## 1. Managed MySQL

1. [Akamai Cloud Manager](https://cloud.linode.com/) → **Databases** → **Create Database Cluster**
   - Engine: **MySQL 8**
   - Region: same as your Linode and NodeBalancer
2. Create a database (e.g. `hmherbs`) and an application user with full access on that database.
3. **Manage Access Controls** (allow list): add your Linode’s **public IP** (and your home IP temporarily for first import).
4. From **Connection Details**, note:
   - Host (e.g. `lin-xxxxx-xxxx.servers.linodedb.net`)
   - Port (often **3306** — use the value shown in the panel)
   - Username (default admin is often `akmadmin`; use your app user if you created one)
   - Password, database name
5. Download the **CA certificate** (required for SSL).

## 2. Import the database

From your **local machine** (with the bundle built):

```bash
npm run db:build-staging
```

Copy `deploy/db-connection.env.example` → `deploy/db-connection.env` and fill in Linode MySQL values, then:

```bash
# Windows
.\deploy\import-database.ps1

# Linux / macOS
bash deploy/import-database.sh database/deploy-staging.sql
```

Or from the **Linode** after uploading the file:

```bash
sudo apt install -y mysql-client
mysql -h YOUR_DB_HOST -P 3306 -u YOUR_USER -p --ssl-mode=REQUIRED hmherbs < /tmp/deploy-staging.sql
```

See `database/DEPLOY-DATABASE.md` for bundle contents and rebuild steps.

## 3. Linode (app server)

1. **Create Linode** — Ubuntu 22.04 LTS, **2 GB RAM**, region **Miami, FL** (or another core region — not Atlanta).
2. **Private IP** — Linode → Network → **Add IP Address → Private IPv4** (required for NodeBalancer backend).
3. **NodeBalancer** (same region as Linode):
   - **No VPC** in Miami unless you deliberately use VPC backends
   - Backend node = Linode **private IPv4** on port **80** (not public IP — the UI dropdown only lists private IPs)
   - Health check: HTTP on `/api/health`
3. **DNS** — Point your domain **A record** to the **NodeBalancer** IP (not the Linode IP directly).
4. SSH in and install dependencies:

```bash
sudo apt update && sudo apt install -y nginx git certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

5. Clone the repo (or deploy via `rsync` / GitHub Actions):

```bash
cd /var/www
sudo git clone YOUR_REPO_URL hmherbs
sudo chown -R $USER:$USER hmherbs
cd hmherbs
npm install
cd backend && npm install && cd ..
```

6. **Environment** — copy `backend/.env.linode.example` → `backend/.env` and fill in:

| Variable | Source |
|----------|--------|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Managed MySQL → Connection Details |
| `DB_SSL=true` | Required for Managed MySQL |
| `DB_SSL_CA_PATH` | Path to downloaded CA `.crt` on the server |
| `FRONTEND_URL`, `STOREFRONT_PUBLIC_URL` | `https://your-domain.com` |
| `JWT_SECRET` | New random hex (see example file) |

7. **SSL CA on server**:

```bash
mkdir -p /var/www/hmherbs/backend/certs
# Upload CA certificate from Cloud Manager into backend/certs/
# Set DB_SSL_CA_PATH=./certs/ca-certificate.crt in .env
```

8. **PM2**:

```bash
cd /var/www/hmherbs
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup
```

9. **Nginx** — copy and edit the site config:

```bash
sudo cp deploy/nginx/hmherbs.conf.example /etc/nginx/sites-available/hmherbs
sudo nano /etc/nginx/sites-available/hmherbs   # set server_name
sudo ln -s /etc/nginx/sites-available/hmherbs /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

10. **HTTPS** (on the Linode; NodeBalancer forwards 443 to this port after cert exists):

```bash
sudo bash deploy/setup-nginx-ssl.sh your-domain.com www.your-domain.com
```

Then add or update the NodeBalancer **443** configuration to forward to the Linode on **443**.

## 4. Verify

```bash
cd /var/www/hmherbs/backend && npm run db:test
curl -s http://127.0.0.1:3001/api/health
curl -s https://your-domain.com/api/products?limit=1
```

Change admin passwords after first deploy.

## 5. Staging / temp domain

Use the same steps with a subdomain (e.g. `staging.hmherbs.com` or `139-177-204-216.sslip.io`). In `backend/.env`:

```bash
STAGING_BLOCK_INDEXING=true
NMI_SANDBOX=1
```

### Google OAuth on temp / production hosts

Sign-in is configured on the server via `GBP_CLIENT_ID` / `GBP_CLIENT_SECRET` (`deploy/sync-linode-env.ps1`). You must also register **Authorized redirect URIs** in Google Cloud Console — see **[deploy/GOOGLE_OAUTH_REDIRECT_URIS.md](deploy/GOOGLE_OAUTH_REDIRECT_URIS.md)** for:

- Temp Linode (`172-238-208-164.sslip.io`) — active underwriting URL until `hmherbs.com` DNS
- Production (`www.hmherbs.com`) — add before DNS cutover
- Optional `go.hmherbs.com` and local dev URLs

Quick check after adding URIs:

```bash
curl -s http://172-238-208-164.sslip.io/api/admin/auth/google/status
# Admin login → Continue with Google → Google account picker (not redirect_uri_mismatch)
```

## 6. Scaling later

- **More traffic on one server**: resize the Linode (vertical scale).
- **Two app servers**: clone the Linode, add both as NodeBalancer **backend nodes** (same Nginx + PM2 setup).
- NodeBalancer does not auto-create Linodes; you add backends when ready.

## Files in this repo

| Path | Purpose |
|------|---------|
| `LINODE_DEPLOY.md` | This guide |
| `LINODE_CHECKLIST.md` | Printable step-by-step checklist |
| `deploy/README.md` | Index of all deploy scripts |
| `database/DEPLOY-DATABASE.md` | SQL import / bundle |
| `database/deploy-staging.sql` | One-file DB import (`npm run deploy:bundle`) |
| `backend/.env.linode.example` | API `.env` template on the server |
| `deploy/db-connection.env.example` | Credentials for import scripts only |
| `deploy/bootstrap-linode.sh` | First-time Linode setup |
| `deploy/setup-nginx-ssl.sh` | Nginx + Let's Encrypt |
| `deploy/import-database.sh` | Import SQL (Linux / Linode) |
| `deploy/import-database.ps1` | Import SQL (Windows) |
| `deploy/upload-to-linode.ps1` | Upload SQL to Linode (Windows) |
| `deploy/nginx/hmherbs.conf.example` | Nginx reverse proxy |
| `deploy/ecosystem.config.cjs` | PM2 process config |

Verify everything is present: `npm run deploy:verify`

## Windows quick path

```powershell
npm run deploy:bundle
copy deploy\db-connection.env.example deploy\db-connection.env
# Edit deploy\db-connection.env with Linode MySQL credentials
.\deploy\import-database.ps1
.\deploy\upload-to-linode.ps1 -LinodeIp YOUR_LINODE_IP -BuildBundle
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `ECONNREFUSED` to DB | Check **Access Controls** allow list; use Managed MySQL host/port from Connection Details, not `localhost` |
| SSL errors | Set `DB_SSL=true` and `DB_SSL_CA_PATH` to the downloaded CA cert |
| 502 on `/api` | `pm2 logs hmherbs-api`; confirm app listens on `PORT=3001` |
| Empty products | DB import failed or `DB_NAME` mismatch; test with `mysql` CLI |
| Site loads by IP but not domain | DNS must point to **NodeBalancer** IP; health check must reach Nginx on the Linode |
| 502 via NodeBalancer only | Confirm backend port in NodeBalancer config matches Nginx (80 or 443) |
