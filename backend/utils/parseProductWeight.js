'use strict';

const OZ_PER_LB = 16;
const OZ_PER_KG = 35.274;
const OZ_PER_G = 0.035274;

function stripHtml(text) {
    return String(text || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Parse net product weight from name/description text. Returns ounces or null.
 * Ignores mg/mcg doses; prefers oz/lb/g/kg container sizes.
 */
function parseWeightOzFromText(text) {
    const raw = stripHtml(text);
    if (!raw) return null;

    const candidates = [];

    const ozRe = /(\d+(?:\.\d+)?)\s*(?:fl\.?\s*)?oz\b/gi;
    let m;
    while ((m = ozRe.exec(raw)) !== null) {
        const v = parseFloat(m[1]);
        if (Number.isFinite(v) && v > 0 && v < 500) candidates.push({ oz: v, priority: 3, index: m.index });
    }

    const ozTightRe = /(\d+(?:\.\d+)?)oz\b/gi;
    while ((m = ozTightRe.exec(raw)) !== null) {
        const v = parseFloat(m[1]);
        if (Number.isFinite(v) && v > 0 && v < 500) candidates.push({ oz: v, priority: 3, index: m.index });
    }

    const lbRe = /(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)\b/gi;
    while ((m = lbRe.exec(raw)) !== null) {
        const v = parseFloat(m[1]);
        if (Number.isFinite(v) && v > 0 && v < 50) candidates.push({ oz: v * OZ_PER_LB, priority: 2, index: m.index });
    }

    const kgRe = /(\d+(?:\.\d+)?)\s*kg\b/gi;
    while ((m = kgRe.exec(raw)) !== null) {
        const v = parseFloat(m[1]);
        if (Number.isFinite(v) && v > 0 && v < 20) candidates.push({ oz: v * OZ_PER_KG, priority: 2, index: m.index });
    }

    const gRe = /(\d+(?:\.\d+)?)\s*g\b/gi;
    while ((m = gRe.exec(raw)) !== null) {
        const before = raw.slice(Math.max(0, m.index - 2), m.index).toLowerCase();
        if (before.endsWith('m') || before.endsWith('k')) continue;
        const v = parseFloat(m[1]);
        if (Number.isFinite(v) && v >= 10 && v < 5000) candidates.push({ oz: v * OZ_PER_G, priority: 1, index: m.index });
    }

    if (!candidates.length) return null;

    candidates.sort((a, b) => b.priority - a.priority || a.index - b.index);
    return Math.round(candidates[0].oz * 100) / 100;
}

module.exports = { stripHtml, parseWeightOzFromText };
