'use strict';

const { sendMail, isSmtpConfigured } = require('../utils/mailTransporter');
const { loadPosStoreConfig } = require('./posStoreConfig');
const { buildCustomerPortalUrl } = require('./shopJobPayments');
const shopJobs = require('./shopJobs');

/**
 * Customer-facing shop workflow templates and portal helpers.
 * Admin may customize processes per vertical; defaults ship for all shop types.
 */
const SETTING_CUSTOMER_WORKFLOWS = 'pos_shop_customer_workflows';
const SETTING_PAYMENT_LINK_ENABLED = 'pos_shop_customer_payment_link';

const PROCESS_TYPES = Object.freeze(['waiting', 'inspection', 'decision', 'work', 'complete', 'payment']);

const DIAGNOSTIC_PHASE_KEYS = Object.freeze(['waiting', 'inspection', 'diag_findings', 'decision']);

/** Steps that belong to parts/repair jobs — hidden for express maintenance tickets. */
const REPAIR_ONLY_KEYS = Object.freeze([
    'inspection',
    'diag_findings',
    'decision',
    'pre_work_hold',
    'work_parts',
    'work_repair'
]);

/**
 * Express / maintenance service profiles.
 * These are NOT "parts & repair" jobs — each gets its own work step wording.
 * Anything that does not match an express profile falls back to the repair workflow.
 */
const EXPRESS_SERVICE_PROFILES = Object.freeze([
    {
        kind: 'oil_change',
        workKey: 'work_oil',
        label: 'Oil change in progress',
        description:
            'We are draining the oil, replacing the filter, and refilling with the correct oil for your vehicle.',
        icon: 'oil-can',
        skus: ['LABOR-OIL', 'FILTER-OIL', 'OIL-5W30', 'OIL-5W20', 'OIL-0W20'],
        skuRe: /^(LABOR-OIL|FILTER-OIL|FILTER_OIL|OIL[-_]|.*[-_]OIL[-_]?FILTER|.*OIL[-_]?FILTER)/i,
        nameRe: /\boil\s*change\b|\boil\s*filter\b|\b(synthetic|conventional|blend)\s+oil\b|\b\d+w-?\d+\b.*\boil\b|^\s*oil\b(?!.*essential)/i,
        concernRe: /\boil\s*change\b|^\s*oil\b.*\bfilter\b/i
    },
    {
        kind: 'fluid_service',
        workKey: 'work_fluid',
        label: 'Fluid service in progress',
        description: 'We are flushing and refilling vehicle fluids to specification.',
        icon: 'tint',
        skus: ['LABOR-FLUSH', 'LABOR-COOLANT', 'COOLANT', 'ATF', 'BRAKE-FLUID', 'PS-FLUID'],
        skuRe: /(FLUSH|COOLANT|ATF|TRANS[-_]?FLUID|BRAKE[-_]?FLUID|PS[-_]?FLUID|GEAR[-_]?OIL)/i,
        nameRe: /\b(coolant|radiator)\s*(flush|service)?\b|\btransmission\s*(fluid|flush|service)\b|\bbrake\s*fluid\b|\bpower\s*steering\s*fluid\b|\bfluid\s*(flush|service|exchange)\b/i,
        concernRe: /\b(coolant|transmission|fluid)\s*(flush|service|change)\b/i
    },
    {
        kind: 'battery_service',
        workKey: 'work_battery',
        label: 'Battery service in progress',
        description: 'We are testing and replacing your battery and checking the charging system.',
        icon: 'car-battery',
        skus: ['LABOR-BATT', 'BATT', 'BATTERY'],
        skuRe: /(BATT|BATTERY)/i,
        nameRe: /\bbattery\b/i,
        concernRe: /\bbattery\b/i
    },
    {
        kind: 'filter_service',
        workKey: 'work_filter',
        label: 'Filter service in progress',
        description: 'We are replacing cabin and/or engine air filters.',
        icon: 'wind',
        skus: ['FILTER-AIR', 'FILTER-CABIN', 'CABIN-FILTER', 'AIR-FILTER'],
        skuRe: /(FILTER[-_]?(AIR|CABIN)|CABIN[-_]?FILTER|AIR[-_]?FILTER)/i,
        nameRe: /\b(cabin|engine\s+air|air)\s*filter\b/i,
        concernRe: /\b(cabin|air)\s*filter\b/i
    },
    {
        kind: 'wiper_bulb',
        workKey: 'work_quick',
        label: 'Quick service in progress',
        description: 'We are installing wipers, bulbs, or other quick-service items.',
        icon: 'bolt',
        skus: ['WIPER', 'BULB', 'FUSE', 'LABOR-QUICK'],
        skuRe: /(WIPER|BULB|LAMP|FUSE|LABOR-QUICK)/i,
        nameRe: /\bwiper\b|\bheadlight\b|\btaillight\b|\bbulb\b|\bfuse\b|\bquick\s*service\b/i,
        concernRe: /\bwiper\b|\bbulb\b|\blight\b/i
    },
    {
        kind: 'ac_service',
        workKey: 'work_ac',
        label: 'A/C service in progress',
        description: 'We are servicing your air conditioning system.',
        icon: 'snowflake',
        skus: ['LABOR-AC', 'AC-RECHARGE', 'FREON'],
        skuRe: /(LABOR-AC|\bAC[-_]|FREON|RECHARGE)/i,
        nameRe: /\ba\/?c\b|\bair\s*condition/i,
        concernRe: /\ba\/?c\b|\bair\s*condition|\brecharge\b/i
    },
    {
        kind: 'inspection_service',
        workKey: 'work_inspection',
        label: 'Inspection in progress',
        description: 'We are performing your vehicle inspection.',
        icon: 'clipboard-check',
        skus: ['LABOR-INSP', 'STATE-INSP', 'MPI'],
        skuRe: /(INSP|MPI|STATE[-_]?INSP)/i,
        nameRe: /\b(state\s+)?inspection\b|\bmulti[- ]?point\b|\bsafety\s+inspection\b/i,
        concernRe: /\binspection\b|\bmpi\b/i
    },
    {
        kind: 'tire_service',
        workKey: 'work_tire_svc',
        label: 'Tire service in progress',
        description: 'We are rotating, balancing, or repairing your tires.',
        icon: 'circle',
        skus: ['ROTATE', 'MOUNT-BAL', 'LABOR-TIRE', 'TPMS', 'PATCH'],
        skuRe: /(ROTATE|MOUNT|BALANCE|TPMS|PATCH|PLUG|LABOR-TIRE)/i,
        nameRe: /\btire\s*(rotation|rotate|balance|mount|repair|patch|plug)\b|\brotate\s*(and|&)?\s*balance\b|\btpms\b/i,
        concernRe: /\btire\b|\brotation\b|\btpms\b/i
    }
]);

const EXPRESS_KIND_SET = new Set(EXPRESS_SERVICE_PROFILES.map((p) => p.kind));

/**
 * Body shop work profiles — estimate path stays; work steps follow what’s on the ticket.
 * Unmatched tickets use the full body + paint default.
 */
const BODY_SERVICE_PROFILES = Object.freeze([
    {
        kind: 'body_repair',
        workKey: 'work_body',
        label: 'Body repair',
        description: 'Structural and panel repair work is in progress.',
        icon: 'hammer',
        skus: ['LABOR-BODY', 'PANEL', 'FENDER', 'BUMPER'],
        skuRe: /(LABOR-BODY|BODY[-_]?REPAIR|PANEL|FENDER|DOOR[-_]?SKIN|QUARTER|BUMPER)/i,
        nameRe: /\b(body\s*repair|panel\s*(repair|replace)|fender|bumper\s*(repair|replace)|structural|frame\s*straight)\b/i,
        concernRe: /\b(collision|body\s*damage|panel|fender|bumper|structural)\b/i
    },
    {
        kind: 'paint_refinish',
        workKey: 'work_paint',
        label: 'Paint & refinish',
        description: 'Paint prep, color match, and refinish in the booth.',
        icon: 'spray-can',
        skus: ['LABOR-PAINT', 'PAINT-BASE', 'CLEAR', 'PRIMER'],
        skuRe: /(LABOR-PAINT|PAINT|CLEAR|PRIMER|REFINISH|BLEND)/i,
        nameRe: /\b(paint|refinish|color\s*match|clear\s*coat|blend|booth)\b/i,
        concernRe: /\b(paint|refinish|respray|color\s*match)\b/i
    },
    {
        kind: 'glass_service',
        workKey: 'work_glass',
        label: 'Glass service',
        description: 'Windshield or glass repair/replacement is in progress.',
        icon: 'car',
        skus: ['LABOR-GLASS', 'GLASS', 'WINDSHIELD', 'ADAS'],
        skuRe: /(LABOR-GLASS|WINDSHIELD|GLASS|ADAS)/i,
        nameRe: /\b(windshield|glass|adas\s*calibrat)\b/i,
        concernRe: /\b(windshield|glass|chip|crack)\b/i
    },
    {
        kind: 'pdr',
        workKey: 'work_pdr',
        label: 'Paintless dent repair',
        description: 'We are removing dents without disturbing the factory finish.',
        icon: 'circle',
        skus: ['LABOR-PDR', 'PDR'],
        skuRe: /(LABOR-PDR|\bPDR\b)/i,
        nameRe: /\bpaintless\s*dent\b|\bpdr\b|\bdent\s*repair\b/i,
        concernRe: /\bpdr\b|\bpaintless\b|\bdent\b/i
    }
]);

/**
 * Upholstery work profiles — consultation/estimate stays; fabrication wording follows the job.
 */
const UPHOLSTERY_SERVICE_PROFILES = Object.freeze([
    {
        kind: 'furniture_recover',
        workKey: 'work_furniture',
        label: 'Furniture recover in progress',
        description: 'Your sofa, chairs, or other piece is being stripped, sewn, and recovered on the bench.',
        icon: 'couch',
        skus: ['SOFA-RECOVER', 'CHAIR-RECOVER', 'OTTOMAN-RECOVER', 'LABOR-FURNITURE'],
        skuRe: /(SOFA|CHAIR-RECOVER|OTTOMAN|LABOR-FURNITURE)/i,
        nameRe: /\b(sofa|couch|loveseat|sectional|ottoman|armchair|dining\s*chair|recliner|furniture)\b/i,
        concernRe: /\b(sofa|couch|loveseat|sectional|ottoman|armchair|dining|recliner|furniture)\b/i
    },
    {
        kind: 'seat_recover',
        workKey: 'work_seats',
        label: 'Seat recover in progress',
        description: 'Seat covers are being cut, sewn, and fitted.',
        icon: 'couch',
        skus: ['SEAT-RECOVER', 'SEAT-COVER', 'LABOR-SEAT'],
        skuRe: /(SEAT[-_]?(RECOVER|COVER)|LABOR-SEAT)/i,
        nameRe: /\bseat\s*(recover|re[- ]?cover|cover|upholster)\b|\breupholster\s*seat/i,
        concernRe: /\bseat\s*(recover|re[- ]?cover|cover)?\b|\breupholster\b/
    },
    {
        kind: 'headliner',
        workKey: 'work_headliner',
        label: 'Headliner in progress',
        description: 'We are replacing or repairing your headliner.',
        icon: 'home',
        skus: ['HEADLINER', 'LABOR-HEADLINER'],
        skuRe: /(HEADLINER|LABOR-HEADLINER)/i,
        nameRe: /\bheadliner\b|\bhead\s*liner\b/i,
        concernRe: /\bheadliner\b|\bsagging\s*liner\b/i
    },
    {
        kind: 'leather_vinyl',
        workKey: 'work_leather',
        label: 'Leather & vinyl work',
        description: 'Leather or vinyl is being repaired, dyed, or replaced.',
        icon: 'cut',
        skus: ['LEATHER-BLK', 'LEATHER', 'VINYL-TAN', 'VINYL', 'LABOR-LEATHER'],
        skuRe: /(LEATHER|VINYL|LABOR-LEATHER)/i,
        nameRe: /\bleather\b|\bvinyl\b|\bdye\b|\bstitch\s*repair\b/i,
        concernRe: /\bleather\b|\bvinyl\b|\btear\b|\bstitch\b/i
    },
    {
        kind: 'convertible_top',
        workKey: 'work_convertible',
        label: 'Convertible top in progress',
        description: 'We are repairing or replacing your convertible top.',
        icon: 'car',
        skus: ['CONVERTIBLE-TOP', 'LABOR-TOP', 'SOFT-TOP'],
        skuRe: /(CONVERTIBLE|SOFT[-_]?TOP|LABOR-TOP)/i,
        nameRe: /\bconvertible\s*top\b|\bsoft\s*top\b|\btop\s*(replace|repair)\b/i,
        concernRe: /\bconvertible\b|\bsoft\s*top\b/i
    }
]);

const BODY_KIND_SET = new Set(BODY_SERVICE_PROFILES.map((p) => p.kind));
const UPHOLSTERY_KIND_SET = new Set(UPHOLSTERY_SERVICE_PROFILES.map((p) => p.kind));

function jobVertical(job) {
    const v = String(job?.jobType || job?.mode || 'auto')
        .trim()
        .toLowerCase();
    if (v === 'tire' || v === 'body' || v === 'upholstery' || v === 'auto') return v;
    return 'auto';
}

function jobHasDiagnostics(job) {
    if (!job) return false;
    if (job.diagnosticJob === true) return true;
    if (Array.isArray(job.diagRequests) && job.diagRequests.length) return true;
    if ((job.lines || []).some((l) => l.diagType === 'free' || l.diagType === 'billable')) return true;
    const diagSkus = new Set(['LABOR-DIAG', 'LABOR-DIAG-FREE']);
    return (job.lines || []).some((l) => {
        const sku = String(l.sku || l.productSku || '').toUpperCase();
        return diagSkus.has(sku);
    });
}

function lineSku(line) {
    return String(line?.sku || line?.productSku || '').trim().toUpperCase();
}

function lineName(line) {
    return String(line?.name || line?.productName || line?.description || line?.title || '').trim();
}

function jobConcernText(job) {
    return String(job?.concern || job?.title || job?.serviceType || job?.jobLabel || '').trim();
}

function lineMatchesServiceProfile(line, profile) {
    const sku = lineSku(line);
    const name = lineName(line);
    if (sku && Array.isArray(profile.skus) && profile.skus.some((s) => sku === String(s).toUpperCase())) {
        return true;
    }
    if (sku && profile.skuRe && profile.skuRe.test(sku) && !/(COIL|FOIL|BOIL)/i.test(sku)) return true;
    if (name && profile.nameRe && profile.nameRe.test(name)) return true;
    return false;
}

function concernMatchesServiceProfile(job, profile) {
    const concern = jobConcernText(job);
    if (!concern || !profile.concernRe) return false;
    return profile.concernRe.test(concern);
}

/** @deprecated use lineMatchesServiceProfile */
function lineMatchesExpressProfile(line, profile) {
    return lineMatchesServiceProfile(line, profile);
}

/** @deprecated use concernMatchesServiceProfile */
function concernMatchesExpressProfile(job, profile) {
    return concernMatchesServiceProfile(job, profile);
}

/** Hard parts/repair labor — forces the repair workflow even if express items are also present. */
function lineLooksLikePartsRepair(line) {
    const sku = lineSku(line);
    const name = lineName(line);
    if (EXPRESS_SERVICE_PROFILES.some((p) => lineMatchesServiceProfile(line, p))) return false;
    if (/^LABOR-DIAG/i.test(sku)) return true;
    if (/^LABOR-/i.test(sku)) {
        // Express labor SKUs are already excluded above via profile match
        return true;
    }
    if (
        /\b(brake\s*pad|rotor|caliper|suspension|strut|shock|alternator|starter|timing\s*belt|water\s*pump|control\s*arm|ball\s*joint|cv\s*axle|wheel\s*bearing|engine\s*repair|transmission\s*repair|body\s*repair)\b/i.test(
            name
        )
    ) {
        return true;
    }
    // Generic "parts" category lines that are not express fluids/filters
    const cat = String(line.categoryName || line.category || '').toLowerCase();
    if (cat === 'parts' || cat === 'body parts') return true;
    return false;
}

function matchedProfilesForList(job, profiles) {
    const lines = Array.isArray(job?.lines) ? job.lines : [];
    const matched = [];
    for (const profile of profiles) {
        const fromLines = lines.some((l) => lineMatchesServiceProfile(l, profile));
        const fromConcern = !lines.length && concernMatchesServiceProfile(job, profile);
        if (fromLines || fromConcern) matched.push(profile);
    }
    return matched;
}

function matchedExpressProfiles(job) {
    return matchedProfilesForList(job, EXPRESS_SERVICE_PROFILES);
}

function matchedBodyProfiles(job) {
    return matchedProfilesForList(job, BODY_SERVICE_PROFILES);
}

function matchedUpholsteryProfiles(job) {
    return matchedProfilesForList(job, UPHOLSTERY_SERVICE_PROFILES);
}

/**
 * Express-only ticket (auto vertical): has express service line(s) and no parts/repair labor.
 * Mixed tickets (oil + brakes) stay on the repair workflow.
 * Body / upholstery / tire never use auto express framing.
 */
function isExpressServiceJob(job) {
    if (!job || jobVertical(job) !== 'auto') return false;
    if (jobHasDiagnostics(job)) return false;
    const matched = matchedExpressProfiles(job);
    if (!matched.length) return false;
    const lines = Array.isArray(job.lines) ? job.lines : [];
    if (lines.some(lineLooksLikePartsRepair)) return false;
    return true;
}

function isOilChangeJob(job) {
    return matchedExpressProfiles(job).some((p) => p.kind === 'oil_change') && isExpressServiceJob(job);
}

function lineLooksLikeOilService(line) {
    const oil = EXPRESS_SERVICE_PROFILES.find((p) => p.kind === 'oil_change');
    return oil ? lineMatchesServiceProfile(line, oil) : false;
}

function inferJobServiceKind(job) {
    const vertical = jobVertical(job);
    const lines = Array.isArray(job?.lines) ? job.lines : [];
    if (vertical === 'body') {
        const matched = lines.length ? matchedBodyProfiles(job) : [];
        if (matched.length === 1) return matched[0].kind;
        if (matched.length > 1) return 'body_multi';
        return 'body_full';
    }
    if (vertical === 'upholstery') {
        const kind = String(job?.itemKind || '').toLowerCase();
        if (kind === 'furniture' || kind === 'other' || job?.furnitureType || job?.furnitureLabel) {
            const matched = lines.length ? matchedUpholsteryProfiles(job) : [];
            if (matched.some((p) => p.kind === 'furniture_recover')) return 'furniture_recover';
            if (matched.length === 1) return matched[0].kind;
            if (matched.length > 1) return 'upholstery_multi';
            return 'furniture_recover';
        }
        const matched = lines.length ? matchedUpholsteryProfiles(job) : [];
        if (matched.length === 1) return matched[0].kind;
        if (matched.length > 1) return 'upholstery_multi';
        return 'upholstery_full';
    }
    if (jobHasDiagnostics(job)) return 'diagnostic';
    if (isExpressServiceJob(job)) {
        const matched = matchedExpressProfiles(job);
        if (matched.length === 1) return matched[0].kind;
        return 'express';
    }
    return 'repair';
}

function defaultWorkStepForProfile(profile, sortOrder = 3) {
    return {
        id: profile.workKey,
        key: profile.workKey,
        type: 'work',
        label: profile.label,
        description: profile.description,
        sortOrder,
        icon: profile.icon || 'cog',
        productIds: [],
        skus: profile.skus || [],
        customerCanAct: false,
        optional: false,
        serviceKinds: [profile.kind, 'express']
    };
}

function isDiagnosticPhasedJob(job) {
    return jobHasDiagnostics(job) && !job?.repairWorkflowExpanded;
}

function expandRepairWorkflowPatch(job) {
    if (jobHasDiagnostics(job)) return { repairWorkflowExpanded: true };
    if (jobVertical(job) === 'body' && jobHasInsurance(job)) return { repairWorkflowExpanded: true };
    return {};
}

const DEFAULT_WORKFLOWS = {
    tire: {
        paymentLinkEnabled: true,
        processes: [
            {
                id: 'waiting',
                key: 'waiting',
                type: 'waiting',
                label: 'Waiting to be seen',
                description: 'Your vehicle is checked in and in our service queue.',
                sortOrder: 0,
                icon: 'clock',
                productIds: [],
                skus: [],
                customerCanAct: false
            },
            {
                id: 'inspection',
                key: 'inspection',
                type: 'inspection',
                label: 'Tire inspection',
                description: 'We are inspecting tread wear, sidewalls, and recommending the right tires for your vehicle.',
                sortOrder: 1,
                icon: 'search',
                productIds: [],
                skus: [],
                customerCanAct: false
            },
            {
                id: 'decision',
                key: 'decision',
                type: 'decision',
                label: 'Your decision',
                description: 'Review your quote and approve the recommended services, or contact us with questions.',
                sortOrder: 2,
                icon: 'clipboard-check',
                productIds: [],
                skus: [],
                customerCanAct: true
            },
            {
                id: 'work_mount',
                key: 'work_mount',
                type: 'work',
                label: 'Mounting tires',
                description: 'Your new tires are being mounted on the wheels.',
                sortOrder: 3,
                icon: 'cog',
                productIds: [],
                skus: ['MOUNT-BAL'],
                customerCanAct: false
            },
            {
                id: 'work_rotate',
                key: 'work_rotate',
                type: 'work',
                label: 'Rotate & balance',
                description: 'Wheels are being rotated and balanced for a smooth ride.',
                sortOrder: 4,
                icon: 'sync',
                productIds: [],
                skus: ['ROTATE', 'MOUNT-BAL'],
                customerCanAct: false
            },
            {
                id: 'work_align',
                key: 'work_align',
                type: 'work',
                label: 'Alignment',
                description: 'Performing wheel alignment to manufacturer specification.',
                sortOrder: 5,
                icon: 'ruler-combined',
                productIds: [],
                skus: ['ALIGN-2', 'ALIGN-4'],
                customerCanAct: false,
                optional: true
            },
            {
                id: 'complete',
                key: 'complete',
                type: 'complete',
                label: 'Service complete',
                description: 'Your vehicle is ready. Thank you for choosing us.',
                sortOrder: 6,
                icon: 'check-circle',
                productIds: [],
                skus: [],
                customerCanAct: false
            },
            {
                id: 'payment',
                key: 'payment',
                type: 'payment',
                label: 'Payment',
                description: 'Pay online or at the front desk when you pick up.',
                sortOrder: 7,
                icon: 'credit-card',
                productIds: [],
                skus: [],
                customerCanAct: true
            }
        ]
    },
    auto: {
        paymentLinkEnabled: true,
        processes: [
            {
                id: 'waiting',
                key: 'waiting',
                type: 'waiting',
                label: 'Waiting to be seen',
                description: 'Your vehicle is in our service queue.',
                sortOrder: 0,
                icon: 'clock',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['*']
            },
            {
                id: 'inspection',
                key: 'inspection',
                type: 'inspection',
                label: 'Inspection & diagnosis',
                description: 'A technician is inspecting your vehicle and documenting findings.',
                sortOrder: 1,
                icon: 'search',
                productIds: [],
                skus: ['LABOR-DIAG'],
                customerCanAct: false,
                serviceKinds: ['repair', 'diagnostic']
            },
            {
                id: 'diag_findings',
                key: 'diag_findings',
                type: 'inspection',
                label: 'Technician findings',
                description: 'Your technician has shared inspection results. Review what we found before approving repair work.',
                sortOrder: 2,
                icon: 'clipboard-list',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['diagnostic']
            },
            {
                id: 'decision',
                key: 'decision',
                type: 'decision',
                label: 'Your decision',
                description: 'Review the estimate and approve recommended repairs.',
                sortOrder: 3,
                icon: 'clipboard-check',
                productIds: [],
                skus: [],
                customerCanAct: true,
                serviceKinds: ['repair', 'diagnostic']
            },
            {
                id: 'pre_work_hold',
                key: 'pre_work_hold',
                type: 'waiting',
                label: 'Approved — waiting to begin',
                description: 'Your estimate is approved. We will begin work shortly.',
                sortOrder: 4,
                icon: 'hourglass',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['repair', 'diagnostic']
            },
            {
                id: 'work_parts',
                key: 'work_parts',
                type: 'work',
                label: 'Parts & preparation',
                description: 'We ordered parts for your repair. Most arrive same day from the parts house — we will update you with timing.',
                sortOrder: 5,
                icon: 'boxes',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['repair', 'diagnostic']
            },
            {
                id: 'work_repair',
                key: 'work_repair',
                type: 'work',
                label: 'Repair in progress',
                description: 'Your vehicle is in the bay and work is underway.',
                sortOrder: 6,
                icon: 'wrench',
                productIds: [],
                skus: ['LABOR-BRK', 'LABOR-DIAG'],
                customerCanAct: false,
                serviceKinds: ['repair', 'diagnostic']
            },
            {
                id: 'work_oil',
                key: 'work_oil',
                type: 'work',
                label: 'Oil change in progress',
                description:
                    'We are draining the oil, replacing the filter, and refilling with the correct oil for your vehicle.',
                sortOrder: 3,
                icon: 'oil-can',
                productIds: [],
                skus: ['LABOR-OIL', 'FILTER-OIL', 'OIL-5W30', 'OIL-5W20', 'OIL-0W20'],
                customerCanAct: false,
                serviceKinds: ['oil_change', 'express']
            },
            {
                id: 'work_fluid',
                key: 'work_fluid',
                type: 'work',
                label: 'Fluid service in progress',
                description: 'We are flushing and refilling vehicle fluids to specification.',
                sortOrder: 3,
                icon: 'tint',
                productIds: [],
                skus: ['LABOR-FLUSH', 'LABOR-COOLANT', 'COOLANT', 'ATF'],
                customerCanAct: false,
                serviceKinds: ['fluid_service', 'express']
            },
            {
                id: 'work_battery',
                key: 'work_battery',
                type: 'work',
                label: 'Battery service in progress',
                description: 'We are testing and replacing your battery and checking the charging system.',
                sortOrder: 3,
                icon: 'car-battery',
                productIds: [],
                skus: ['LABOR-BATT', 'BATT', 'BATTERY'],
                customerCanAct: false,
                serviceKinds: ['battery_service', 'express']
            },
            {
                id: 'work_filter',
                key: 'work_filter',
                type: 'work',
                label: 'Filter service in progress',
                description: 'We are replacing cabin and/or engine air filters.',
                sortOrder: 3,
                icon: 'wind',
                productIds: [],
                skus: ['FILTER-AIR', 'FILTER-CABIN', 'CABIN-FILTER', 'AIR-FILTER'],
                customerCanAct: false,
                serviceKinds: ['filter_service', 'express']
            },
            {
                id: 'work_quick',
                key: 'work_quick',
                type: 'work',
                label: 'Quick service in progress',
                description: 'We are installing wipers, bulbs, or other quick-service items.',
                sortOrder: 3,
                icon: 'bolt',
                productIds: [],
                skus: ['WIPER', 'BULB', 'FUSE', 'LABOR-QUICK'],
                customerCanAct: false,
                serviceKinds: ['wiper_bulb', 'express']
            },
            {
                id: 'work_ac',
                key: 'work_ac',
                type: 'work',
                label: 'A/C service in progress',
                description: 'We are servicing your air conditioning system.',
                sortOrder: 3,
                icon: 'snowflake',
                productIds: [],
                skus: ['LABOR-AC', 'AC-RECHARGE', 'FREON'],
                customerCanAct: false,
                serviceKinds: ['ac_service', 'express']
            },
            {
                id: 'work_inspection',
                key: 'work_inspection',
                type: 'work',
                label: 'Inspection in progress',
                description: 'We are performing your vehicle inspection.',
                sortOrder: 3,
                icon: 'clipboard-check',
                productIds: [],
                skus: ['LABOR-INSP', 'STATE-INSP', 'MPI'],
                customerCanAct: false,
                serviceKinds: ['inspection_service', 'express']
            },
            {
                id: 'work_tire_svc',
                key: 'work_tire_svc',
                type: 'work',
                label: 'Tire service in progress',
                description: 'We are rotating, balancing, or repairing your tires.',
                sortOrder: 3,
                icon: 'circle',
                productIds: [],
                skus: ['ROTATE', 'MOUNT-BAL', 'LABOR-TIRE', 'TPMS', 'PATCH'],
                customerCanAct: false,
                serviceKinds: ['tire_service', 'express']
            },
            {
                id: 'work_qc',
                key: 'work_qc',
                type: 'work',
                label: 'Quality check',
                description: 'Final inspection and road test before pickup.',
                sortOrder: 7,
                icon: 'check-double',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['*']
            },
            {
                id: 'complete',
                key: 'complete',
                type: 'complete',
                label: 'Service complete',
                description: 'Your vehicle is ready for pickup.',
                sortOrder: 8,
                icon: 'check-circle',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['*']
            },
            {
                id: 'payment',
                key: 'payment',
                type: 'payment',
                label: 'Payment',
                description: 'Pay online or at the counter when you arrive.',
                sortOrder: 9,
                icon: 'credit-card',
                productIds: [],
                skus: [],
                customerCanAct: true,
                serviceKinds: ['*']
            }
        ]
    },
    body: {
        paymentLinkEnabled: true,
        processes: [
            {
                id: 'waiting',
                key: 'waiting',
                type: 'waiting',
                label: 'Waiting to be seen',
                description: 'Your vehicle is checked in at our collision center.',
                sortOrder: 0,
                icon: 'clock',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['*']
            },
            {
                id: 'inspection',
                key: 'inspection',
                type: 'inspection',
                label: 'Damage inspection',
                description: 'We are photographing damage and preparing your repair plan.',
                sortOrder: 1,
                icon: 'camera',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['*']
            },
            {
                id: 'teardown_findings',
                key: 'teardown_findings',
                type: 'inspection',
                label: 'Teardown findings',
                description:
                    'After teardown we found additional damage. Review the update before authorizing the repair.',
                sortOrder: 2,
                icon: 'clipboard-list',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['insurance']
            },
            {
                id: 'decision',
                key: 'decision',
                type: 'decision',
                label: 'Estimate approval',
                description: 'Review the repair estimate and authorize work to begin.',
                sortOrder: 3,
                icon: 'clipboard-check',
                productIds: [],
                skus: [],
                customerCanAct: true,
                serviceKinds: ['*']
            },
            {
                id: 'work_body',
                key: 'work_body',
                type: 'work',
                label: 'Body repair',
                description: 'Structural and panel repair work is in progress.',
                sortOrder: 4,
                icon: 'hammer',
                productIds: [],
                skus: ['LABOR-BODY'],
                customerCanAct: false,
                serviceKinds: ['body_repair', 'body_full', 'body_multi']
            },
            {
                id: 'work_paint',
                key: 'work_paint',
                type: 'work',
                label: 'Paint & refinish',
                description: 'Paint prep, color match, and refinish in the booth.',
                sortOrder: 5,
                icon: 'spray-can',
                productIds: [],
                skus: ['LABOR-PAINT', 'PAINT-BASE', 'CLEAR'],
                customerCanAct: false,
                serviceKinds: ['paint_refinish', 'body_full', 'body_multi']
            },
            {
                id: 'work_glass',
                key: 'work_glass',
                type: 'work',
                label: 'Glass service',
                description: 'Windshield or glass repair/replacement is in progress.',
                sortOrder: 4,
                icon: 'car',
                productIds: [],
                skus: ['LABOR-GLASS', 'WINDSHIELD', 'GLASS'],
                customerCanAct: false,
                serviceKinds: ['glass_service']
            },
            {
                id: 'work_pdr',
                key: 'work_pdr',
                type: 'work',
                label: 'Paintless dent repair',
                description: 'We are removing dents without disturbing the factory finish.',
                sortOrder: 4,
                icon: 'circle',
                productIds: [],
                skus: ['LABOR-PDR', 'PDR'],
                customerCanAct: false,
                serviceKinds: ['pdr']
            },
            {
                id: 'work_detail',
                key: 'work_detail',
                type: 'work',
                label: 'Reassembly & detail',
                description: 'Trim is being reinstalled and the vehicle is detailed for delivery.',
                sortOrder: 6,
                icon: 'sparkles',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['body_repair', 'paint_refinish', 'body_full', 'body_multi']
            },
            {
                id: 'complete',
                key: 'complete',
                type: 'complete',
                label: 'Ready for delivery',
                description: 'Repairs are complete and your vehicle is ready.',
                sortOrder: 7,
                icon: 'check-circle',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['*']
            },
            {
                id: 'payment',
                key: 'payment',
                type: 'payment',
                label: 'Payment',
                description: 'Pay your deductible or balance online or at the counter.',
                sortOrder: 8,
                icon: 'credit-card',
                productIds: [],
                skus: [],
                customerCanAct: true,
                serviceKinds: ['*']
            }
        ]
    },
    upholstery: {
        paymentLinkEnabled: true,
        processes: [
            {
                id: 'waiting',
                key: 'waiting',
                type: 'waiting',
                label: 'Waiting for consultation',
                description: 'We have your project checked in and will be with you shortly.',
                sortOrder: 0,
                icon: 'clock',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['*']
            },
            {
                id: 'inspection',
                key: 'inspection',
                type: 'inspection',
                label: 'Consultation & measure',
                description: 'We are reviewing materials, color, and scope with you.',
                sortOrder: 1,
                icon: 'ruler',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['*']
            },
            {
                id: 'decision',
                key: 'decision',
                type: 'decision',
                label: 'Approve estimate',
                description: 'Review labor, materials, and deposit — approve to start work.',
                sortOrder: 2,
                icon: 'clipboard-check',
                productIds: [],
                skus: ['DEPOSIT'],
                customerCanAct: true,
                serviceKinds: ['*']
            },
            {
                id: 'work_prep',
                key: 'work_prep',
                type: 'waiting',
                label: 'Materials & preparation',
                description: 'We are ordering or staging fabric and materials before bench work begins.',
                sortOrder: 2.5,
                icon: 'boxes',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['*']
            },
            {
                id: 'materials_ordered',
                key: 'materials_ordered',
                type: 'waiting',
                label: 'Fabric ordered',
                description: 'Your fabric or materials have been ordered from the supplier (or COM is expected).',
                sortOrder: 2.6,
                icon: 'truck',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['*'],
                materialsStatuses: ['ordered', 'needed']
            },
            {
                id: 'materials_received',
                key: 'materials_received',
                type: 'waiting',
                label: 'Fabric received',
                description: 'Materials are in the shop and inspected — production can begin.',
                sortOrder: 2.7,
                icon: 'package',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['*'],
                materialsStatuses: ['received', 'partial']
            },
            {
                id: 'work_fabrication',
                key: 'work_fabrication',
                type: 'work',
                label: 'Fabrication',
                description: 'Materials are being cut, sewn, and prepared on the bench.',
                sortOrder: 3,
                icon: 'cut',
                productIds: [],
                skus: ['SEAT-RECOVER', 'HEADLINER', 'LEATHER-BLK', 'VINYL-TAN', 'SOFA-RECOVER', 'CHAIR-RECOVER'],
                customerCanAct: false,
                serviceKinds: ['upholstery_full', 'upholstery_multi']
            },
            {
                id: 'work_furniture',
                key: 'work_furniture',
                type: 'work',
                label: 'Furniture recover in progress',
                description: 'Your sofa, chairs, or other piece is being stripped, sewn, and recovered on the bench.',
                sortOrder: 3,
                icon: 'couch',
                productIds: [],
                skus: ['SOFA-RECOVER', 'CHAIR-RECOVER', 'OTTOMAN-RECOVER', 'LABOR-FURNITURE'],
                customerCanAct: false,
                serviceKinds: ['furniture_recover']
            },
            {
                id: 'work_seats',
                key: 'work_seats',
                type: 'work',
                label: 'Seat recover in progress',
                description: 'Seat covers are being cut, sewn, and fitted.',
                sortOrder: 3,
                icon: 'couch',
                productIds: [],
                skus: ['SEAT-RECOVER', 'SEAT-COVER', 'LABOR-SEAT'],
                customerCanAct: false,
                serviceKinds: ['seat_recover']
            },
            {
                id: 'work_headliner',
                key: 'work_headliner',
                type: 'work',
                label: 'Headliner in progress',
                description: 'We are replacing or repairing your headliner.',
                sortOrder: 3,
                icon: 'home',
                productIds: [],
                skus: ['HEADLINER', 'LABOR-HEADLINER'],
                customerCanAct: false,
                serviceKinds: ['headliner']
            },
            {
                id: 'work_leather',
                key: 'work_leather',
                type: 'work',
                label: 'Leather & vinyl work',
                description: 'Leather or vinyl is being repaired, dyed, or replaced.',
                sortOrder: 3,
                icon: 'cut',
                productIds: [],
                skus: ['LEATHER-BLK', 'LEATHER', 'VINYL-TAN', 'VINYL'],
                customerCanAct: false,
                serviceKinds: ['leather_vinyl']
            },
            {
                id: 'work_convertible',
                key: 'work_convertible',
                type: 'work',
                label: 'Convertible top in progress',
                description: 'We are repairing or replacing your convertible top.',
                sortOrder: 3,
                icon: 'car',
                productIds: [],
                skus: ['CONVERTIBLE-TOP', 'LABOR-TOP', 'SOFT-TOP'],
                customerCanAct: false,
                serviceKinds: ['convertible_top']
            },
            {
                id: 'work_install',
                key: 'work_install',
                type: 'work',
                label: 'Install / deliver',
                description: 'Finished work is being installed in the vehicle or delivered / placed.',
                sortOrder: 4,
                icon: 'couch',
                productIds: [],
                skus: [],
                customerCanAct: false,
                optional: true,
                serviceKinds: ['*']
            },
            {
                id: 'complete',
                key: 'complete',
                type: 'complete',
                label: 'Ready for pickup',
                description: 'Your upholstery work is complete.',
                sortOrder: 5,
                icon: 'check-circle',
                productIds: [],
                skus: [],
                customerCanAct: false,
                serviceKinds: ['*']
            },
            {
                id: 'payment',
                key: 'payment',
                type: 'payment',
                label: 'Payment',
                description: 'Pay the remaining balance online or when you pick up.',
                sortOrder: 6,
                icon: 'credit-card',
                productIds: [],
                skus: [],
                customerCanAct: true,
                serviceKinds: ['*']
            }
        ]
    }
};

function cloneJson(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function normalizeProcess(p, index = 0) {
    const type = PROCESS_TYPES.includes(p?.type) ? p.type : 'work';
    const serviceKinds = Array.isArray(p?.serviceKinds)
        ? p.serviceKinds.map((k) => String(k).trim()).filter(Boolean)
        : [];
    return {
        id: String(p?.id || p?.key || `step_${index}`),
        key: String(p?.key || p?.id || `step_${index}`),
        type,
        label: String(p?.label || 'Step').trim() || 'Step',
        description: String(p?.description || '').trim(),
        sortOrder: Number.isFinite(Number(p?.sortOrder)) ? Number(p.sortOrder) : index,
        icon: String(p?.icon || 'circle').trim() || 'circle',
        productIds: Array.isArray(p?.productIds) ? p.productIds.map(String) : [],
        skus: Array.isArray(p?.skus) ? p.skus.map((s) => String(s).trim()).filter(Boolean) : [],
        customerCanAct: Boolean(p?.customerCanAct),
        optional: Boolean(p?.optional),
        serviceKinds,
        materialsStatuses: Array.isArray(p?.materialsStatuses)
            ? p.materialsStatuses.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
            : undefined
    };
}

function mergeVerticalWorkflow(vertical, custom) {
    const base = cloneJson(DEFAULT_WORKFLOWS[vertical] || DEFAULT_WORKFLOWS.auto);
    if (!custom) return base;
    const processes = Array.isArray(custom.processes) && custom.processes.length
        ? custom.processes.map(normalizeProcess).sort((a, b) => a.sortOrder - b.sortOrder)
        : base.processes;
    return {
        paymentLinkEnabled: custom.paymentLinkEnabled != null ? Boolean(custom.paymentLinkEnabled) : base.paymentLinkEnabled,
        processes
    };
}

async function loadSettingMap(pool, keys) {
    if (!pool || !keys.length) return new Map();
    try {
        const placeholders = keys.map(() => '?').join(', ');
        const [rows] = await pool.execute(
            `SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`,
            keys
        );
        return new Map((rows || []).map((r) => [r.key_name, r.value]));
    } catch {
        return new Map();
    }
}

async function loadCustomerWorkflowConfig(pool) {
    const map = await loadSettingMap(pool, [SETTING_CUSTOMER_WORKFLOWS, SETTING_PAYMENT_LINK_ENABLED]);
    let parsed = {};
    try {
        parsed = JSON.parse(map.get(SETTING_CUSTOMER_WORKFLOWS) || '{}');
    } catch {
        parsed = {};
    }
    const globalPayLink = String(map.get(SETTING_PAYMENT_LINK_ENABLED) ?? 'true').toLowerCase() !== 'false';
    const verticals = {};
    Object.keys(DEFAULT_WORKFLOWS).forEach((v) => {
        verticals[v] = mergeVerticalWorkflow(v, parsed?.verticals?.[v] || parsed[v] || null);
        if (parsed?.paymentLinkEnabled != null) {
            verticals[v].paymentLinkEnabled = Boolean(parsed.paymentLinkEnabled);
        } else if (!verticals[v].paymentLinkEnabled && globalPayLink) {
            verticals[v].paymentLinkEnabled = globalPayLink;
        }
    });
    return { paymentLinkEnabled: globalPayLink, verticals };
}

async function saveCustomerWorkflowConfig(pool, payload) {
    const body = payload && typeof payload === 'object' ? payload : {};
    const toStore = {
        paymentLinkEnabled: body.paymentLinkEnabled !== false,
        verticals: {}
    };
    Object.keys(DEFAULT_WORKFLOWS).forEach((v) => {
        const src = body.verticals?.[v] || body[v];
        if (src) {
            toStore.verticals[v] = {
                paymentLinkEnabled: src.paymentLinkEnabled !== false,
                processes: (src.processes || []).map(normalizeProcess)
            };
        }
    });
    const json = JSON.stringify(toStore);
    await pool.execute(
        `INSERT INTO settings (key_name, value, description, type)
         VALUES (?, ?, 'Customer shop workflow processes by vertical', 'json')
         ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = CURRENT_TIMESTAMP`,
        [SETTING_CUSTOMER_WORKFLOWS, json]
    );
    await pool.execute(
        `INSERT INTO settings (key_name, value, description, type)
         VALUES (?, ?, 'Enable customer payment links on shop workflow portal', 'boolean')
         ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = CURRENT_TIMESTAMP`,
        [SETTING_PAYMENT_LINK_ENABLED, toStore.paymentLinkEnabled ? 'true' : 'false']
    );
    return loadCustomerWorkflowConfig(pool);
}

function jobLineSkus(job) {
    return (job?.lines || []).flatMap((l) => {
        const sku = l.sku || l.productSku;
        return sku ? [String(sku).toUpperCase()] : [];
    });
}

function processServiceKinds(process) {
    const kinds = Array.isArray(process?.serviceKinds) ? process.serviceKinds : [];
    return kinds.map((k) => String(k).trim()).filter(Boolean);
}

function processAppliesToServiceKind(process, serviceKind) {
    const kinds = processServiceKinds(process);
    if (!kinds.length || kinds.includes('*')) return true;
    return kinds.includes(serviceKind);
}

function processAppliesToJob(process, job) {
    const vertical = jobVertical(job);
    const serviceKind = inferJobServiceKind(job);
    const kinds = processServiceKinds(process);

    // Body / upholstery / tire: keep estimate path; work steps filtered in resolveProcessesForJob.
    if (vertical !== 'auto') {
        if (process.key === 'materials_ordered' || process.key === 'materials_received') {
            return optionalProcessApplies(process, job);
        }
        if (kinds.length && !kinds.includes('*') && process.type === 'work') {
            // Defer specialized work filtering to resolveProfiledWorkProcesses
            return true;
        }
        if (!process.optional) return true;
        return optionalProcessApplies(process, job);
    }

    const express = isExpressServiceJob(job);
    const matchedSpecific = new Set(matchedExpressProfiles(job).map((p) => p.kind));

    // Express maintenance tickets never show parts/repair framing.
    if (express && REPAIR_ONLY_KEYS.includes(process.key)) {
        return false;
    }

    if (kinds.length && !kinds.includes('*')) {
        if (express) {
            // Work steps must match a specific express profile on this job (not just "express").
            if (process.type === 'work' && process.key !== 'work_qc') {
                const specific = kinds.filter((k) => EXPRESS_KIND_SET.has(k));
                if (specific.length) {
                    if (!specific.some((k) => matchedSpecific.has(k))) return false;
                } else if (kinds.includes('express') && !matchedSpecific.size) {
                    return false;
                } else if (!kinds.includes('express') && !specific.length) {
                    return false;
                }
            } else if (['inspection', 'decision'].includes(process.type)) {
                return false;
            }
        } else {
            // Repair / diagnostic tickets: require kind match; hide express-only steps.
            const allowsRepair =
                kinds.includes('repair') ||
                kinds.includes('diagnostic') ||
                (serviceKind === 'diagnostic' && kinds.includes('diagnostic'));
            const expressOnly =
                kinds.some((k) => EXPRESS_KIND_SET.has(k) || k === 'express') &&
                !kinds.includes('repair') &&
                !kinds.includes('diagnostic');
            if (expressOnly) return false;
            if (!allowsRepair && !processAppliesToServiceKind(process, serviceKind)) {
                return false;
            }
            if (serviceKind === 'repair' && kinds.includes('diagnostic') && !kinds.includes('repair')) {
                // diag_findings etc. only on diagnostic jobs
                if (!jobHasDiagnostics(job)) return false;
            }
        }
    }

    if (!process.optional) return true;
    return optionalProcessApplies(process, job);
}

function jobHasInsurance(job) {
    if (!job) return false;
    if (job.insuranceWorkflow === true) return true;
    if (String(job.insurer || '').trim()) return true;
    if (String(job.claimNumber || '').trim()) return true;
    return false;
}

function isBodyInsurancePhasedJob(job) {
    return jobVertical(job) === 'body' && jobHasInsurance(job) && Boolean(job?.teardownDone) && !job?.repairWorkflowExpanded;
}

function isUpholsteryInstallSkipped(job) {
    if (!job) return false;
    if (job.installSkipped === true) return true;
    const mode = String(job.installMode || '').toLowerCase().trim();
    return mode === 'pickup' || mode === 'pickup_only' || mode === 'none';
}

function materialsStatusOf(job) {
    const raw = String(job?.materialsStatus || '')
        .toLowerCase()
        .trim();
    if (['none', 'needed', 'ordered', 'partial', 'received'].includes(raw)) return raw;
    const orders = Array.isArray(job?.partsOrders) ? job.partsOrders.filter((o) => o && o.status !== 'cancelled') : [];
    if (!orders.length) return 'none';
    const arrived = orders.filter((o) => o.status === 'arrived' || o.arrivedAt).length;
    if (arrived === orders.length) return 'received';
    if (arrived > 0) return 'partial';
    return 'ordered';
}

function formatPartsEtaDisplay(source) {
    if (!source) return '';
    const atRaw = source.etaAt || source.partsEtaAt;
    const note = String(source.etaNote || source.partsEtaNote || '').trim();
    if (atRaw) {
        const d = new Date(atRaw);
        if (!Number.isNaN(d.getTime())) {
            const datePart = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
            return note && note !== 'Custom ETA' ? `${note} · ${datePart} ${timePart}` : `${datePart} ${timePart}`;
        }
    }
    const dateOnly = String(source.etaDate || '').trim();
    if (dateOnly) return note ? `${note} · ${dateOnly}` : dateOnly;
    return note || '';
}

function deriveJobPartsEta(orders) {
    const open = (orders || []).filter((o) => o && o.status !== 'cancelled' && o.status !== 'arrived' && !o.arrivedAt);
    if (!open.length) {
        return { partsEtaAt: null, partsEtaNote: null, partsOrderedAt: null };
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
        partsEtaAt: earliest ? earliest.toISOString() : null,
        partsEtaNote: note || null,
        partsOrderedAt: orderedAt ? orderedAt.toISOString() : open[0]?.orderedAt || new Date().toISOString()
    };
}

function partsEtaDisplay(job) {
    const direct = formatPartsEtaDisplay(job);
    if (direct) return direct;
    return formatPartsEtaDisplay(deriveJobPartsEta(job?.partsOrders));
}

function enrichProcessForCustomer(process, job) {
    const base = { ...process };
    const eta = partsEtaDisplay(job);
    if (!eta) return base;
    if (process.key === 'work_parts' || process.key === 'work_prep') {
        base.description = `${process.description} Expected arrival: ${eta}.`;
    }
    if (process.key === 'materials_ordered') {
        base.description = `${process.description} Expected arrival: ${eta}.`;
    }
    if (process.key === 'pre_work_hold' && String(job?.status) === 'waiting_parts') {
        base.description = `Your repair is approved and we are waiting on parts. Expected arrival: ${eta}.`;
    }
    return base;
}

function optionalProcessApplies(process, job) {
    if (process.key === 'work_install' && isUpholsteryInstallSkipped(job)) return false;
    if (process.key === 'materials_ordered' || process.key === 'materials_received') {
        const status = materialsStatusOf(job);
        const allowed = Array.isArray(process.materialsStatuses) ? process.materialsStatuses : [];
        if (allowed.length) return allowed.includes(status);
        if (process.key === 'materials_ordered') return status === 'ordered' || status === 'needed';
        if (process.key === 'materials_received') return status === 'received' || status === 'partial';
        return false;
    }
    if (!process.skus?.length && !process.productIds?.length) {
        if (process.key === 'work_align') {
            const t = job?.alignmentType;
            if (t === 'none' || job?.alignmentSkipped) return false;
            if (t === '2wheel' || t === '4wheel') return true;
            return false;
        }
        if (process.key === 'work_install') return !isUpholsteryInstallSkipped(job);
        return true;
    }
    const skus = jobLineSkus(job);
    if (process.key === 'work_align') {
        const t = job?.alignmentType;
        if (t === 'none' || job?.alignmentSkipped) return false;
        if (t === '2wheel' || t === '4wheel') return true;
    }
    if (process.skus?.length && process.skus.some((s) => skus.includes(String(s).toUpperCase()))) {
        return true;
    }
    if (process.productIds?.length) {
        const ids = new Set(
            (job?.lines || []).map((l) => String(l.productId || l.id || '')).filter(Boolean)
        );
        if (process.productIds.some((id) => ids.has(String(id)))) return true;
    }
    return !(process.skus?.length || process.productIds?.length);
}

function insertProfileWorkSteps(processes, profiles) {
    let list = processes.slice();
    profiles.forEach((profile, i) => {
        if (list.some((p) => p.key === profile.workKey)) return;
        const step = normalizeProcess(defaultWorkStepForProfile(profile, 3 + i));
        const beforeIdx = list.findIndex(
            (p) =>
                p.key === 'work_qc' ||
                p.key === 'work_install' ||
                p.type === 'complete' ||
                p.type === 'payment'
        );
        if (beforeIdx < 0) list.push(step);
        else list.splice(beforeIdx, 0, step);
    });
    return list;
}

function insertExpressWorkSteps(processes, profiles) {
    return insertProfileWorkSteps(processes, profiles);
}

/**
 * Filter work steps to matched service profiles for body/upholstery.
 * Estimate/consultation path is always kept. Unmatched jobs use defaultWorkKeys.
 */
function resolveProfiledWorkProcesses(processes, job, profiles, opts = {}) {
    const defaultWorkKeys = new Set(opts.defaultWorkKeys || []);
    const alwaysKeepWorkKeys = new Set(opts.alwaysKeepWorkKeys || []);
    const profileWorkKeys = new Set(profiles.map((p) => p.workKey));
    const lines = Array.isArray(job?.lines) ? job.lines : [];
    // Without line items, keep the full vertical default (concern alone shouldn't drop paint/install siblings).
    const matched = lines.length ? matchedProfilesForList(job, profiles) : [];

    let filtered;
    if (!matched.length) {
        filtered = processes.filter((p) => {
            if (p.type !== 'work') return true;
            if (alwaysKeepWorkKeys.has(p.key)) return true;
            if (defaultWorkKeys.has(p.key)) return true;
            if (profileWorkKeys.has(p.key)) return false;
            return true;
        });
    } else {
        const matchedWorkKeys = new Set(matched.map((p) => p.workKey));
        filtered = processes.filter((p) => {
            if (p.type !== 'work') return true;
            if (alwaysKeepWorkKeys.has(p.key)) return true;
            if (matchedWorkKeys.has(p.key)) return true;
            if (profileWorkKeys.has(p.key) || defaultWorkKeys.has(p.key)) return false;
            return true;
        });
        filtered = insertProfileWorkSteps(filtered, matched);
    }

    // Body: keep detail whenever body or paint work is on the timeline (not glass/PDR-only).
    if (opts.ensureDetail) {
        const hasBodyOrPaint = filtered.some((p) => p.key === 'work_body' || p.key === 'work_paint');
        if (hasBodyOrPaint && !filtered.some((p) => p.key === 'work_detail')) {
            const detail = processes.find((p) => p.key === 'work_detail');
            if (detail) {
                const beforeIdx = filtered.findIndex((p) => p.type === 'complete' || p.type === 'payment');
                if (beforeIdx < 0) filtered.push(detail);
                else filtered.splice(beforeIdx, 0, detail);
            }
        } else if (!hasBodyOrPaint) {
            filtered = filtered.filter((p) => p.key !== 'work_detail');
        }
    }

    // Body insurance: show teardown findings once teardown is done (or findings already sent).
    if (opts.insuranceFindings) {
        const showFindings =
            jobHasInsurance(job) && (Boolean(job?.teardownDone) || Boolean(job?.teardownFindingsSentAt));
        if (!showFindings) {
            filtered = filtered.filter((p) => p.key !== 'teardown_findings');
        }
    } else {
        filtered = filtered.filter((p) => p.key !== 'teardown_findings');
    }

    return filtered
        .filter((p) => !p.optional || optionalProcessApplies(p, job))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

function resolveExpressProcesses(processes, job) {
    const matched = matchedExpressProfiles(job);
    const matchedWorkKeys = new Set(matched.map((p) => p.workKey));
    const matchedKinds = new Set(matched.map((p) => p.kind));
    matchedKinds.add('express');

    let filtered = processes.filter((p) => {
        if (REPAIR_ONLY_KEYS.includes(p.key)) return false;
        if (/parts|repair/i.test(String(p.label || '')) && p.type === 'work') return false;
        if (p.type === 'work') {
            if (p.key === 'work_qc') return true;
            if (matchedWorkKeys.has(p.key)) return true;
            const kinds = processServiceKinds(p);
            if (kinds.some((k) => matchedKinds.has(k))) return true;
            return false;
        }
        return true;
    });

    filtered = insertExpressWorkSteps(filtered, matched);
    return filtered.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

function resolveProcessesForJob(template, job) {
    const vertical = jobVertical(job);
    const all = (template?.processes || []).filter((p) => processAppliesToJob(p, job));

    if (vertical === 'body') {
        let list = resolveProfiledWorkProcesses(all, job, BODY_SERVICE_PROFILES, {
            defaultWorkKeys: ['work_body', 'work_paint', 'work_detail'],
            ensureDetail: true,
            insuranceFindings: true
        });
        if (isBodyInsurancePhasedJob(job) && !job?.teardownFindingsSentAt) {
            const phased = list.filter((p) =>
                ['waiting', 'inspection', 'teardown_findings'].includes(p.key)
            );
            if (phased.length) return phased;
        }
        return list;
    }
    if (vertical === 'upholstery') {
        return resolveProfiledWorkProcesses(all, job, UPHOLSTERY_SERVICE_PROFILES, {
            defaultWorkKeys: ['work_fabrication'],
            alwaysKeepWorkKeys: ['work_prep', 'work_install']
        });
    }

    if (vertical === 'auto') {
        if (isDiagnosticPhasedJob(job)) {
            const phased = all.filter((p) => DIAGNOSTIC_PHASE_KEYS.includes(p.key));
            return phased.length ? phased : all;
        }
        if (isExpressServiceJob(job)) {
            return resolveExpressProcesses(all, job);
        }
        // Repair tickets: hide express-only work steps.
        return all.filter((p) => {
            const kinds = processServiceKinds(p);
            if (!kinds.length || kinds.includes('*') || kinds.includes('repair') || kinds.includes('diagnostic')) {
                return true;
            }
            if (kinds.some((k) => EXPRESS_KIND_SET.has(k) || k === 'express')) return false;
            return true;
        });
    }

    return all;
}

function inferCurrentProcessKey(job, processes) {
    const cw = job?.customerWorkflow || {};
    if (cw.currentProcessKey && processes.some((p) => p.key === cw.currentProcessKey)) {
        return cw.currentProcessKey;
    }
    const status = String(job?.status || 'estimate');
    const approved = Boolean(job?.approved);
    const keys = processes.map((p) => p.key);
    const pick = (k) => (keys.includes(k) ? k : keys[0]);

    if (isDiagnosticPhasedJob(job)) {
        if (jobHasDiagnostics(job) && !job.diagDone) {
            return pick('inspection') || pick('waiting');
        }
        if (job.diagDone && !job.diagFindingsSentAt) {
            return pick('inspection') || pick('waiting');
        }
        if (job.diagFindingsSentAt && (!job.lines?.length || status === 'needs_estimate')) {
            return pick('diag_findings') || pick('decision');
        }
        if (status === 'estimate' && job.lines?.length && !approved) {
            return pick('decision');
        }
        if (job.diagFindingsSentAt) return pick('diag_findings') || pick('decision');
    }

    if (status === 'ready') return pick('payment') || pick('complete');
    if (status === 'in_progress') {
        const workKeys = processes.filter((p) => p.type === 'work').map((p) => p.key);
        if (isExpressServiceJob(job)) {
            const expressWork = workKeys.find((k) => k !== 'work_qc');
            if (expressWork) return expressWork;
        }
        if (job?.alignmentDone && keys.includes('work_align')) {
            const idx = workKeys.indexOf('work_align');
            if (idx >= 0 && idx < workKeys.length - 1) return workKeys[idx + 1];
        }
        return workKeys[0] || pick('work_repair') || pick('work_body') || pick('work_fabrication') || pick('work_mount');
    }
    if (status === 'waiting_parts') {
        const matStatus = materialsStatusOf(job);
        if (['ordered', 'needed', 'partial'].includes(matStatus) && keys.includes('materials_ordered')) {
            return pick('materials_ordered');
        }
        return pick('work_parts') || pick('work_prep') || pick('waiting');
    }
    if (status === 'waiting_parts' || approved) {
        if (isExpressServiceJob(job)) {
            const expressWork = processes.find((p) => p.type === 'work' && p.key !== 'work_qc');
            return expressWork?.key || pick('waiting');
        }
        return pick('decision') || pick('work_parts') || pick('work_body') || pick('work_fabrication');
    }
    if (status === 'estimate' && job?.lines?.length) {
        if (isExpressServiceJob(job)) {
            const expressWork = processes.find((p) => p.type === 'work' && p.key !== 'work_qc');
            return expressWork?.key || pick('waiting');
        }
        return pick('decision');
    }
    if (status === 'estimate') {
        if (isExpressServiceJob(job)) return pick('waiting');
        return pick('inspection');
    }
    return pick('waiting');
}

function lineStableId(line, index = 0) {
    if (line?.id != null && String(line.id).trim()) return String(line.id);
    if (line?.lineId != null && String(line.lineId).trim()) return String(line.lineId);
    if (line?.productId != null && String(line.productId).trim()) return String(line.productId);
    return String(index);
}

function estimateTaxRate(job, store = {}) {
    const fromJob = Number(job?.taxRate);
    if (Number.isFinite(fromJob) && fromJob >= 0) return fromJob;
    const fromStore = Number(store.taxRate ?? store.salesTaxRate);
    if (Number.isFinite(fromStore) && fromStore >= 0) return fromStore;
    return 0.08;
}

function customerEstimateTasks(job) {
    const lines = Array.isArray(job?.lines) ? job.lines : [];
    const workItemsById = new Map(
        (Array.isArray(job?.workItems) ? job.workItems : []).map((w) => [String(w.id), w])
    );
    const tasks = [];
    const indexByKey = new Map();
    lines.forEach((line, index) => {
        const lineId = lineStableId(line, index);
        const workItemId = line?.workItemId ? String(line.workItemId) : '';
        const key = workItemId || `line:${lineId}`;
        let task = indexByKey.get(key);
        if (!task) {
            let name = String(line?.name || line?.description || 'Item').trim();
            if (workItemId) {
                const rec = workItemsById.get(workItemId);
                name =
                    String(rec?.title || '').trim() ||
                    name.replace(/\s*[—–-]\s*(Labor|Materials)\s*$/i, '').trim() ||
                    'Task';
            }
            task = { id: workItemId || lineId, name, lineIds: [], amount: 0 };
            indexByKey.set(key, task);
            tasks.push(task);
        }
        if (!task.lineIds.includes(lineId)) task.lineIds.push(lineId);
        if (line?.customerDeclined === true || line?.priceLater) return;
        task.amount += Number(line?.price || 0) * Number(line?.qty || 1);
    });
    return tasks.map((task) => ({
        ...task,
        amount: Math.round(task.amount * 100) / 100
    }));
}

function estimateMoney(job, store = {}, opts = {}) {
    const lines = Array.isArray(job?.lines) ? job.lines : [];
    const selected =
        opts.selectedLineIds != null ? new Set([].concat(opts.selectedLineIds).map(String)) : null;
    let subtotal = 0;
    lines.forEach((line, index) => {
        const id = lineStableId(line, index);
        if (selected) {
            if (!selected.has(id)) return;
        } else if (line?.customerDeclined === true) {
            return;
        }
        if (line?.priceLater) return;
        subtotal += Number(line?.price || 0) * Number(line?.qty || 1);
    });
    subtotal = Math.round(subtotal * 100) / 100;
    const taxRate = estimateTaxRate(job, store);
    const tax = Math.round(subtotal * taxRate * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    return { subtotal, taxRate, tax, total };
}

function buildPortalPayload(job, template, store = {}) {
    const processes = resolveProcessesForJob(template, job);
    const currentKey = inferCurrentProcessKey(job, processes);
    const completed = new Set(job?.customerWorkflow?.completedKeys || []);
    processes.forEach((p) => {
        const idx = processes.findIndex((x) => x.key === currentKey);
        const pi = processes.findIndex((x) => x.key === p.key);
        if (pi >= 0 && idx >= 0 && pi < idx) completed.add(p.key);
    });
    if (String(job?.status) === 'ready') {
        completed.add('complete');
        processes.filter((p) => p.type === 'work' || p.type === 'complete').forEach((p) => completed.add(p.key));
    }
    const photos = Array.isArray(job?.photos) ? job.photos : [];
    const lines = (job?.lines || []).map((line, idx) => ({
        id: lineStableId(line, idx),
        name: line.name || line.description || 'Item',
        qty: Number(line.qty) || 1,
        price: Number(line.price) || 0,
        sku: line.sku || '',
        workItemId: line.workItemId || null,
        lineKind: line.lineKind || null,
        customerApproved: line.customerApproved !== false && line.customerDeclined !== true,
        customerDeclined: Boolean(line.customerDeclined)
    }));
    const jobForTasks = { ...job, lines, workItems: job?.workItems || [] };
    const tasks = customerEstimateTasks(jobForTasks);
    const money = estimateMoney(jobForTasks, store);
    return {
        job: {
            id: job.id,
            roNumber: job.roNumber,
            customerName: job.customerName,
            vehicle: job.vehicle,
            concern: job.concern,
            jobType: jobVertical(job),
            total: money.total,
            subtotal: money.subtotal,
            tax: money.tax,
            taxRate: money.taxRate,
            status: job.status,
            lines,
            workItems: Array.isArray(job?.workItems) ? job.workItems : [],
            estimateTasks: tasks,
            approved: Boolean(job.approved),
            customerWorkflow: job.customerWorkflow || {},
            diagFindings: String(job.diagFindings || '').trim(),
            diagFindingsSentAt: job.diagFindingsSentAt || null,
            teardownFindings: String(job.teardownFindings || '').trim(),
            repairWorkflowExpanded: Boolean(job.repairWorkflowExpanded),
            photos,
            expressDueAt: job.expressDueAt || null,
            partsEtaAt: job.partsEtaAt || null,
            partsEtaNote: job.partsEtaNote || null,
            partsEtaDisplay: partsEtaDisplay(job),
            partsOrderedAt: job.partsOrderedAt || null,
            deductibleOwed: Number(job.deductibleOwed ?? job.deductible) || 0,
            deductiblePaid: Number(job.deductiblePaid) || 0,
            deposit: Number(job.deposit) || 0,
            customerQuestion: job.customerQuestion || '',
            reviewRequestedAt: job.reviewRequestedAt || null,
            releasedAt: job.releasedAt || null
        },
        store: {
            name: store.storeName || store.name || 'Your shop',
            phone: store.phone || store.storePhone || '',
            paymentLinkEnabled: template?.paymentLinkEnabled !== false,
            reviewUrl: store.reviewUrl || ''
        },
        workflow: {
            vertical: jobVertical(job),
            serviceKind: inferJobServiceKind(job),
            currentProcessKey: currentKey,
            completedKeys: Array.from(completed),
            processes: processes.map((p) => {
                const enriched = enrichProcessForCustomer(p, job);
                return {
                    ...enriched,
                    state:
                        completed.has(p.key) ? 'done' : p.key === currentKey ? 'current' : 'upcoming',
                    customerCanAct: Boolean(p.customerCanAct) && p.key === currentKey
                };
            })
        }
    };
}

function createPortalToken(jobId) {
    const id = String(jobId || Date.now());
    return `trk-${id.replace(/[^a-zA-Z0-9_-]/g, '')}-${Math.random().toString(36).slice(2, 10)}`;
}

async function sendCustomerPortalLink(pool, { jobId, channel, phone, email, portalUrl }) {
    const ch = String(channel || 'link').toLowerCase();
    let job = null;
    if (jobId && pool) {
        const loaded = await shopJobs.getJob(pool, jobId);
        job = loaded.job;
    }
    const token = job?.portalToken;
    const url = portalUrl || (token ? await buildCustomerPortalUrl(pool, token) : '');
    const store = pool ? await loadPosStoreConfig(pool) : { storeName: 'Your shop' };
    const storeName = store.storeName || 'Your shop';
    const ro = job?.roNumber || 'your repair order';
    const targetEmail = String(email || job?.email || '').trim();
    const targetPhone = String(phone || job?.phone || '').trim();

    if (ch === 'email' && targetEmail) {
        if (!isSmtpConfigured()) {
            return {
                sent: false,
                channel: 'email',
                reason: 'smtp_not_configured',
                portalUrl: url,
                message: 'Store email is not configured. Copy the link and send it from your mail app.'
            };
        }
        const subject = `${storeName} — service update for ${ro}`;
        const text = `Hi${job?.customerName ? ` ${job.customerName}` : ''},\n\nTrack your service status here:\n${url}\n\n— ${storeName}`;
        const html = `<p>Hi${job?.customerName ? ` ${job.customerName}` : ''},</p><p>Track your service status here:</p><p><a href="${url}">${url}</a></p><p>— ${storeName}</p>`;
        await sendMail({ to: targetEmail, subject, text, html });
        return { sent: true, channel: 'email', portalUrl: url };
    }

    if (ch === 'sms' && targetPhone) {
        const body = `Track your service for ${ro}: ${url}`;
        const digits = targetPhone.replace(/\D/g, '');
        const smsUri = `sms:${digits}?&body=${encodeURIComponent(body)}`;
        return {
            sent: false,
            channel: 'sms',
            reason: 'use_device_sms',
            portalUrl: url,
            smsUri,
            message: 'Open your phone messaging app to send this link — no third-party SMS service required.'
        };
    }

    return { sent: true, channel: ch || 'link', portalUrl: url };
}

async function sendReviewRequest(pool, { jobId, channel, phone, email, reviewUrl }) {
    const settings = pool ? await require('./posShopSettings').loadPosShopSettings(pool) : {};
    const url = String(reviewUrl || settings.reviewUrl || '').trim();
    let job = null;
    if (jobId && pool) {
        const loaded = await shopJobs.getJob(pool, jobId);
        job = loaded.job;
    }
    if (!url) {
        return { sent: false, reason: 'no_review_url', message: 'Set a review URL in POS Shop settings.' };
    }
    const store = pool ? await loadPosStoreConfig(pool) : { storeName: 'Your shop' };
    const storeName = store.storeName || 'Your shop';
    const ch = String(channel || 'link').toLowerCase();
    const targetEmail = String(email || job?.email || '').trim();
    const targetPhone = String(phone || job?.phone || '').trim();

    if (job?.dbId || job?.id) {
        await shopJobs.updateJob(pool, job.dbId || job.id, {
            reviewRequestedAt: new Date().toISOString(),
            releasedAt: job.releasedAt || new Date().toISOString()
        });
    }

    if (ch === 'email' && targetEmail) {
        if (!isSmtpConfigured()) {
            return { sent: false, channel: 'email', reason: 'smtp_not_configured', reviewUrl: url };
        }
        await sendMail({
            to: targetEmail,
            subject: `${storeName} — how was your visit?`,
            text: `Thanks for choosing ${storeName}. Leave a review: ${url}`,
            html: `<p>Thanks for choosing ${storeName}.</p><p><a href="${url}">Leave a review</a></p>`
        });
        return { sent: true, channel: 'email', reviewUrl: url };
    }
    if (ch === 'sms' && targetPhone) {
        const digits = targetPhone.replace(/\D/g, '');
        return {
            sent: false,
            channel: 'sms',
            reason: 'use_device_sms',
            reviewUrl: url,
            smsUri: `sms:${digits}?&body=${encodeURIComponent(`Thanks from ${storeName}! Review us: ${url}`)}`
        };
    }
    return { sent: true, channel: 'link', reviewUrl: url };
}

async function createShopJobPaymentLink(pool, opts) {
    const payments = require('./shopJobPayments');
    return payments.createShopJobPaymentLink(pool, opts);
}

module.exports = {
    SETTING_CUSTOMER_WORKFLOWS,
    SETTING_PAYMENT_LINK_ENABLED,
    PROCESS_TYPES,
    DEFAULT_WORKFLOWS,
    EXPRESS_SERVICE_PROFILES,
    BODY_SERVICE_PROFILES,
    UPHOLSTERY_SERVICE_PROFILES,
    normalizeProcess,
    mergeVerticalWorkflow,
    loadCustomerWorkflowConfig,
    saveCustomerWorkflowConfig,
    resolveProcessesForJob,
    inferCurrentProcessKey,
    buildPortalPayload,
    customerEstimateTasks,
    estimateMoney,
    lineStableId,
    createPortalToken,
    sendCustomerPortalLink,
    sendReviewRequest,
    createShopJobPaymentLink,
    buildCustomerPortalUrl,
    jobHasDiagnostics,
    jobHasInsurance,
    expandRepairWorkflowPatch,
    isOilChangeJob,
    isExpressServiceJob,
    isBodyInsurancePhasedJob,
    isUpholsteryInstallSkipped,
    inferJobServiceKind,
    jobVertical,
    matchedExpressProfiles,
    matchedBodyProfiles,
    matchedUpholsteryProfiles,
    lineLooksLikeOilService
};
