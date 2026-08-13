/**
 * Loads pathname → target mappings from a CSV at the project root and issues 301 redirects.
 *
 * File: SEO_REDIRECTS_FILE env (default redirects-301.csv), two columns: from_path,to_path
 * - from_path: pathname only, e.g. /old-blog/article (no domain, no query string)
 * - to_path: relative (/new-path) or absolute (https://...)
 *
 * Reloads periodically so you can update the CSV without restarting (production: every 120s).
 */

const fs = require('fs');
const path = require('path');

function normalizePathname(p) {
    if (!p || p === '/') {
        return '/';
    }
    let s = String(p).trim();
    try {
        if (s.startsWith('http://') || s.startsWith('https://')) {
            s = new URL(s).pathname || '/';
        }
    } catch {
        return '/';
    }
    if (!s.startsWith('/')) {
        s = `/${s}`;
    }
    const noTrail = s.replace(/\/+$/, '');
    return noTrail === '' ? '/' : noTrail;
}

function parseRedirectCsv(text) {
    const map = new Map();
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        if (/^from_path\s*,/i.test(trimmed)) {
            continue;
        }
        const comma = trimmed.indexOf(',');
        if (comma <= 0) {
            continue;
        }
        const fromRaw = trimmed.slice(0, comma).trim();
        const toRaw = trimmed.slice(comma + 1).trim();
        if (!fromRaw || !toRaw) {
            continue;
        }
        const fromKey = normalizePathname(fromRaw);
        if (fromKey === '/') {
            continue;
        }
        map.set(fromKey, toRaw);
    }
    return map;
}

function resolveRedirectFileList(rootPath) {
    const envList = String(process.env.SEO_REDIRECTS_FILES || '').trim();
    if (envList) {
        return envList
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean)
            .map((f) => (path.isAbsolute(f) ? f : path.join(rootPath, f)));
    }
    const single = process.env.SEO_REDIRECTS_FILE || 'redirects-301.csv';
    const files = [path.join(rootPath, single)];
    if (single === 'redirects-301.csv') {
        for (const name of [
            'redirects-legacy-sitemap.csv',
            'redirects-products-db.csv',
            'redirects-slug-aliases.csv'
        ]) {
            const fp = path.join(rootPath, name);
            if (fs.existsSync(fp)) {
                files.push(fp);
            }
        }
    }
    return files;
}

function createSeoRedirectMiddleware({ rootPath, logger, reloadMs = 120000 }) {
    const filePaths = resolveRedirectFileList(rootPath);
    let map = new Map();
    /** @type {Map<string, number>} */
    const mtimes = new Map();

    function load() {
        try {
            const merged = new Map();
            const loadedNames = [];
            for (const filePath of filePaths) {
                if (!fs.existsSync(filePath)) {
                    continue;
                }
                mtimes.set(filePath, fs.statSync(filePath).mtimeMs);
                const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
                for (const [k, v] of parseRedirectCsv(text)) {
                    merged.set(k, v);
                }
                loadedNames.push(path.basename(filePath));
            }
            map = merged;
            if (logger && typeof logger.info === 'function' && loadedNames.length) {
                logger.info(
                    `SEO 301 redirects loaded (${map.size} rules) from ${loadedNames.join(', ')}`
                );
            }
        } catch (e) {
            map = new Map();
            if (logger && typeof logger.warn === 'function') {
                logger.warn(`SEO redirects: load failed: ${e.message}`);
            }
        }
    }

    function latestMtime() {
        let max = 0;
        for (const filePath of filePaths) {
            try {
                if (fs.existsSync(filePath)) {
                    max = Math.max(max, fs.statSync(filePath).mtimeMs);
                }
            } catch {
                /* ignore */
            }
        }
        return max;
    }

    let lastCheck = latestMtime();
    load();
    if (reloadMs > 0) {
        setInterval(() => {
            try {
                const t = latestMtime();
                if (t !== lastCheck) {
                    lastCheck = t;
                    load();
                }
            } catch {
                /* ignore */
            }
        }, reloadMs);
    }

    return function seoRedirectMiddleware(req, res, next) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return next();
        }
        const p = req.path || '/';
        if (p.startsWith('/api')) {
            return next();
        }
        if (
            p === '/robots.txt' ||
            p === '/sitemap.xml' ||
            p === '/sitemap-pages.xml' ||
            p === '/sitemap-products.xml'
        ) {
            return next();
        }

        const key = normalizePathname(p);
        const target = map.get(key);
        if (!target) {
            return next();
        }

        let location = target.trim();
        if (!location.startsWith('http://') && !location.startsWith('https://')) {
            if (!location.startsWith('/')) {
                location = `/${location}`;
            }
        }

        return res.redirect(301, location);
    };
}

module.exports = {
    createSeoRedirectMiddleware,
    normalizePathname,
    parseRedirectCsv,
    resolveRedirectFileList
};
