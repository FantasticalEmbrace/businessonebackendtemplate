'use strict';

const {
    calculateYardage,
    suggestYards,
    pieceKeyFromJob
} = require('../services/upholsteryYardage');

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

const sofa = calculateYardage({
    itemKind: 'furniture',
    furnitureType: 'sofa',
    furniturePieces: 1
});
assert(sofa.pieceKey === 'sofa', 'sofa piece key');
assert(sofa.baseYards === 12, `sofa base expected 12 got ${sofa.baseYards}`);
assert(sofa.yards === 13.2, `sofa with 10% waste expected 13.2 got ${sofa.yards}`);

const dining = calculateYardage({
    itemKind: 'furniture',
    furnitureType: 'dining',
    furniturePieces: 4
});
assert(dining.baseYards === 6, `dining 4×1.5 expected 6 got ${dining.baseYards}`);

const seats = calculateYardage({ itemKind: 'vehicle', seats: 2 });
assert(seats.pieceKey === 'seats', 'vehicle seats');
assert(seats.baseYards === 5, `2 seats × 2.5 expected 5 got ${seats.baseYards}`);

const tpl = calculateYardage({ templateId: 'tpl-sofa' });
assert(tpl.yards === 13.2, 'template sofa with waste');

const narrow = calculateYardage({
    furnitureType: 'sofa',
    fabricWidthIn: 48,
    wastePct: 10
});
assert(narrow.yards > sofa.yards, 'narrower fabric needs more yards');

const repeat = calculateYardage({
    furnitureType: 'sofa',
    patternRepeatIn: 24,
    wastePct: 10
});
assert(repeat.yards > sofa.yards, 'pattern repeat adds yards');

assert(suggestYards({ furnitureType: 'ottoman' }) > 0, 'ottoman suggests');
assert(pieceKeyFromJob({ concern: 'sectional recover' }) === 'sectional', 'infer sectional');

console.log('upholsteryYardage: ok');
