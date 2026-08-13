/**
 * Download product images into repo images/products/ and return a site-relative URL.
 */
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const axios = require('axios');

const BASE = process.env.CATALOG_SCRAPE_DOMAIN || 'https://hmherbs.com';

const DEFAULT_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
};

function repoImagesDir() {
    return path.join(__dirname, '..', '..', 'images', 'products');
}

function extFromUrl(u) {
    const clean = String(u).split('?')[0];
    const m = clean.match(/\.(jpe?g|png|gif|webp)$/i);
    return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

function isValidImageBuffer(buf) {
    if (!buf || buf.length < 12) return false;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
        return true;
    }
    return false;
}

async function downloadBinary(url, referer = `${BASE}/`) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 45000,
        maxRedirects: 5,
        headers: { ...DEFAULT_HEADERS, Referer: referer },
        validateStatus: (s) => s === 200,
    });
    const buf = Buffer.from(res.data);
    if (buf.length < 100) {
        throw new Error(`Response too small (${buf.length} bytes)`);
    }
    return buf;
}

async function downloadFirstValidImage(urls, options = {}) {
    const referer = options.referer != null ? options.referer : `${BASE}/`;
    if (!urls || !urls.length) {
        return { buf: null, url: null, lastError: 'no candidate URLs' };
    }
    let lastError = '';
    for (const url of urls) {
        try {
            const buf = await downloadBinary(url, referer);
            if (!isValidImageBuffer(buf)) {
                lastError = `not a valid image (${buf.length} b)`;
                continue;
            }
            return { buf, url, lastError: null };
        } catch (e) {
            lastError = e.message || String(e);
        }
    }
    return { buf: null, url: null, lastError };
}

function safeBasename(value) {
    return String(value || 'product')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 120) || 'product';
}

/**
 * @returns {Promise<{ localPath: string, publicUrl: string, sourceUrl: string|null }|null>}
 */
async function saveRemoteProductImage({ sourceUrl, basename, imagesDir, referer, dryRun = false }) {
    if (!sourceUrl) return null;
    const dir = imagesDir || repoImagesDir();
    const base = safeBasename(basename);
    const { buf, url } = await downloadFirstValidImage([sourceUrl], { referer });
    if (!buf) return null;

    const ext = extFromUrl(url || sourceUrl);
    const filename = `${base}.${ext}`;
    const fullPath = path.join(dir, filename);
    const publicUrl = `/images/products/${filename}`;

    if (!dryRun) {
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(fullPath, buf);
    }

    return { localPath: fullPath, publicUrl, sourceUrl: url || sourceUrl };
}

function pickImageFromProductGallery(images, variantSku, variantName) {
    const needles = [];
    const sku = String(variantSku || '').trim().toUpperCase();
    if (sku) needles.push(sku);
    const hint = String(variantName || '').match(/#([A-Za-z0-9-]+)/);
    if (hint) needles.push(hint[1].toUpperCase());

    let best = null;
    let bestScore = 0;
    for (const img of images || []) {
        const url = String(img.image_url || img.url || '').toUpperCase();
        if (!url) continue;
        for (const needle of needles) {
            if (!needle) continue;
            if (url.includes(needle)) {
                const score = needle.length + (url.includes(`-${needle}`) ? 10 : 0);
                if (score > bestScore) {
                    bestScore = score;
                    best = img.image_url || img.url;
                }
            }
        }
    }
    return best;
}

module.exports = {
    repoImagesDir,
    downloadFirstValidImage,
    saveRemoteProductImage,
    pickImageFromProductGallery,
    safeBasename,
};
