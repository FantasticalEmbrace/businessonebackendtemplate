#!/usr/bin/env node
/**
 * Replace 0-byte image files under repo images/ with a known-good JPEG placeholder.
 * Empty files still return HTTP 200 and break <img> decoding (naturalWidth 0 → error).
 *
 * Usage (from backend/): node scripts/repair-empty-image-files.js
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const IMAGES_ROOT = path.join(REPO_ROOT, 'images');
const SOURCE = path.join(IMAGES_ROOT, 'products', 'nature-s-puls-probiotic-mega.jpg');

function walk(dir, out) {
    let names;
    try {
        names = fs.readdirSync(dir);
    } catch {
        return;
    }
    for (const name of names) {
        const full = path.join(dir, name);
        let st;
        try {
            st = fs.statSync(full);
        } catch {
            continue;
        }
        if (st.isDirectory()) {
            walk(full, out);
        } else if (/\.(jpe?g|png|gif|webp)$/i.test(name) && st.size === 0) {
            out.push(full);
        }
    }
}

(function () {
    if (!fs.existsSync(SOURCE) || fs.statSync(SOURCE).size < 10) {
        console.error('Missing or invalid source JPEG:', SOURCE);
        process.exit(1);
    }
    const empty = [];
    walk(IMAGES_ROOT, empty);
    if (empty.length === 0) {
        console.log('No empty image files under images/.');
        return;
    }
    for (const f of empty) {
        fs.copyFileSync(SOURCE, f);
        console.log('Repaired:', path.relative(REPO_ROOT, f));
    }
    console.log(`Done: ${empty.length} file(s).`);
})();
