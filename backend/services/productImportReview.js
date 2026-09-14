'use strict';

/**
 * Pre-import review for the bulk product CSV import.
 *
 * Design goal: catch REAL problems (bad barcode checksum, a barcode already
 * used by a different product, missing image on a web-visible item) without
 * flooding the merchant with a huge review queue. Only rows with an actual
 * issue are ever surfaced — clean rows import automatically, no click needed.
 *
 * Enrichment (manufacturer SKU / image lookup) reuses the existing brand-site
 * scraping tools (`suggestProductSkuFromBrand`, `getManufacturerImageUrls`).
 * It NEVER invents a barcode or picks an image with an LLM — those tools only
 * return what is actually published on the brand's own site, and the
 * merchant must accept a suggestion before it's used. Enrichment is capped
 * and best-effort so one slow brand site can't stall the whole review.
 */

const { suggestProductSkuFromBrand } = require('./suggestProductSkuFromBrand');
const { getManufacturerImageUrls } = require('../scripts/manufacturer-site-images');

const DEFAULT_ENRICH_LIMIT = 12;
const ENRICH_TIMEOUT_MS = 9000;

const STANDARD_BARCODE_LENGTHS = [8, 12, 13, 14];

/** UPC-A / EAN-13 / EAN-8 / GTIN-14 checksum. Returns true only for barcode-shaped codes. */
function isBarcodeShaped(code) {
    return /^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(String(code || '').trim());
}

function barcodeChecksumValid(code) {
    const digits = String(code || '').trim();
    if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(digits)) return null; // not applicable
    const nums = digits.split('').map(Number);
    const check = nums.pop();
    let sum = 0;
    // GS1: from the right, alternate weights 3,1,3,1... for the digits preceding the check digit
    for (let i = 0; i < nums.length; i++) {
        const posFromRight = nums.length - i; // 1-indexed from the right, excluding check digit
        const weight = posFromRight % 2 === 1 ? 3 : 1;
        sum += nums[i] * weight;
    }
    const expected = (10 - (sum % 10)) % 10;
    return expected === check;
}

/**
 * Different POS/catalog exports don't handle barcodes the same way. The most
 * common real-world break: a spreadsheet (Excel "Open" / re-save, or a POS
 * that exports numeric-typed cells) drops the leading zero off a 12-digit
 * UPC-A or 8-digit EAN-8, leaving 11 or 7 digits.
 *
 * NOTE: GS1 checksums are designed so that zero-padding a valid code to a
 * longer standard length (e.g. UPC-A embedded in EAN-13) stays valid. So
 * padding "back" 1 zero AND 2 zeros will often both checksum-validate — that
 * is expected, not a sign of ambiguity. Always prefer the smallest padding
 * (the most likely number of zeros actually dropped), not "the only one
 * that validates."
 */
function recoverLeadingZeroBarcode(code) {
    const digits = String(code || '').trim();
    if (!/^\d{4,14}$/.test(digits) || STANDARD_BARCODE_LENGTHS.includes(digits.length)) return null;
    const targets = STANDARD_BARCODE_LENGTHS
        .map((targetLen) => ({ targetLen, pad: targetLen - digits.length }))
        .filter((t) => t.pad > 0 && t.pad <= 2)
        .sort((a, b) => a.pad - b.pad);
    for (const { pad } of targets) {
        const padded = '0'.repeat(pad) + digits;
        if (barcodeChecksumValid(padded) === true) return padded;
    }
    return null;
}

async function withTimeout(promise, ms, fallback) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((resolve) => {
                timer = setTimeout(() => resolve(fallback), ms);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {Array<object>} rows - product rows already mapped by ProductImporter.mapCSVToProduct
 * @param {{ enrich?: boolean, enrichLimit?: number }} [opts]
 */
async function reviewImportRows(pool, rows, opts = {}) {
    const enrich = opts.enrich !== false;
    const enrichLimit = Number.isFinite(opts.enrichLimit) ? opts.enrichLimit : DEFAULT_ENRICH_LIMIT;

    const total = rows.length;
    const skuCounts = new Map();
    rows.forEach((r) => {
        const key = String(r?.sku || '').trim();
        if (!key) return;
        skuCounts.set(key, (skuCounts.get(key) || 0) + 1);
    });

    // Batch-check which SKUs already exist in the DB and what name they're attached to.
    const skusToCheck = [...new Set(rows.map((r) => String(r?.sku || '').trim()).filter(Boolean))];
    const existingBySku = new Map();
    if (pool && skusToCheck.length) {
        const chunkSize = 500;
        for (let i = 0; i < skusToCheck.length; i += chunkSize) {
            const chunk = skusToCheck.slice(i, i + chunkSize);
            const placeholders = chunk.map(() => '?').join(',');
            try {
                const [dbRows] = await pool.execute(
                    `SELECT sku, name FROM products WHERE sku IN (${placeholders})`,
                    chunk
                );
                dbRows.forEach((row) => existingBySku.set(row.sku, row.name));
            } catch {
                /* best-effort — skip duplicate-check on failure */
            }
        }
    }

    const flagged = [];
    const ok = [];

    rows.forEach((row, index) => {
        const issues = [];
        let deterministicSuggestion = null;
        const sku = String(row?.sku || '').trim();
        const name = String(row?.name || '').trim();

        if (isBarcodeShaped(sku)) {
            const valid = barcodeChecksumValid(sku);
            if (valid === false) {
                issues.push({ code: 'bad_barcode', message: `"${sku}" does not look like a valid barcode (checksum failed).` });
            }
        } else if (/^\d{6,14}$/.test(sku)) {
            // Numeric but not a standard barcode length (8/12/13/14) — very often a
            // spreadsheet or export tool dropped a leading zero. Try to recover it
            // before treating this as a generic problem.
            const recovered = recoverLeadingZeroBarcode(sku);
            if (recovered) {
                issues.push({
                    code: 'barcode_missing_leading_zero',
                    message: `"${sku}" is ${sku.length} digits — likely a barcode that lost a leading zero on export. Restoring it gives "${recovered}", which checksums correctly.`
                });
                deterministicSuggestion = { type: 'sku', value: recovered, source: 'leading-zero-recovery' };
            } else {
                issues.push({
                    code: 'unusual_barcode_length',
                    message: `"${sku}" is ${sku.length} digits — not a standard barcode length (8, 12, 13, or 14). Worth a manual look before importing.`
                });
            }
        }

        if (sku && skuCounts.get(sku) > 1) {
            issues.push({ code: 'duplicate_in_file', message: `SKU/barcode "${sku}" appears more than once in this file.` });
        }

        if (sku && existingBySku.has(sku)) {
            const existingName = existingBySku.get(sku);
            if (existingName && name && existingName.trim().toLowerCase() !== name.toLowerCase()) {
                issues.push({
                    code: 'sku_conflict',
                    message: `SKU/barcode "${sku}" is already used by an existing product named "${existingName}".`
                });
            }
        }

        const wantsWeb = row?.show_on_web !== false && row?.is_active !== false;
        if (wantsWeb && (!Array.isArray(row?.images) || row.images.length === 0)) {
            issues.push({ code: 'missing_image', message: 'No image — this item is set to show on the web with no photo.' });
        }

        if (!row?.price || Number(row.price) <= 0) {
            issues.push({ code: 'missing_price', message: 'No price set.' });
        }

        if (issues.length) {
            flagged.push({ rowIndex: index, row, issues, suggestion: deterministicSuggestion });
        } else {
            ok.push({ rowIndex: index, row });
        }
    });

    // Best-effort enrichment for a capped number of flagged rows only.
    if (enrich && flagged.length) {
        const candidates = flagged
            .filter((f) => f.issues.some((i) => i.code === 'bad_barcode' || i.code === 'missing_image'))
            .slice(0, enrichLimit);

        for (const item of candidates) {
            const { row } = item;
            const needsSku = item.issues.some((i) => i.code === 'bad_barcode');
            const needsImage = item.issues.some((i) => i.code === 'missing_image');

            if (needsSku) {
                try {
                    const result = await withTimeout(
                        suggestProductSkuFromBrand({ productName: row.name, brandName: row.brand }),
                        ENRICH_TIMEOUT_MS,
                        { ok: false }
                    );
                    if (result?.ok && result.sku) {
                        item.suggestion = {
                            type: 'sku',
                            value: result.sku,
                            source: result.source || 'brand-website',
                            pdpUrl: result.pdpUrl || null
                        };
                    }
                } catch {
                    /* leave unsuggested — merchant fixes manually */
                }
            } else if (needsImage) {
                try {
                    const urls = await withTimeout(
                        getManufacturerImageUrls({ productName: row.name, brandName: row.brand }),
                        ENRICH_TIMEOUT_MS,
                        []
                    );
                    if (Array.isArray(urls) && urls.length) {
                        item.suggestion = { type: 'image', value: urls[0], source: 'brand-website' };
                    }
                } catch {
                    /* leave unsuggested */
                }
            }
        }
    }

    return {
        total,
        okCount: ok.length,
        flaggedCount: flagged.length,
        okRows: ok,
        flaggedRows: flagged
    };
}

module.exports = {
    reviewImportRows,
    barcodeChecksumValid,
    isBarcodeShaped
};
