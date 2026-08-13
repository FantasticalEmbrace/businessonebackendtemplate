'use strict';



/**

 * Restore brand logo_url values after POS CSV import created logo-less brand rows.

 * Never overwrites an existing logo_url.

 */



const fs = require('fs');

const path = require('path');

const { loadBackendEnv, createPool } = require('../utils/dbConfig');

const { getImageUrlForBrand, normalizeKey } = require('../utils/brandImageMap');



const COMMIT = process.argv.includes('--commit');

const SITE_ROOT = path.resolve(__dirname, '../..');

const BRAND_IMG_DIR = path.join(SITE_ROOT, 'images', 'brand-images');

const BACKUP_SQL = path.join(SITE_ROOT, 'database', 'hmherbs_backup_20251216_170604.sql');



function parseBackupBrandLogos() {

    const map = new Map();

    if (!fs.existsSync(BACKUP_SQL)) return map;



    const text = fs.readFileSync(BACKUP_SQL, 'utf8');

    const insertMatch = text.match(/INSERT INTO `brands` VALUES (.+?);\r?\n/s);

    if (!insertMatch) return map;



    const logoRe = /\('([^']*(?:\\'[^']*)*)','([^']*)','[^']*','(\/images\/brand-images\/[^']+)'/g;

    let m;

    while ((m = logoRe.exec(insertMatch[1])) !== null) {

        const name = m[1].replace(/\\'/g, "'");

        const slug = m[2];

        const logo = m[3];

        map.set(normalizeKey(slug), logo);

        map.set(normalizeKey(name), logo);

    }

    return map;

}



function loadDiskFiles() {

    const byNorm = new Map();

    if (!fs.existsSync(BRAND_IMG_DIR)) return byNorm;



    for (const file of fs.readdirSync(BRAND_IMG_DIR)) {

        if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(file)) continue;

        const norm = normalizeKey(path.parse(file).name);

        byNorm.set(norm, `/images/brand-images/${file}`);

        byNorm.set(normalizeKey(file), `/images/brand-images/${file}`);

    }

    return byNorm;

}



function resolveLogo(brand, sources) {

    const keys = [normalizeKey(brand.slug), normalizeKey(brand.name)];

    for (const key of keys) {

        if (!key) continue;

        if (sources.dbLogos.get(key)) return sources.dbLogos.get(key);

        if (sources.backupLogos.get(key)) return sources.backupLogos.get(key);

        if (sources.diskFiles.get(key)) return sources.diskFiles.get(key);

    }

    return getImageUrlForBrand(brand);

}



async function main() {

    loadBackendEnv();

    const pool = createPool({ connectionLimit: 3 });



    const backupLogos = parseBackupBrandLogos();

    const diskFiles = loadDiskFiles();



    const [brands] = await pool.query(

        'SELECT id, name, slug, logo_url FROM brands ORDER BY id'

    );



    const dbLogos = new Map();

    for (const b of brands) {

        const logo = String(b.logo_url || '').trim();

        if (!logo) continue;

        dbLogos.set(normalizeKey(b.slug), logo);

        dbLogos.set(normalizeKey(b.name), logo);

    }



    const sources = { dbLogos, backupLogos, diskFiles };

    const updates = [];



    for (const brand of brands) {

        if (String(brand.logo_url || '').trim()) continue;

        const logo = resolveLogo(brand, sources);

        if (!logo) continue;



        const diskPath = path.join(SITE_ROOT, logo.replace(/^\//, '').replace(/\//g, path.sep));

        if (!fs.existsSync(diskPath)) {

            console.warn(`SKIP missing file for brand ${brand.id} ${brand.name}: ${logo}`);

            continue;

        }



        updates.push({ id: brand.id, name: brand.name, slug: brand.slug, logo });

        dbLogos.set(normalizeKey(brand.slug), logo);

        dbLogos.set(normalizeKey(brand.name), logo);

    }



    console.log(`Brands total: ${brands.length}`);

    console.log(`With logo already: ${brands.filter((b) => String(b.logo_url || '').trim()).length}`);

    console.log(`To restore: ${updates.length}`);

    console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}`);



    if (updates.length) {

        console.log('Sample updates:', updates.slice(0, 20));

    }



    if (COMMIT && updates.length) {

        const conn = await pool.getConnection();

        try {

            for (const row of updates) {

                await conn.execute(

                    `UPDATE brands SET logo_url = ? WHERE id = ? AND (logo_url IS NULL OR logo_url = '')`,

                    [row.logo, row.id]

                );

            }

        } finally {

            conn.release();

        }

    }



    const [[after]] = await pool.query(

        "SELECT COUNT(*) AS n FROM brands WHERE logo_url IS NOT NULL AND logo_url <> ''"

    );

    console.log(`Brands with logo after: ${after.n}`);

    await pool.end();

}



main().catch((err) => {

    console.error(err);

    process.exit(1);

});

