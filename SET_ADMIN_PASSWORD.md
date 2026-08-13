# Set Admin Password to "admin1"

## Quick Method: Run SQL Script

I've created a SQL script that will update the admin password. Run this in your MySQL client:

```sql
-- Update admin password to "admin1"
UPDATE admin_users 
SET password_hash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6hsxq5S/kS',
    updated_at = NOW()
WHERE email = 'hmherbs1@gmail.com';
```

**OR** run the SQL file:
```bash
mysql -u root -p hmherbs < database/update-admin-password.sql
```

## Method 2: Use Node.js Script

If you have Node.js available:

```bash
cd backend
node scripts/set-admin-password.js
```

## Method 3: Generate Hash and Update Manually

1. Generate the bcrypt hash:
```bash
cd backend
node -e "const bcrypt=require('bcrypt');bcrypt.hash('admin1',12).then(h=>console.log(h))"
```

2. Copy the hash and run this SQL:
```sql
UPDATE admin_users 
SET password_hash = '<paste_hash_here>',
    updated_at = NOW()
WHERE email = 'hmherbs1@gmail.com';
```

## After Updating

**Admin Credentials:**
- **Email:** `hmherbs1@gmail.com`
- **Password:** `admin1`

Access the admin panel at: `admin.html`

