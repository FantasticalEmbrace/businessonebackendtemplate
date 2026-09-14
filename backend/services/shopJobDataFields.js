'use strict';

/**
 * Extra fields stored in pos_shop_jobs.job_data_json.
 * Keep columnar filters (status, job_type, customer_id, released_at) on the table.
 *
 * Upholstery ops: jobs are piece-driven (furniture / vehicle / other), not VIN-only.
 * Materials (fabric, foam, COM) are job-allocated via partsOrders lines; collect deposit
 * before special-order goods. Column `vehicle` holds the subject label (piece or YMM).
 */
const JOB_DATA_KEYS = Object.freeze([
    'lines',
    'checklist',
    'bay',
    'insurer',
    'claimNumber',
    'adjuster',
    'deductible',
    'deductibleOwed',
    'deductiblePaid',
    'material',
    'color',
    'tireSize',
    'tireBrand',
    'tireQty',
    'wheelPosition',
    'tpms',
    'deposit',
    'mileage',
    'vin',
    'year',
    'make',
    'model',
    'alignmentType',
    'diagRequests',
    'diagnosticJob',
    'diagDone',
    'diagFindings',
    'diagFindingsSentAt',
    'repairWorkflowExpanded',
    'mountDone',
    'installDone',
    'tpmsDone',
    'repairDone',
    'qcDone',
    'bodyDone',
    'paintDone',
    'detailDone',
    'stripDone',
    'buildDone',
    'photosDone',
    'claimDone',
    'teardownDone',
    'teardownFindings',
    'teardownFindingsSentAt',
    'glassDone',
    'pdrDone',
    'installMode',
    'installSkipped',
    'jobNote',
    'photos',
    'techTime',
    'partsOrders',
    'partsEtaAt',
    'partsEtaNote',
    'partsOrderedAt',
    'stageTimestamps',
    'expressDueAt',
    'expressTargetMinutes',
    'reviewRequestedAt',
    'releasedAt',
    'warrantyFlags',
    'dotCodes',
    'storageSeason',
    'storageLocation',
    'storageFeeLine',
    'inStorage',
    'poNumber',
    'fleetAccountId',
    'netTermsNote',
    'claimEvents',
    'preScan',
    'postScan',
    'adasCalibrated',
    'scanNotes',
    'yards',
    'seats',
    'swatchIds',
    'templateId',
    'depositReminderSentAt',
    'depositCollectedAt',
    'customerId',
    'appointmentId',
    'portalQuestion',
    'portalQuestionAt',
    'paymentTransactionId',
    // Upholstery piece identity + materials gate
    'itemKind',
    'furnitureId',
    'furnitureType',
    'furnitureLabel',
    'furniturePieces',
    'materialSource',
    'materialsStatus',
    'fabricWidthIn',
    'patternRepeatIn',
    'nap',
    'wastePct',
    // Contractor / renovation
    'jobSite',
    'jobSiteLine1',
    'jobSiteLine2',
    'jobSiteCity',
    'jobSiteState',
    'jobSiteZip',
    'workItems',
    'milestonePay',
    'estimateSentAt',
    'leadSource',
    'appointmentDate',
    'appointmentTime',
    'taxRate',
    'subtotal',
    'tax'
]);

function normalizeItemKind(raw) {
    const v = String(raw || '')
        .toLowerCase()
        .trim();
    if (v === 'furniture' || v === 'home' || v === 'piece') return 'furniture';
    if (v === 'vehicle' || v === 'auto' || v === 'car') return 'vehicle';
    if (v === 'other' || v === 'custom' || v === 'marine' || v === 'commercial') return 'other';
    return v || '';
}

function normalizeMaterialSource(raw) {
    const v = String(raw || '')
        .toLowerCase()
        .trim();
    if (v === 'com' || v === 'customer' || v === 'customer_own') return 'com';
    if (v === 'stock' || v === 'on_hand') return 'stock';
    if (v === 'shop_order' || v === 'order' || v === 'ordered') return 'shop_order';
    return v || '';
}

/** Derive materialsStatus from explicit value or partsOrders line statuses. */
function normalizeMaterialsStatus(raw, partsOrders) {
    const v = String(raw || '')
        .toLowerCase()
        .trim();
    if (['none', 'needed', 'ordered', 'partial', 'received'].includes(v)) return v;
    const orders = Array.isArray(partsOrders) ? partsOrders.filter((o) => o && o.status !== 'cancelled') : [];
    if (!orders.length) return 'none';
    const arrived = orders.filter((o) => o.status === 'arrived' || o.arrivedAt).length;
    if (arrived === orders.length) return 'received';
    if (arrived > 0) return 'partial';
    return 'ordered';
}

function normalizePartsEta(partsOrders, existing = {}) {
    const open = (partsOrders || []).filter((o) => o && o.status !== 'cancelled' && o.status !== 'arrived' && !o.arrivedAt);
    if (!open.length) {
        return {
            partsEtaAt: null,
            partsEtaNote: null,
            partsOrderedAt: existing.partsOrderedAt || null
        };
    }
    let earliest = null;
    let note = '';
    let orderedAt = null;
    open.forEach((o) => {
        const atRaw = o.etaAt || o.etaDate;
        if (atRaw) {
            const d = new Date(atRaw);
            if (!Number.isNaN(d.getTime()) && (!earliest || d < earliest)) {
                earliest = d;
                note = String(o.etaNote || '').trim();
            }
        }
        if (o.orderedAt) {
            const od = new Date(o.orderedAt);
            if (!Number.isNaN(od.getTime()) && (!orderedAt || od < orderedAt)) orderedAt = od;
        }
    });
    if (!note && earliest) note = 'Same day from parts house';
    return {
        partsEtaAt: earliest ? earliest.toISOString() : existing.partsEtaAt || null,
        partsEtaNote: note || existing.partsEtaNote || null,
        partsOrderedAt: orderedAt ? orderedAt.toISOString() : existing.partsOrderedAt || open[0]?.orderedAt || null
    };
}

function pickJobData(job = {}) {
    const data = {};
    for (const key of JOB_DATA_KEYS) {
        if (job[key] !== undefined) data[key] = job[key];
    }
    // Defaults / normalization
    data.lines = Array.isArray(data.lines) ? data.lines : [];
    data.checklist = Array.isArray(data.checklist) ? data.checklist : [];
    data.photos = Array.isArray(data.photos) ? data.photos : [];
    data.techTime = Array.isArray(data.techTime) ? data.techTime : [];
    data.partsOrders = Array.isArray(data.partsOrders) ? data.partsOrders : [];
    data.stageTimestamps = data.stageTimestamps && typeof data.stageTimestamps === 'object' ? data.stageTimestamps : {};
    data.warrantyFlags = Array.isArray(data.warrantyFlags) ? data.warrantyFlags : [];
    data.dotCodes = Array.isArray(data.dotCodes) ? data.dotCodes : [];
    data.claimEvents = Array.isArray(data.claimEvents) ? data.claimEvents : [];
    data.swatchIds = Array.isArray(data.swatchIds) ? data.swatchIds : [];
    data.diagRequests = Array.isArray(data.diagRequests) ? data.diagRequests : [];
    data.tpms = Boolean(data.tpms);
    data.diagnosticJob = Boolean(data.diagnosticJob);
    data.diagDone = Boolean(data.diagDone);
    data.repairWorkflowExpanded = Boolean(data.repairWorkflowExpanded);
    [
        'mountDone',
        'installDone',
        'tpmsDone',
        'repairDone',
        'qcDone',
        'bodyDone',
        'paintDone',
        'detailDone',
        'stripDone',
        'buildDone',
        'photosDone',
        'claimDone',
        'teardownDone',
        'glassDone',
        'pdrDone',
        'installSkipped',
        'inStorage',
        'preScan',
        'postScan',
        'adasCalibrated'
    ].forEach((k) => {
        data[k] = Boolean(data[k]);
    });
    data.deposit = Number(data.deposit) || 0;
    data.deductible = Number(data.deductible) || 0;
    data.deductibleOwed = Number(data.deductibleOwed ?? data.deductible) || 0;
    data.deductiblePaid = Number(data.deductiblePaid) || 0;
    data.tireQty = Number(data.tireQty) || 0;
    data.yards = Number(data.yards) || 0;
    data.seats = Number(data.seats) || 0;
    data.furniturePieces = Number(data.furniturePieces) || 0;
    data.alignmentType = data.alignmentType || 'none';
    data.installMode = data.installMode || 'install';
    data.diagFindings = String(data.diagFindings || '');
    data.teardownFindings = String(data.teardownFindings || '');
    data.scanNotes = String(data.scanNotes || '');
    data.itemKind = normalizeItemKind(data.itemKind);
    data.furnitureId = String(data.furnitureId || '').trim();
    data.furnitureType = String(data.furnitureType || '').trim();
    data.furnitureLabel = String(data.furnitureLabel || '').trim();
    data.materialSource = normalizeMaterialSource(data.materialSource);
    data.materialsStatus = normalizeMaterialsStatus(data.materialsStatus, data.partsOrders);
    data.fabricWidthIn = Number(data.fabricWidthIn) || 0;
    data.patternRepeatIn = Number(data.patternRepeatIn) || 0;
    data.nap = Boolean(data.nap);
    data.wastePct = Number(data.wastePct) || 0;
    Object.assign(data, normalizePartsEta(data.partsOrders, data));
    return data;
}

module.exports = {
    JOB_DATA_KEYS,
    pickJobData,
    normalizeItemKind,
    normalizeMaterialSource,
    normalizeMaterialsStatus
};
