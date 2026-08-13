# Linode / Akamai deployment checklist

Print or copy this list and check off as you go.

## A. Akamai Cloud Manager

- [ ] Create **Managed MySQL** cluster (MySQL 8, same region as Linode)
- [ ] Create database `hmherbs` (or your chosen name)
- [ ] Create DB user with full privileges on that database
- [ ] Download **CA certificate** from cluster → Connection Details
- [ ] Note: host, port (often `3306`), username, password, database name
- [ ] Create **Linode** (Ubuntu 22.04, 2 GB RAM recommended)
- [ ] Create **NodeBalancer** (same region); note its public IP
- [ ] Add Linode as NodeBalancer **backend** (port 80; add 443 after SSL)
- [ ] Add SSH key to Linode
- [ ] Point domain **A record** to **NodeBalancer** IP (not Linode IP)

## B. Local machine

- [ ] Run `npm run db:build-staging` → confirms `database/deploy-staging.sql` exists
- [ ] Copy `backend/.env.linode.example` values you will use on the server
- [ ] Generate production `JWT_SECRET`:  
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## C. Database import

- [ ] Add your IP (and Linode public IP) to MySQL **Access Controls**
- [ ] Import SQL:
  - Windows: `deploy/import-database.ps1` (see script header), or
  - Linode: `bash deploy/import-database.sh /tmp/deploy-staging.sql`
- [ ] Confirm tables exist (e.g. `products` has rows)

## D. Linode setup

- [ ] SSH into Linode: `ssh root@YOUR_LINODE_IP`
- [ ] Run bootstrap:  
  `export REPO_URL=YOUR_GIT_URL`  
  `sudo bash deploy/bootstrap-linode.sh`
- [ ] Upload CA cert to `backend/certs/ca-certificate.crt`
- [ ] Create `backend/.env` from `.env.linode.example` (fill all values)
- [ ] `pm2 restart hmherbs-api` and `pm2 logs hmherbs-api` (no DB errors)

## E. Nginx + HTTPS

- [ ] Edit `server_name` in `/etc/nginx/sites-available/hmherbs`
- [ ] Run `sudo bash deploy/setup-nginx-ssl.sh your-domain.com`
- [ ] Update NodeBalancer to forward **443** → Linode **443**
- [ ] Visit `https://your-domain.com` — homepage loads
- [ ] Visit `https://your-domain.com/api/products?limit=1` — JSON returns

## F. Security & launch

- [ ] Change **admin passwords** (DB had dev hashes from backup)
- [ ] Set real NMI keys (or keep `NMI_SANDBOX=1` on staging)
- [ ] Staging only: `STAGING_BLOCK_INDEXING=true` in `.env`
- [ ] Remove temporary **Access Controls** entries (your home IP) if no longer needed
- [ ] `pm2 save` and confirm `pm2 startup` ran

## Done

- [ ] Store production `.env` only on the server (never commit)
- [ ] Bookmark [LINODE_DEPLOY.md](./LINODE_DEPLOY.md) for updates
