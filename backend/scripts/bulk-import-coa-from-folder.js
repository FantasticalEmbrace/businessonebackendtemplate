#!/usr/bin/env node
/**
 * Copy COA PDFs from a folder into backend/uploads/coa and attach to products by SKU.
 *
 * Naming: each file must be named exactly `{SKU}.pdf` (filename without extension = product SKU).
 *
 * Usage:
 *   node scripts/bulk-import-coa-from-folder.js "C:\path\to\coa-pdfs"
 *   node scripts/bulk-import-coa-from-folder.js "C:\path\to\coa-pdfs" --dry-run
 *   node scripts/bulk-import-coa-from-folder.js "C:\path\to\coa-pdfs" --set-cannabis
 *
 * Env: same DB vars as the rest of the backend (.env in backend/).
 */

const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const fs = require('fs').promises;
const path = require('path');

const UPLOADS_COA = path.join(__dirname, '..', 'uploads', 'coa');

function parseArgs() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const setCannabis = args.includes('--set-cannabis');
    const dir = args.find((a) => !a.startsWith('--'));
    return { dir, dryRun, setCannabis };
}

(async () => {
    loadBackendEnv();
    const { dir, dryRun, setCannabis } = parseArgs();
    if (!dir) {
        console.error('Usage: node scripts/bulk-import-coa-from-folder.js <folder-with-PDFs> [--dry-run] [--set-cannabis]');
        process.exit(1);
    }

    const abs = path.resolve(dir);
    let files;
    try {
        files = await fs.readdir(abs);
    } catch (e) {
        console.error('Cannot read folder:', abs, e.message);
        process.exit(1);
    }

    const pdfs = files.filter((f) => f.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) {
        console.log('No .pdf files in', abs);
        process.exit(0);
    }

    const pool = createPool({ connectionLimit: 2 });

    if (!dryRun) {
        await fs.mkdir(UPLOADS_COA, { recursive: true });
    }

    console.log(dryRun ? 'DRY RUN — no files copied or DB updates\n' : 'Importing COAs…\n');

    let ok = 0;
    let skipped = 0;

    for (const file of pdfs) {
        const sku = path.basename(file, path.extname(file)).trim();
        if (!sku) {
            console.warn('Skip (empty SKU):', file);
            skipped++;
            continue;
        }

        const [rows] = await pool.query('SELECT id, name FROM products WHERE sku = ? LIMIT 1', [sku]);
        if (!rows.length) {
            console.warn(`No product with SKU "${sku}" — skipped (${file})`);
            skipped++;
            continue;
        }

        const product = rows[0];
        const srcPath = path.join(abs, file);

        if (dryRun) {
            console.log(`Would attach ${file} → sku ${sku} (${product.name})`);
            ok++;
            continue;
        }

        const unique = `coa-${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`;
        const destPath = path.join(UPLOADS_COA, unique);
        await fs.copyFile(srcPath, destPath);

        const publicUrl = `/uploads/coa/${unique}`;
        const setSql = setCannabis
            ? 'UPDATE products SET coa_url = ?, coa_updated_at = CURDATE(), is_cannabis = 1 WHERE id = ?'
            : 'UPDATE products SET coa_url = ?, coa_updated_at = CURDATE() WHERE id = ?';

        await pool.execute(setSql, [publicUrl, product.id]);

        console.log(`✓ ${sku} — ${product.name}`);
        console.log(`  ${publicUrl}`);
        ok++;
    }

    await pool.end();

    console.log(`\nDone: ${ok} applied, ${skipped} skipped.`);
    if (setCannabis) {
        console.log('(--set-cannabis: marked updated rows as cannabis/hemp)');
    }
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
