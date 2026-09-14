'use strict';

const META_PREFIX = '[hm:checkout-meta]';

function parseCheckoutMeta(notes) {
    const text = String(notes || '');
    const idx = text.indexOf(META_PREFIX);
    if (idx < 0) return {};

    const jsonStart = idx + META_PREFIX.length;
    const jsonEnd = text.indexOf('\n', jsonStart);
    const jsonText = (jsonEnd >= 0 ? text.slice(jsonStart, jsonEnd) : text.slice(jsonStart)).trim();
    if (!jsonText) return {};

    try {
        const parsed = JSON.parse(jsonText);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function stripCheckoutMeta(notes) {
    const text = String(notes || '');
    const idx = text.indexOf(META_PREFIX);
    if (idx < 0) return text.trim() || null;

    const before = text.slice(0, idx).trimEnd();
    const afterStart = text.indexOf('\n', idx);
    const after = afterStart >= 0 ? text.slice(afterStart + 1).trim() : '';
    const merged = [before, after].filter(Boolean).join('\n').trim();
    return merged || null;
}

function appendCheckoutMeta(notes, meta) {
    const clean = stripCheckoutMeta(notes);
    const payload = { ...(meta || {}) };
    Object.keys(payload).forEach((key) => {
        if (payload[key] == null || payload[key] === false) delete payload[key];
    });
    if (!Object.keys(payload).length) return clean;

    const metaLine = `${META_PREFIX}${JSON.stringify(payload)}`;
    return clean ? `${clean}\n${metaLine}` : metaLine;
}

module.exports = {
    META_PREFIX,
    parseCheckoutMeta,
    stripCheckoutMeta,
    appendCheckoutMeta,
};
