#!/usr/bin/env python3
from pathlib import Path
import secrets

src = Path("/var/www/hmherbs/backend/.env").read_text(encoding="utf-8", errors="ignore")
vals = {}
for line in src.splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    vals[k.strip()] = v.strip().strip('"').strip("'")

jwt = secrets.token_hex(32)
prov = secrets.token_hex(24)
out = f"""NODE_ENV=production
PORT=3011
HOST=127.0.0.1
FRONTEND_URL=https://pos.businessonecomprehensive.com
SHARED_POS_PUBLIC_ORIGIN=https://pos.businessonecomprehensive.com
MERCHANT_TENANCY=shared
PLATFORM_PROVISION_SECRET={prov}
JWT_SECRET={jwt}
DB_HOST={vals.get('DB_HOST', '')}
DB_PORT={vals.get('DB_PORT', '3306')}
DB_USER={vals.get('DB_USER', '')}
DB_PASSWORD={vals.get('DB_PASSWORD', '')}
DB_NAME=bo_platform
DB_SSL=true
DB_SSL_CA_PATH=./certs/ca-fork.crt
BILLING_SCHEDULER_ENABLED=false
STAGING_BLOCK_INDEXING=true
"""
xfer = Path("/tmp/boplat-xfer")
xfer.mkdir(parents=True, exist_ok=True)
(xfer / "certs").mkdir(exist_ok=True)
(xfer / ".env").write_text(out, encoding="utf-8")
(xfer / "PLATFORM_PROVISION_SECRET.txt").write_text(prov + "\n", encoding="utf-8")
print("ok", len(prov), len(jwt), bool(vals.get("DB_HOST")))
