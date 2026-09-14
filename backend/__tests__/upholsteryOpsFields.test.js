'use strict';

const {
    pickJobData,
    normalizeMaterialsStatus
} = require('../services/shopJobDataFields');
const { DEFAULT_PACKAGES, DEFAULT_UPHOLSTERY_TEMPLATES } = require('../services/posShopSettings');

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

const furniture = pickJobData({
    itemKind: 'furniture',
    furnitureType: 'sofa',
    furnitureLabel: 'Mid-century sofa',
    furniturePieces: 1,
    seats: 3,
    yards: 12,
    materialsStatus: 'needed',
    partsOrders: [
        {
            vendor: 'Mill',
            status: 'ordered',
            source: 'shop_order',
            lines: [{ name: 'Navy fabric', qty: 12, uom: 'yards', category: 'fabric' }]
        }
    ]
});

assert(furniture.itemKind === 'furniture', 'itemKind persists');
assert(furniture.furnitureType === 'sofa', 'furnitureType persists');
assert(furniture.furnitureLabel === 'Mid-century sofa', 'furnitureLabel persists');
assert(furniture.furniturePieces === 1, 'furniturePieces persists');
assert(furniture.seats === 3, 'seats persists');
assert(furniture.yards === 12, 'yards persists');
assert(furniture.materialsStatus === 'needed', 'explicit materialsStatus kept');
assert(Array.isArray(furniture.partsOrders) && furniture.partsOrders.length === 1, 'partsOrders kept');

const derived = normalizeMaterialsStatus('', [
    { status: 'ordered' },
    { status: 'arrived' }
]);
assert(derived === 'partial', 'partial when mixed');

const received = normalizeMaterialsStatus('', [{ status: 'arrived' }]);
assert(received === 'received', 'all arrived => received');

assert(DEFAULT_PACKAGES.upholstery.some((p) => p.id === 'pkg-sofa'), 'sofa package default');
assert(DEFAULT_PACKAGES.upholstery.some((p) => p.id === 'pkg-dining4'), 'dining package default');
assert(DEFAULT_UPHOLSTERY_TEMPLATES.length >= 4, 'templates seeded');
assert(DEFAULT_UPHOLSTERY_TEMPLATES.some((t) => t.pieceKey === 'sofa'), 'templates have pieceKey');

const { suggestYards } = require('../services/upholsteryYardage');
assert(suggestYards({ furnitureType: 'sofa' }) === 13.2, 'ops check uses yardage engine');

console.log('upholstery-full-app-ops: ok');
