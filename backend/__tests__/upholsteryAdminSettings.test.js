'use strict';

const {
    normalizeUpholsteryYardage,
    normalizeUpholsteryVendors,
    normalizeUpholsteryTemplates,
    normalizeBays,
    normalizeBayLabels,
    normalizePackages,
    DEFAULT_UPHOLSTERY_YARDAGE,
    DEFAULT_BAYS
} = require('../services/posShopSettings');

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

const yardage = normalizeUpholsteryYardage({
    fabricWidthIn: 60,
    wastePct: 12,
    napDefault: true,
    pieceBaseYards: { sofa: 14 }
});
assert(yardage.fabricWidthIn === 60, 'fabric width');
assert(yardage.wastePct === 12, 'waste');
assert(yardage.napDefault === true, 'nap');
assert(yardage.pieceBaseYards.sofa === 14, 'sofa override');
assert(yardage.pieceBaseYards.dining === DEFAULT_UPHOLSTERY_YARDAGE.pieceBaseYards.dining, 'dining kept');

const vendors = normalizeUpholsteryVendors([{ name: 'Mill A', leadDays: 10 }, '  ', { name: '' }]);
assert(vendors.length === 1 && vendors[0].name === 'Mill A' && vendors[0].leadDays === 10, 'vendors');

const templates = normalizeUpholsteryTemplates([
    { id: 'tpl-x', name: 'X', pieceKey: 'sofa', yardsHint: 11, qty: 2 }
]);
assert(templates[0].yardsHint === 11 && templates[0].qty === 2, 'templates');

const bays = normalizeBays({ upholstery: ['Bench A', 'Bench B'] });
assert(bays.upholstery[0] === 'Bench A', 'uph bays');
assert(bays.auto[0] === DEFAULT_BAYS.auto[0], 'auto bays default');

const labels = normalizeBayLabels({ upholstery: 'Station' });
assert(labels.upholstery === 'Station', 'bay label');

const pkgs = normalizePackages({ upholstery: [{ id: 'p1', name: 'P', lines: [] }] });
assert(pkgs.upholstery[0].id === 'p1', 'packages upholstery');
assert(pkgs.auto.length > 0, 'packages auto default kept');

console.log('upholstery-admin-settings: ok');
