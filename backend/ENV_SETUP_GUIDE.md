# .env File Setup Guide

## Critical Issue: Database Password Not Set

The error logs show:
```
Access denied for user 'root'@'localhost' (using password: NO)
```

This means your `.env` file is missing the database password.

## How to Fix

### Step 1: Locate/Create .env File

The `.env` file should be located at:
```
backend/.env
```

### Step 2: Add Required Configuration

Open `backend/.env` and add/update these values:

```env
# Database Configuration
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_root_password_here
DB_NAME=hmherbs

# Server Configuration
PORT=3001
NODE_ENV=development

# JWT Secret (generate a random string)
JWT_SECRET=your_random_jwt_secret_here

# Optional: Redis (if using)
# REDIS_URL=redis://localhost:6379
```

### Step 3: Replace Placeholder Values

**IMPORTANT:** Replace these placeholders:

1. **`your_mysql_root_password_here`** → Your actual MySQL root password
   - If you don't know it, you may need to reset it or check your MySQL installation
   - On Windows, check MySQL installation notes or use MySQL Workbench

2. **`your_random_jwt_secret_here`** → A random secret string
   - Can be any long random string
   - Example: `mySecretJWTKey123456789!@#$%^&*()`

### Step 4: Verify .env File

After saving, verify the file:
- File location: `backend/.env`
- File should NOT have quotes around values
- No spaces around the `=` sign
- Each variable on its own line

**Correct format:**
```env
DB_PASSWORD=mypassword123
```

**Incorrect format:**
```env
DB_PASSWORD = "mypassword123"  ❌ (has spaces and quotes)
DB_PASSWORD=mypassword123      ✅ (correct)
```

### Step 5: Restart Server

After updating `.env`:
```bash
cd backend
npm start
```

### Step 6: Check Console Output

When server starts, you should see:
```
Database config: { host: 'localhost', user: 'root', database: 'hmherbs', hasPassword: true }
```

If you see `hasPassword: false`, the password is still not being loaded.

## Troubleshooting

### If Password Still Not Working

1. **Check .env file location:**
   - Must be in `backend/` directory
   - Not in root directory
   - File name is exactly `.env` (not `.env.txt`)

2. **Check for typos:**
   - Variable names are case-sensitive
   - Must be: `DB_PASSWORD` (not `DB_PASS` or `DATABASE_PASSWORD`)

3. **Check MySQL password:**
   - Test connection manually:
     ```bash
     mysql -u root -p
     ```
   - If this fails, your MySQL password is incorrect

4. **Check file encoding:**
   - File should be saved as UTF-8
   - No BOM (Byte Order Mark)

5. **Restart server after changes:**
   - Changes to `.env` require server restart
   - Stop server (Ctrl+C) and start again

## Security Note

**Never commit .env file to git!**

Make sure `.env` is in `.gitignore`:
```
backend/.env
```

## Linode Managed MySQL (production)

Copy `backend/.env.linode.example` to `backend/.env` on the server and fill in values from **Cloud Manager → Databases → Connection Details**.

```env
DB_HOST=lin-xxxxx-xxxx.servers.linodedb.net
DB_PORT=3306
DB_USER=akmadmin
DB_PASSWORD=your_managed_password
DB_NAME=hmherbs
DB_SSL=true
DB_SSL_CA_PATH=./certs/ca-certificate.crt
```

Test from the server after placing the CA file:

```bash
cd backend && npm run db:test
```

See **[LINODE_DEPLOY.md](../LINODE_DEPLOY.md)** for full deployment.

## Example .env File (local development)

Here's a complete example (replace with your actual values):

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=MySecurePassword123!
DB_NAME=hmherbs

# Server
PORT=3001
NODE_ENV=development

# Security
JWT_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0
```

