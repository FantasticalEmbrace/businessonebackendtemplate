/**
 * APA-style title case for product names / headings.
 * Capitalizes major words; keeps short articles/prepositions/conjunctions
 * lowercase unless they are the first or last word.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.HMFormatProductTitle = api.formatProductTitle;
        root.HMFormatProductTitleApi = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : null, function () {
    const SMALL_WORDS = new Set([
        'a', 'an', 'the',
        'and', 'but', 'or', 'nor', 'for', 'so', 'yet',
        'as', 'at', 'by', 'in', 'of', 'on', 'to', 'up', 'via', 'per', 'vs', 'vs.',
        'with', 'from', 'into', 'onto', 'over', 'than',
    ]);

    const ACRONYMS = new Set([
        'cbd', 'thc', 'edsa', 'aps', 'pms', 'glp', 'glp-1', 'uv', 'dna', 'rna',
        'usa', 'uk', 'eu', 'fda', 'usda', 'gmo', 'coa', 'hm', 'nmi', 'pos',
        'mg', 'mcg', 'iu', 'ml', 'oz', 'lb', 'kg', 'ct', 'pk',
        'add', 'adhd',
    ]);

    // Valid Roman numerals that are also common English tokens — do not force ALL CAPS.
    const ROMAN_LOOKALIKE_WORDS = new Set([
        'mix', 'mid', 'dim', 'mic', 'lid', 'did', 'div', 'civil', 'mimic',
    ]);

    /** Classic Roman numeral (1–3999). Keeps II/III/IV from becoming Ii/Iii/Iv. */
    function isRomanNumeralToken(core) {
        const s = String(core || '');
        if (s.length < 2 || s.length > 15) return false;
        if (!/^[ivxlcdm]+$/i.test(s)) return false;
        const lower = s.toLowerCase();
        if (ROMAN_LOOKALIKE_WORDS.has(lower)) return false;
        return /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i.test(s);
    }

    function collapseSpaces(s) {
        return String(s || '').replace(/\s+/g, ' ').trim();
    }

    function decodeBasicEntities(s) {
        return String(s || '')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#0*39;/g, "'")
            .replace(/&apos;/gi, "'")
            .replace(/&nbsp;/gi, ' ');
    }

    function splitPunctuation(word) {
        const m = String(word).match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
        if (!m) return { lead: '', core: word, trail: '' };
        return { lead: m[1], core: m[2], trail: m[3] };
    }

    function titleCasePlain(core) {
        if (!core) return core;
        return core.charAt(0).toUpperCase() + core.slice(1).toLowerCase();
    }

    function formatCore(core, isFirst, isLast) {
        if (!core) return core;
        const lower = core.toLowerCase();

        if (core === '&') return '&';
        if (ACRONYMS.has(lower)) return lower.toUpperCase();
        if (isRomanNumeralToken(core)) return lower.toUpperCase();

        if (SMALL_WORDS.has(lower) && !isFirst && !isLast) return lower;

        if (core.includes('/')) {
            return core
                .split('/')
                .map((part, idx, arr) => formatCore(part, idx === 0 && isFirst, idx === arr.length - 1 && isLast))
                .join('/');
        }

        if (core.includes('-')) {
            return core
                .split('-')
                .map((part, idx, arr) => formatCore(part, idx === 0 && isFirst, idx === arr.length - 1 && isLast))
                .join('-');
        }

        // 1600mg / 2oz → keep common units lowercase; title-case other letter groups
        if (/\d/.test(core) && /[A-Za-z]/.test(core)) {
            const UNIT_LOWER = new Set(['mg', 'mcg', 'g', 'kg', 'ml', 'l', 'oz', 'lb', 'ct', 'pk', 'iu']);
            return core.replace(/[A-Za-z]+/g, (letters) => {
                const l = letters.toLowerCase();
                if (UNIT_LOWER.has(l)) return l;
                if (ACRONYMS.has(l)) return l.toUpperCase();
                if (isRomanNumeralToken(letters)) return l.toUpperCase();
                return titleCasePlain(letters);
            });
        }

        return titleCasePlain(core);
    }

    function formatToken(token, isFirst, isLast) {
        if (!token) return token;
        if (token === '&') return '&';
        const { lead, core, trail } = splitPunctuation(token);
        if (!core) return token;
        return lead + formatCore(core, isFirst, isLast) + trail;
    }

    function isAllCapsTitle(raw) {
        if (!/[A-Z]/.test(raw)) return false;
        // Has letters and every letter is uppercase
        const letters = raw.replace(/[^A-Za-z]/g, '');
        return letters.length > 0 && letters === letters.toUpperCase();
    }

    /**
     * @param {string} name
     * @returns {string}
     */
    function formatProductTitle(name) {
        const raw = collapseSpaces(decodeBasicEntities(name));
        if (!raw) return '';

        // Admin/catalog casing is authoritative for ALL CAPS titles (e.g. ADD/ADHD).
        // Do not rewrite them to title case — that desyncs the storefront from admin.
        if (isAllCapsTitle(raw)) return raw;

        const words = raw.split(' ');
        return words
            .map((word, idx) => formatToken(word, idx === 0, idx === words.length - 1))
            .join(' ');
    }

    return { formatProductTitle, SMALL_WORDS, ACRONYMS };
});
