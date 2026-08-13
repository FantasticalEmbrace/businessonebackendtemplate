#!/usr/bin/env node
/**
 * Pulls title, meta description, and first H1 from top-level *.html files (repo inventory).
 * Usage: node scripts/seo-migration/extract-html-metadata.js
 *         node scripts/seo-migration/extract-html-metadata.js --write
 *
 * Does not replace a Screaming Frog crawl of https://hmherbs.com — use both.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const write = process.argv.includes('--write');
const base = 'https://hmherbs.com';

const SKIP_NAMES = new Set([
    'check-upload.html',
    'create-placeholder-images.html',
    'unregister-sw.html'
]);

function stripTags(html) {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function pick(re, html, flags = 'i') {
    const r = new RegExp(re, flags);
    const m = html.match(r);
    return m ? (m[1] || '').trim() : '';
}

function extract(html) {
    const title = pick('<title[^>]*>([\\s\\S]*?)<\\/title>', html, 'i');
    const metaDesc = pick(
        '<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)["\']',
        html,
        'i'
    );
    const metaDesc2 = metaDesc || pick('<meta[^>]+content=["\']([^"\']*)["\'][^>]+name=["\']description["\']', html, 'i');
    const h1 = pick('<h1[^>]*>([\\s\\S]*?)<\\/h1>', html, 'i');
    return {
        title: stripTags(title),
        meta_description: stripTags(metaDesc2),
        h1: stripTags(h1)
    };
}

function main() {
    const names = fs
        .readdirSync(root)
        .filter((f) => f.endsWith('.html') && !SKIP_NAMES.has(f));

    const rows = [
        ['html_file', 'path_as_served', 'guessed_clean_path', 'title', 'meta_description', 'h1']
    ];

    for (const name of names.sort()) {
        const fp = path.join(root, name);
        const html = fs.readFileSync(fp, 'utf8');
        const { title, meta_description, h1 } = extract(html);
        const pathAsServed = `/${name}`;
        const baseName = name.replace(/\.html$/i, '');
        const guessedClean = baseName === 'index' ? '/' : `/${baseName}`;
        rows.push([name, pathAsServed, guessedClean, title, meta_description, h1]);
    }

    const esc = (cell) => {
        const s = String(cell);
        if (/[",\n\r]/.test(s)) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
    };
    const csv = rows.map((r) => r.map(esc).join(',')).join('\n');

    if (write) {
        const outDir = path.join(__dirname, 'output');
        fs.mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, 'html-metadata-from-repo.csv');
        fs.writeFileSync(outFile, csv, 'utf8');
        console.log('Wrote', outFile, `(${names.length} files)`);
        console.log('Tip: merge with live crawl; clean URLs on hmherbs.com may omit .html');
    } else {
        console.log(csv);
    }
}

main();
