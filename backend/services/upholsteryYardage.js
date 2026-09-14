'use strict';

/**
 * First-party upholstery yardage — no AI.
 * Base yards by piece type × qty, then fabric width, pattern repeat, nap, and waste.
 */

const DEFAULT_FABRIC_WIDTH_IN = 54;
const DEFAULT_WASTE_PCT = 10;

const PIECE_BASE_YARDS = Object.freeze({
    sofa: 12,
    loveseat: 9,
    sectional: 18,
    armchair: 5,
    wingback: 5,
    dining: 1.5,
    chair: 1.5,
    ottoman: 3,
    recliner: 8,
    marine: 4,
    banquette: 8,
    booth: 8,
    seats: 2.5,
    seat: 2.5,
    headliner: 4,
    console: 2,
    custom: 8,
    other: 8
});

const TEMPLATE_DEFAULTS = Object.freeze({
    'tpl-sofa': { pieceKey: 'sofa', qty: 1, baseYards: 12 },
    'tpl-dining': { pieceKey: 'dining', qty: 4, baseYards: 6 },
    'tpl-seats': { pieceKey: 'seats', qty: 2, baseYards: 5 },
    'tpl-headliner': { pieceKey: 'headliner', qty: 1, baseYards: 4 },
    'tpl-custom': { pieceKey: 'custom', qty: 1, baseYards: 8 }
});

function roundYards(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x < 0) return 0;
    return Math.round(x * 10) / 10;
}

function pieceKeyFromJob(job = {}) {
    const tpl = String(job.templateId || '').trim();
    if (TEMPLATE_DEFAULTS[tpl]) return TEMPLATE_DEFAULTS[tpl].pieceKey;
    const t = String(job.furnitureType || '').toLowerCase().trim();
    if (PIECE_BASE_YARDS[t] != null) return t;
    const kind = String(job.itemKind || '').toLowerCase();
    if (kind === 'vehicle') {
        const note = `${job.jobNote || ''} ${job.concern || ''} ${job.vehicle || ''}`.toLowerCase();
        if (/\bheadliner\b/.test(note)) return 'headliner';
        if (/\bconsole\b/.test(note)) return 'console';
        return 'seats';
    }
    if (kind === 'other') return 'custom';
    const label = `${job.furnitureLabel || ''} ${job.vehicle || ''} ${job.concern || ''}`.toLowerCase();
    if (/\bsectional\b/.test(label)) return 'sectional';
    if (/\bsofa|couch|loveseat\b/.test(label)) return 'sofa';
    if (/\bottoman\b/.test(label)) return 'ottoman';
    if (/\bdining\b/.test(label)) return 'dining';
    if (/\barmchair|wingback|recliner\b/.test(label)) return 'armchair';
    if (/\bmarine|boat|rv|banquette|booth\b/.test(label)) return 'marine';
    return 'custom';
}

function qtyFromJob(job = {}) {
    const pieces = Number(job.furniturePieces);
    if (Number.isFinite(pieces) && pieces > 0) return pieces;
    const seats = Number(job.seats);
    if (Number.isFinite(seats) && seats > 0) return seats;
    const tpl = TEMPLATE_DEFAULTS[String(job.templateId || '').trim()];
    if (tpl) return tpl.qty;
    return 1;
}

function baseYardsFor(pieceKey, qty) {
    const key = PIECE_BASE_YARDS[pieceKey] != null ? pieceKey : 'custom';
    const per = PIECE_BASE_YARDS[key];
    const n = Math.max(1, Number(qty) || 1);
    if (key === 'seats' || key === 'seat' || key === 'dining' || key === 'chair') {
        return per * n;
    }
    return per * n;
}

function fabricMultiplier({ fabricWidthIn, patternRepeatIn, nap, wastePct } = {}) {
    const width = Number(fabricWidthIn) > 0 ? Number(fabricWidthIn) : DEFAULT_FABRIC_WIDTH_IN;
    const widthFactor = Math.max(0.85, DEFAULT_FABRIC_WIDTH_IN / width);
    const repeat = Number(patternRepeatIn) || 0;
    const repeatFactor = repeat > 0 ? 1 + Math.min(0.35, repeat / 80) : 1;
    const napOn = nap === true || nap === '1' || String(nap || '').toLowerCase() === 'yes';
    const napFactor = napOn ? 1.08 : 1;
    const waste = Number(wastePct);
    const wasteFactor = 1 + (Number.isFinite(waste) ? Math.max(0, Math.min(40, waste)) : DEFAULT_WASTE_PCT) / 100;
    return widthFactor * repeatFactor * napFactor * wasteFactor;
}

function calculateYardage(job = {}) {
    const pieceKey = pieceKeyFromJob(job);
    const qty = qtyFromJob(job);
    const tpl = TEMPLATE_DEFAULTS[String(job.templateId || '').trim()];
    const hasQty = Number(job.furniturePieces) > 0 || Number(job.seats) > 0;
    const base = tpl && !hasQty ? tpl.baseYards : baseYardsFor(pieceKey, qty);
    const factor = fabricMultiplier({
        fabricWidthIn: job.fabricWidthIn,
        patternRepeatIn: job.patternRepeatIn,
        nap: job.nap,
        wastePct: job.wastePct
    });
    const yards = roundYards(base * factor);
    return {
        yards,
        pieceKey,
        qty,
        baseYards: roundYards(base),
        fabricWidthIn: Number(job.fabricWidthIn) > 0 ? Number(job.fabricWidthIn) : DEFAULT_FABRIC_WIDTH_IN,
        patternRepeatIn: Number(job.patternRepeatIn) || 0,
        nap: job.nap === true || job.nap === '1' || String(job.nap || '').toLowerCase() === 'yes',
        wastePct: Number.isFinite(Number(job.wastePct)) ? Number(job.wastePct) : DEFAULT_WASTE_PCT
    };
}

function suggestYards(job = {}) {
    return calculateYardage(job).yards;
}

module.exports = {
    DEFAULT_FABRIC_WIDTH_IN,
    DEFAULT_WASTE_PCT,
    PIECE_BASE_YARDS,
    TEMPLATE_DEFAULTS,
    calculateYardage,
    suggestYards,
    pieceKeyFromJob,
    fabricMultiplier,
    roundYards
};
