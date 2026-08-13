# Set Admin Password to "admin1" - Quick Guide

## Method 1: Generate Hash and Update SQL (Recommended)

### Step 1: Generate the bcrypt hash

**Option A: Using Node.js (if installed)**
```bash
cd backend
node -e "const bcrypt=require('bcrypt');bcrypt.hash('admin1',12).then(h=>console.log(h))"
```

**Option B: Using Online Tool**
1. Go to: https://bcrypt-generator.com/
2. Enter password: `admin1`
3. Set rounds: `12`
4. Click "Generate Hash"
5. Copy the generated hash

**Option C: Using PHP (if installed)**
```php
<?php
echo password_hash('admin1', PASSWORD_BCRYPT, ['cost' => 12]);
?>
```

### Step 2: Update Database

Open your MySQL client (command line or Workbench) and run:

```sql
USE hmherbs;

UPDATE admin_users 
SET password_hash = '<paste_your_generated_hash_here>',
    updated_at = NOW()
WHERE email = 'hmherbs1@gmail.com';
```

Replace `<paste_your_generated_hash_here>` with the hash you generated.

## Method 2: Direct MySQL Update (If you have MySQL access)

1. Open MySQL command line:
```bash
mysql -u root -p hmherbs
```

2. Generate hash using Node.js (if available in another terminal):
```bash
node -e "const bcrypt=require('bcrypt');bcrypt.hash('admin1',12).then(h=>console.log(h))"
```

3. Copy the hash and run in MySQL:
```sql
UPDATE admin_users 
SET password_hash = '<hash>',
    updated_at = NOW()
WHERE email = 'hmherbs1@gmail.com';
```

## Method 3: Use the Script (If Node.js is in PATH)

```bash
cd backend
node scripts/set-admin-password.js
```

## After Setting Password

**Login Credentials:**
- **Email:** `hmherbs1@gmail.com`
- **Password:** `admin1`

**Access Admin Panel:**
- Open `admin.html` in your browser
- Enter the credentials above

## Verify It Worked

After updating, test the login:
1. Open `admin.html`
2. Enter email: `hmherbs1@gmail.com`
3. Enter password: `admin1`
4. Click "Sign In"

If login fails, double-check:
- The hash was generated correctly (12 rounds)
- The SQL update ran successfully
- The email matches exactly: `hmherbs1@gmail.com`

