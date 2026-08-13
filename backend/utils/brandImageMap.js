'use strict';

/**
 * Canonical brand image filenames and POS/import slug aliases.
 * Shared by API logo resolution, restore script, and merge script.
 */

/** @type {Record<string, string>} normalized key -> filename under images/brand-images/ */
const BRAND_IMAGE_FILES = {
    'standard-enzyme': 'standard-enzyme.jpg',
    'natures-plus': 'natures-plus.jpg',
    'natures-sunshine': "Nature's Sunshine.jpg",
    'global-healing': 'global-healing.jpg',
    'host-defence': 'host-defense.jpg',
    'host-defense': 'host-defense.jpg',
    'hm-enterprise': 'hm-herbs.png',
    'hm-herbs': 'hm-herbs.png',
    'terry-naturally': 'terry-naturally.jpg',
    'unicity': 'unicity.jpg',
    'newton-labs': 'newton-homeopathics.png',
    'newton-homeopathics': 'newton-homeopathics.png',
    'newton-homeopathic-kids': 'newton-homeopathic-kids.png',
    'newton-homeopathics-pets': 'newton-homeopathics-pets.png',
    'regal-labs': 'regal-labs.jpg',
    'doctors-blend': 'doctors-blend.jpg',
    'ac-grace': 'ac-grace.png',
    'a-c-grace': 'ac-grace.png',
    'aps': 'APS.jpg',
    'bio-neurix': 'BioNeurix.png',
    'bioneurix': 'BioNeurix.png',
    'buried-treasure': 'Buried Treasure.jpg',
    'edom-labs': 'Edom Labs.jpg',
    'flexcin': 'Flexcin.jpg',
    'formor': 'formor.jpg',
    'go-out': 'go-out.jpg',
    'carlson': 'Carlson.jpg',
    'carlson-labs': 'Carlson.jpg',
    'enzymedica': 'Enzymedica.jpg',
    'high-tech-pharmaceuticals': 'HI Tech Pharmaceuticals.png',
    'hi-tech-pharmaceuticals': 'HI Tech Pharmaceuticals.png',
    'lifes-fortune': "life's-fortune.jpg",
    'life-fortune': "life's-fortune.jpg",
    'life-extension': 'Life Extension.jpg',
    'life-flo': 'Life-Flo.png',
    'natures-balance': "Nature's Balance.jpg",
    'natural-balance': 'Natural Balance.png',
    'hemp-bombs': 'Hemp Bombs.png',
    'highland-labs': 'Highland Labs.jpg',
    'hippie-jacks': 'Hippie Jacks.jpg',
    'dr-tonys': "Dr. Tony's.png",
    'dr-tony-o-donnell': "Dr. Tony's.png",
    'irwin-naturals': 'Irwin Naturals.jpg',
    'now-foods': 'now-foods.jpg',
    'oxy-life': 'Oxy Life.png',
    'oxylife': 'Oxy Life.png',
    'perrins-naturals': "perrin's-naturals.jpg",
    'power-thin-phase-2': 'power-thin-phase-II.jpg',
    'power-thin-phase-ii': 'power-thin-phase-II.jpg',
    'miracle-ii': 'power-thin-phase-II.jpg',
    'purple-tiger': 'purple-tiger.jpg',
    'skinny-magic': 'skinny-magic.jpg',
    'vista-life': 'vista-life.jpg',
    'herbs-for-life': 'Herbs For Life.png',
    'md-science': 'MD Science.jpg',
    'michaels-health': "Michael's Health.png",
    'michael-s': "Michael's Health.png",
    'north-american-herb-spice': 'North American Herb & Spice.jpg',
    'north-american-herb-and-spice': 'North American Herb & Spice.jpg',
    'gold-star': 'power-thin-phase-II.jpg',
    'our-fathers-healing-herbs': "Our Father's Healing.png",
    'cardio-amaze': 'cardio-amaze.jpg',
    'd-b-p-team': 'd-b-p-team.jpg',
    'drt-male-supplements': 'drt-male-supplements.jpg'
};

/** POS/import slug -> canonical slug for DB merge */
const BRAND_SLUG_ALIASES = {
    'newton-homeopathy': 'newton-labs',
    'newton-labs-kids': 'newton-labs',
    'newton-labs-pets': 'newton-labs',
    'standard-enzyme-co': 'standard-enzyme',
    'regalabs-inc': 'regal-labs',
    'regalabs': 'regal-labs',
    'host-defense-mushrooms': 'host-defence',
    'host-defense': 'host-defence',
    'life-fortune': 'lifes-fortune',
    'nature-s-sunshine': 'natures-sunshine',
    'nature-s-plus': 'natures-plus',
    'nature-s-balance': 'natures-balance',
    'dr-tony-o-donnell': 'dr-tonys',
    'michael-s': 'michaels-health',
    'michaels': 'michaels-health',
    'perrin-skin-blend': 'perrins-naturals',
    'hm-enterprises-happy-pms': 'hm-enterprise',
    'herbs-shop': 'hm-enterprise',
    'a-c-grace': 'ac-grace',
    'ac-grace-company': 'ac-grace',
    'enzymedica-corp': 'enzymedica',
    'north-american-herb-and-spice': 'north-american-herb-spice',
    'buried-treasure-liquid-nutrients': 'buried-treasure',
    'hi-tech-pharmaceuticals-inc': 'high-tech-pharmaceuticals',
    'global-healing-center': 'global-healing',
    'natures-sunshine-products': 'natures-sunshine',
    'now': 'now-foods',
    'bio-tech': 'bio-neurix',
    'bioneurix-coporation': 'bio-neurix',
    'bioneurix-corporation': 'bio-neurix',
    'carlson-labs': 'carlson-labs',
    'd-b-p-dist': 'd-b-p-team',
    'edom-lab': 'edom-labs',
    'life-extenstion': 'life-extension',
    'm-d-science-labs': 'md-science',
    'm-d-science-labs-men-womens-products': 'md-science',
    'oxylife-inc': 'oxy-life',
    'our-father-s-healing-herbs': 'our-fathers-healing-herbs',
    'unicity-enrich': 'unicity',
    'highland-labor': 'highland-labs',
    'threshold': 'terry-naturally',
    'thres': 'terry-naturally',
    'nut-solaray': 'natures-sunshine'
};

/** slug/name fragment -> image file key when no exact match */
const BRAND_NAME_HINTS = [
    { match: /newton/i, key: 'newton-labs' },
    { match: /standard.?enzyme/i, key: 'standard-enzyme' },
    { match: /regal/i, key: 'regal-labs' },
    { match: /host.?def/i, key: 'host-defence' },
    { match: /nature.?s.?sunshine|nut.?solaray/i, key: 'natures-sunshine' },
    { match: /nature.?s.?plus/i, key: 'natures-plus' },
    { match: /life.?exten/i, key: 'life-extension' },
    { match: /life.?fortune/i, key: 'lifes-fortune' },
    { match: /dr.?tony/i, key: 'dr-tonys' },
    { match: /michael/i, key: 'michael-s' },
    { match: /perrin/i, key: 'perrins-naturals' },
    { match: /enzymedica/i, key: 'enzymedica' },
    { match: /buried.?treasure/i, key: 'buried-treasure' },
    { match: /hi.?tech/i, key: 'high-tech-pharmaceuticals' },
    { match: /global.?healing/i, key: 'global-healing' },
    { match: /now.?foods|^now$/i, key: 'now-foods' },
    { match: /ac.?grace/i, key: 'ac-grace' },
    { match: /bio.?neurix|bio.?tech/i, key: 'bio-neurix' },
    { match: /carlson/i, key: 'carlson-labs' },
    { match: /edom/i, key: 'edom-labs' },
    { match: /oxy\s?life|oxylife/i, key: 'oxy-life' },
    { match: /unicity/i, key: 'unicity' },
    { match: /d\.?b\.?p/i, key: 'd-b-p-team' },
    { match: /hippie.?jack/i, key: 'hippie-jacks' },
    { match: /md.?science|m\.?d\.?\s*science/i, key: 'md-science' },
    { match: /highland/i, key: 'highland-labs' },
    { match: /terry|thresh/i, key: 'terry-naturally' },
    { match: /our.?father/i, key: 'our-fathers-healing-herbs' }
];

function normalizeKey(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function getImageFileForKey(key) {
    if (!key) return null;
    const normalized = normalizeKey(key);
    const alias = BRAND_SLUG_ALIASES[normalized];
    if (alias && BRAND_IMAGE_FILES[alias]) return BRAND_IMAGE_FILES[alias];
    return BRAND_IMAGE_FILES[normalized] || null;
}

function getImageUrlForBrand(brand) {
    const slug = normalizeKey(brand.slug);
    const name = normalizeKey(brand.name);

    for (const key of [slug, name]) {
        const file = getImageFileForKey(key);
        if (file) return `/images/brand-images/${file}`;
    }

    const raw = `${brand.name || ''} ${brand.slug || ''}`;
    for (const hint of BRAND_NAME_HINTS) {
        if (!hint.match.test(raw)) continue;
        const file = BRAND_IMAGE_FILES[hint.key];
        if (file) return `/images/brand-images/${file}`;
    }

    return null;
}

module.exports = {
    BRAND_IMAGE_FILES,
    BRAND_SLUG_ALIASES,
    BRAND_NAME_HINTS,
    normalizeKey,
    getImageFileForKey,
    getImageUrlForBrand
};
