'use strict';

const fs = require('fs');
const path = require('path');
const {
    BRAND_IMAGE_FILES,
    BRAND_SLUG_ALIASES,
    normalizeKey,
    getImageUrlForBrand
} = require('./brandImageMap');

const SITE_ROOT = path.resolve(__dirname, '../..');
const BRAND_IMG_DIR = path.join(SITE_ROOT, 'images', 'brand-images');

let diskIndex = null;

function getDiskIndex() {
    if (diskIndex) return diskIndex;
    diskIndex = new Map();
    if (!fs.existsSync(BRAND_IMG_DIR)) return diskIndex;
    for (const file of fs.readdirSync(BRAND_IMG_DIR)) {
        if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(file)) continue;
        diskIndex.set(normalizeKey(path.parse(file).name), `/images/brand-images/${file}`);
        diskIndex.set(normalizeKey(file), `/images/brand-images/${file}`);
    }
    return diskIndex;
}

function fileExistsOnDisk(url) {
    if (!url) return false;
    const diskPath = path.join(SITE_ROOT, url.replace(/^\//, '').replace(/\//g, path.sep));
    return fs.existsSync(diskPath);
}

function resolveBrandLogoUrl(brand) {
    const existing = String(brand.logo_url || '').trim();
    if (existing) return existing;

    const fromMap = getImageUrlForBrand(brand);
    if (fromMap && fileExistsOnDisk(fromMap)) return fromMap;

    const keys = [normalizeKey(brand.slug), normalizeKey(brand.name)];
    for (const key of keys) {
        if (!key) continue;
        const aliasKey = BRAND_SLUG_ALIASES[key];
        if (aliasKey) {
            const aliasFile = BRAND_IMAGE_FILES[aliasKey];
            if (aliasFile) {
                const aliasUrl = `/images/brand-images/${aliasFile}`;
                if (fileExistsOnDisk(aliasUrl)) return aliasUrl;
            }
        }
        const fromDisk = getDiskIndex().get(key);
        if (fromDisk) return fromDisk;
    }

    return null;
}

function enrichBrandsWithLogos(brands) {
    return brands.map((brand) => {
        const resolved = resolveBrandLogoUrl(brand);
        if (!resolved || resolved === brand.logo_url) return brand;
        return { ...brand, logo_url: resolved };
    });
}

module.exports = {
    normalizeKey,
    resolveBrandLogoUrl,
    enrichBrandsWithLogos,
    BRAND_IMAGE_FILES: BRAND_IMAGE_FILES
};
