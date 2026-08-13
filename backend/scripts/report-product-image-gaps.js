#!/usr/bin/env node
/**
 * Report products whose primary image is not a valid on-disk file under the repo.
 *
 * Flags rows where:
 *   - no primary product_images row, or empty image_url
 *   - image_url is still remote (http/https)
 *   - local path under /images/... is missing, too small, or not a real image (e.g. HTML)
 *
 * Usage (from backend/):
 *   node scripts/report-product-image-gaps.js
 *   node scripts/report-product-image-gaps.js --db-only   # raw product_images row only (ignores API catalog overlay)
 *   node scripts/report-product-image-gaps.js --csv > gaps.csv
 *   node scripts/report-product-image-gaps.js --json
 *   node scripts/report-product-image-gaps.js --limit 100
 *
 * Default mode validates the **effective** primary URL (same rules as GET /api/products: catalog
 * overrides win, then sanitized DB URL). Use this to catch missing files and $0 prices that the
 * storefront actually shows.
 *
 * Env: DB_* from backend/.env
 */
const fs = require('fs').promises;
const path = require('path');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const {
    effectivePrimaryImageUrl,
    catalogPrimaryImageForProduct,
    catalogPriceForSku
} = require('../utils/catalogOverrides');

const REPO_ROOT = path.join(__dirname, '..', '..');

function parseArgs() {
    const a = process.argv.slice(2);
    let limit = null;
    const li = a.indexOf('--limit');
    if (li >= 0 && a[li + 1]) {
        limit = parseInt(a[li + 1], 10);
        if (Number.isNaN(limit)) limit = null;
    }
    return {
        csv: a.includes('--csv'),
        json: a.includes('--json'),
        limit,
        dbOnly: a.includes('--db-only')
    };
}

function isValidImageBuffer(buf) {
    if (!buf || buf.length < 800) return false;
    const probe = buf.slice(0, 64).toString('ascii');
    if (/^<!DOCTYPE/i.test(probe) || /^<html/i.test(probe) || /^<\?xml/i.test(probe)) return false;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
        return true;
    }
    return false;
}

function classifyPrimaryImage(imageUrl) {
    if (imageUrl == null || String(imageUrl).trim() === '') {
        return { ok: false, reason: 'empty_url' };
    }
    const u = String(imageUrl).trim();
    if (u.startsWith('data:')) {
        return { ok: false, reason: 'data_url' };
    }
    if (/^https?:\/\//i.test(u) || u.startsWith('//')) {
        return { ok: false, reason: 'remote_url' };
    }
    if (!u.startsWith('/')) {
        return { ok: false, reason: 'unexpected_path' };
    }
    return { ok: true, reason: 'local', fsRelative: u.replace(/^\//, '') };
}

async function checkLocalFile(fsRelative) {
    const full = path.join(REPO_ROOT, fsRelative);
    try {
        const st = await fs.stat(full);
        if (!st.isFile()) {
            return { ok: false, reason: 'not_a_file', path: full };
        }
        if (st.size < 500) {
            return { ok: false, reason: 'file_too_small', path: full, size: st.size };
        }
        const buf = await fs.readFile(full);
        if (!isValidImageBuffer(buf)) {
            return { ok: false, reason: 'invalid_image_bytes', path: full, size: buf.length };
        }
        return { ok: true, path: full, size: st.size };
    } catch {
        return { ok: false, reason: 'file_missing', path: full };
    }
}

(async () => {
    loadBackendEnv();
    const { csv, json, limit, dbOnly } = parseArgs();

    const pool = createPool({ connectionLimit: 5 });

    let sql = `
        SELECT p.id, p.sku, p.slug, p.name, p.price AS product_price,
               pi.image_url AS primary_image_url, pi.id AS primary_image_id
        FROM products p
        LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1
        WHERE p.is_active = 1
        ORDER BY p.id
    `;
    if (limit != null && limit > 0) {
        sql += ` LIMIT ${Math.min(100000, Math.max(1, limit))}`;
    }

    const [rows] = await pool.execute(sql);
    await pool.end();

    const gaps = [];

    for (const row of rows) {
        const priceNum = parseFloat(row.product_price);
        const priceIsZero = !Number.isFinite(priceNum) || priceNum === 0;
        const hasCatalogPrice = catalogPriceForSku(row.sku) != null;
        const priceProblem = priceIsZero && !hasCatalogPrice;

        const baseRow = () => ({
            id: row.id,
            sku: row.sku,
            slug: row.slug,
            name: row.name,
            primary_image_url: row.primary_image_url,
            product_price: row.product_price,
            price_issue: priceProblem
        });

        if (dbOnly) {
            if (row.primary_image_id == null) {
                gaps.push({ ...baseRow(), issue: 'no_primary_row' });
                continue;
            }

            const c = classifyPrimaryImage(row.primary_image_url);
            if (!c.ok) {
                gaps.push({ ...baseRow(), issue: c.reason });
                continue;
            }

            const fileCheck = await checkLocalFile(c.fsRelative);
            if (!fileCheck.ok) {
                gaps.push({
                    ...baseRow(),
                    issue: fileCheck.reason,
                    detail_path: fileCheck.path,
                    detail_size: fileCheck.size
                });
            }
            continue;
        }

        let imageIssue = null;
        let detail_path;
        let detail_size;
        let effective_url;

        const effective = effectivePrimaryImageUrl(row);
        effective_url = effective;
        if (effective == null || String(effective).trim() === '') {
            imageIssue = 'no_effective_image';
        } else {
            const ce = classifyPrimaryImage(effective);
            if (!ce.ok) {
                imageIssue = ce.reason === 'remote_url' ? 'effective_remote_url' : ce.reason;
            } else {
                const fileCheck = await checkLocalFile(ce.fsRelative);
                if (!fileCheck.ok) {
                    const catalogPath = catalogPrimaryImageForProduct(row);
                    imageIssue =
                        catalogPath === effective ? 'catalog_file_bad_or_missing' : fileCheck.reason;
                    detail_path = fileCheck.path;
                    detail_size = fileCheck.size;
                }
            }
        }

        if (!imageIssue && !priceProblem) continue;

        const issue =
            imageIssue ||
            'price_zero_no_catalog_override';

        gaps.push({
            ...baseRow(),
            issue,
            image_issue: imageIssue,
            effective_url,
            detail_path,
            detail_size
        });
    }

    const summary = {
        products_scanned: rows.length,
        with_gap: gaps.length,
        ok: rows.length - gaps.length
    };

    if (json) {
        console.log(JSON.stringify({ summary, gaps }, null, 2));
        process.exit(0);
    }

    if (csv) {
        const esc = (v) => {
            if (v == null) return '';
            const s = String(v);
            if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
            return s;
        };
        console.log('id,sku,slug,issue,price_issue,effective_url,primary_image_url,name');
        for (const g of gaps) {
            console.log(
                [
                    g.id,
                    g.sku,
                    g.slug,
                    g.issue,
                    g.price_issue ? '1' : '',
                    g.effective_url || '',
                    g.primary_image_url,
                    g.name
                ]
                    .map(esc)
                    .join(',')
            );
        }
        console.error(
            `\n# summary: scanned=${summary.products_scanned} gaps=${summary.with_gap} ok=${summary.ok}`
        );
        process.exit(0);
    }

    console.log(`Scanned ${summary.products_scanned} active products.`);
    console.log(
        dbOnly
            ? `OK (DB primary file valid): ${summary.ok}`
            : `OK (effective image file + price): ${summary.ok}`
    );
    console.log(`Gaps: ${summary.with_gap}\n`);

    const byIssue = new Map();
    for (const g of gaps) {
        byIssue.set(g.issue, (byIssue.get(g.issue) || 0) + 1);
    }
    if (byIssue.size) {
        console.log('By issue:');
        for (const [k, v] of [...byIssue.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`  ${k}: ${v}`);
        }
        console.log('');
    }

    const show = gaps.slice(0, 200);
    for (const g of show) {
        const extra = g.detail_path ? ` (${g.detail_path})` : '';
        const eff = g.effective_url ? `\n  effective: ${g.effective_url}` : '';
        const pi = g.price_issue ? ' price_issue' : '';
        console.log(
            `#${g.id} sku=${g.sku} [${g.issue}]${pi}${extra}${eff}\n  db: ${g.primary_image_url || '(none)'}\n  ${g.name}\n`
        );
    }
    if (gaps.length > show.length) {
        console.log(`... and ${gaps.length - show.length} more. Use --csv or --json for full list.`);
    }

    process.exit(gaps.length > 0 ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
