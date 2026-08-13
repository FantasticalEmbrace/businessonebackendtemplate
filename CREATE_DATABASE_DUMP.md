# How to Create MySQL Database Dump

## Quick Method (PowerShell - Recommended)

1. **Open PowerShell** in the project root folder
2. **Run the script:**
   ```powershell
   .\create-database-dump.ps1
   ```

## Alternative Method (Command Prompt)

1. **Open Command Prompt** in the project root folder
2. **Run the batch file:**
   ```cmd
   create-database-dump.bat
   ```

## Manual Method

If the scripts don't work, you can create the dump manually:

### Step 1: Find Your Database Credentials

Check your `backend/.env` file for:
- `DB_HOST` (usually `localhost`)
- `DB_USER` (usually `root`)
- `DB_PASSWORD` (your MySQL password)
- `DB_NAME` (usually `hmherbs`)

### Step 2: Run mysqldump Command

**If you have a password:**
```bash
mysqldump -h localhost -u root -pYourPassword hmherbs > database\hmherbs_backup.sql
```

**If no password:**
```bash
mysqldump -h localhost -u root hmherbs > database\hmherbs_backup.sql
```

**With timestamp:**
```bash
mysqldump -h localhost -u root hmherbs > database\hmherbs_backup_%date:~-4,4%%date:~-10,2%%date:~-7,2%_%time:~0,2%%time:~3,2%%time:~6,2%.sql
```

## What Gets Dumped

The dump will include:
- ✅ All table structures (CREATE TABLE statements)
- ✅ All data (INSERT statements)
- ✅ Indexes and constraints
- ✅ All 33+ tables in your database

## Output Location

The dump file will be saved to:
- `database\hmherbs_backup_[timestamp].sql`

## File Size

Depending on your data:
- **Small database** (< 100 products): ~1-5 MB
- **Medium database** (100-1000 products): ~5-20 MB
- **Large database** (1000+ products): 20+ MB

## Next steps after creating a dump

1. Optionally update `database/build-deploy-bundle.js` to use your new backup filename.
2. Run `npm run db:build-staging` to produce `database/deploy-staging.sql`.
3. Import into **Linode Managed MySQL** — see **[database/DEPLOY-DATABASE.md](./database/DEPLOY-DATABASE.md)**.

## Troubleshooting

### "mysqldump: command not found"
- MySQL is not in your PATH
- Add MySQL bin directory to PATH, or use full path:
  ```bash
  "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe" -u root hmherbs > database\dump.sql
  ```

### "Access Denied"
- Check username and password
- Verify database name is correct
- Make sure MySQL is running

### "Unknown Database"
- Database doesn't exist
- Check database name in `.env` file
- List databases: `mysql -u root -e "SHOW DATABASES;"`

## Security Note

⚠️ **Important**: The dump file contains all your data including:
- Product information
- User accounts (with password hashes)
- Order history
- Admin credentials

**Keep this file secure** and don't commit it to Git or share it publicly!

