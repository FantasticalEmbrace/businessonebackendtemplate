'use strict';



/**

 * Merge duplicate POS-import brand rows back onto canonical brands (with logos).

 * Reassigns products, copies logo_url when missing, deactivates merged rows.

 *

 *   node scripts/merge-duplicate-brands.js

 *   node scripts/merge-duplicate-brands.js --commit

 */



const { loadBackendEnv, createPool } = require('../utils/dbConfig');

const { BRAND_SLUG_ALIASES, BRAND_NAME_HINTS, normalizeKey } = require('../utils/brandImageMap');



const COMMIT = process.argv.includes('--commit');



function guessCanonicalSlug(brand, bySlug) {

    if (BRAND_SLUG_ALIASES[brand.slug]) return BRAND_SLUG_ALIASES[brand.slug];



    const name = normalizeKey(brand.name);

    const raw = `${brand.name || ''} ${brand.slug || ''}`;



    for (const hint of BRAND_NAME_HINTS) {

        if (!hint.match.test(raw)) continue;

        if (bySlug.has(hint.key)) return hint.key;

    }



    if (name.includes('newton')) return bySlug.has('newton-labs') ? 'newton-labs' : null;

    if (name.includes('standard-enzyme')) return bySlug.has('standard-enzyme') ? 'standard-enzyme' : null;

    if (name.includes('regal')) return bySlug.has('regal-labs') ? 'regal-labs' : null;

    if (name.includes('host-def')) return bySlug.has('host-defence') ? 'host-defence' : null;

    if (name.includes('natures') && name.includes('sunshine')) return bySlug.has('natures-sunshine') ? 'natures-sunshine' : null;

    if (name.includes('natures') && name.includes('plus')) return bySlug.has('natures-plus') ? 'natures-plus' : null;

    if (name.includes('life-fortune') || name.includes('lifes-fortune')) return bySlug.has('lifes-fortune') ? 'lifes-fortune' : null;

    if (name.includes('dr-tony') || name.includes('dr-tonys')) return bySlug.has('dr-tonys') ? 'dr-tonys' : null;

    if (name.includes('michael')) return bySlug.has('michaels-health') ? 'michaels-health' : (bySlug.has('michael-s') ? 'michael-s' : null);

    if (name.includes('perrin')) return bySlug.has('perrins-naturals') ? 'perrins-naturals' : null;

    if (name.includes('hm-enterprise') || name.includes('herbs-shop')) return bySlug.has('hm-enterprise') ? 'hm-enterprise' : null;

    if (name.includes('enzymedica')) return bySlug.has('enzymedica') ? 'enzymedica' : null;

    if (name.includes('buried-treasure')) return bySlug.has('buried-treasure') ? 'buried-treasure' : null;

    if (name.includes('hi-tech')) return bySlug.has('high-tech-pharmaceuticals') ? 'high-tech-pharmaceuticals' : null;

    if (name.includes('global-healing')) return bySlug.has('global-healing') ? 'global-healing' : null;

    if (name === 'now' || name.includes('now-foods')) return bySlug.has('now-foods') ? 'now-foods' : null;

    if (name.includes('ac-grace')) return bySlug.has('ac-grace') ? 'ac-grace' : null;

    if (name.includes('bio-neurix') || name.includes('bio-tech')) return bySlug.has('bio-neurix') ? 'bio-neurix' : null;

    if (name.includes('carlson')) return bySlug.has('carlson-labs') ? 'carlson-labs' : null;

    if (name.includes('edom')) return bySlug.has('edom-labs') ? 'edom-labs' : null;

    if (name.includes('oxylife') || name.includes('oxy-life')) return bySlug.has('oxy-life') ? 'oxy-life' : null;

    if (name.includes('unicity')) return bySlug.has('unicity') ? 'unicity' : null;

    if (name.includes('d-b-p') || name.includes('dbp')) return bySlug.has('d-b-p-team') ? 'd-b-p-team' : null;

    if (name.includes('hippie-jack')) return bySlug.has('hippie-jack-s') ? 'hippie-jack-s' : null;

    if (name.includes('md-science') || name.includes('m-d-science')) return bySlug.has('md-science') ? 'md-science' : null;

    if (name.includes('highland')) return bySlug.has('highland-labor') ? 'highland-labor' : null;

    if (name.includes('terry') || name.includes('thresh')) return bySlug.has('terry-naturally') ? 'terry-naturally' : null;

    if (name.includes('life-exten')) return bySlug.has('life-extension') ? 'life-extension' : null;

    if (name.includes('our-father')) return bySlug.has('our-father-s-healing-herbs') ? 'our-father-s-healing-herbs' : null;



    return null;

}



async function main() {

    loadBackendEnv();

    const pool = createPool({ connectionLimit: 3 });

    const [brands] = await pool.query(

        `SELECT b.id, b.name, b.slug, b.logo_url,

            (SELECT COUNT(*) FROM products p WHERE p.brand_id = b.id) AS product_count,

            (SELECT COUNT(*) FROM products p WHERE p.brand_id = b.id AND p.show_on_web = 1) AS web_count

         FROM brands b

         WHERE b.is_active = 1

         ORDER BY b.id`

    );



    const bySlug = new Map(brands.map((b) => [b.slug, b]));

    const merges = [];



    for (const brand of brands) {

        const targetSlug = guessCanonicalSlug(brand, bySlug);

        if (!targetSlug || targetSlug === brand.slug) continue;

        const target = bySlug.get(targetSlug);

        if (!target || target.id === brand.id) continue;

        merges.push({ from: brand, to: target });

    }



    const seen = new Set();

    const uniqueMerges = merges.filter((m) => {

        const key = m.from.id;

        if (seen.has(key)) return false;

        seen.add(key);

        return true;

    });



    console.log(`Active brands: ${brands.length}`);

    console.log(`Planned merges: ${uniqueMerges.length}`);

    console.log('Sample:', uniqueMerges.slice(0, 25).map((m) => ({

        from: `${m.from.id} ${m.from.name} (${m.from.slug})`,

        to: `${m.to.id} ${m.to.name} (${m.to.slug})`,

        products: m.from.product_count,

        web: m.from.web_count

    })));



    if (!COMMIT) {

        console.log('DRY RUN — pass --commit to apply');

        await pool.end();

        return;

    }



    const conn = await pool.getConnection();

    try {

        await conn.beginTransaction();

        for (const { from, to } of uniqueMerges) {

            await conn.execute(

                'UPDATE products SET brand_id = ? WHERE brand_id = ?',

                [to.id, from.id]

            );

            if (!String(to.logo_url || '').trim() && String(from.logo_url || '').trim()) {

                await conn.execute(

                    'UPDATE brands SET logo_url = ? WHERE id = ? AND (logo_url IS NULL OR logo_url = \'\')',

                    [from.logo_url, to.id]

                );

            }

            await conn.execute(

                'UPDATE brands SET is_active = 0 WHERE id = ?',

                [from.id]

            );

        }

        await conn.commit();

    } catch (err) {

        await conn.rollback();

        throw err;

    } finally {

        conn.release();

    }



    const [[after]] = await pool.query(

        `SELECT COUNT(*) n FROM brands WHERE is_active=1 AND (logo_url IS NULL OR logo_url='')`

    );

    console.log(`Active brands missing logo after merge: ${after.n}`);

    await pool.end();

}



main().catch((err) => {

    console.error(err);

    process.exit(1);

});

