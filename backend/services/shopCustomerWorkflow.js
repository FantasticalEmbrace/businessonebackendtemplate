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
                customerCanAct: false
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
                customerCanAct: false
            },
            {
                id: 'decision',
                key: 'decision',
                type: 'decision',
                label: 'Your decision',
                description: 'Review the estimate and approve recommended repairs.',
                sortOrder: 2,
                icon: 'clipboard-check',
                productIds: [],
                skus: [],
                customerCanAct: true
            },
            {
                id: 'work_parts',
                key: 'work_parts',
                type: 'work',
                label: 'Parts & preparation',
                description: 'We are sourcing or staging parts for your repair.',
                sortOrder: 3,
                icon: 'boxes',
                productIds: [],
                skus: [],
                customerCanAct: false
            },
            {
                id: 'work_repair',
                key: 'work_repair',
                type: 'work',
                label: 'Repair in progress',
                description: 'Your vehicle is in the bay and work is underway.',
                sortOrder: 4,
                icon: 'wrench',
                productIds: [],
                skus: ['LABOR-BRK', 'LABOR-OIL', 'LABOR-DIAG'],
                customerCanAct: false
            },
            {
                id: 'work_qc',
                key: 'work_qc',
                type: 'work',
                label: 'Quality check',
                description: 'Final inspection and road test before pickup.',
                sortOrder: 5,
                icon: 'check-double',
                productIds: [],
                skus: [],
                customerCanAct: false
            },
            {
                id: 'complete',
                key: 'complete',
                type: 'complete',
                label: 'Service complete',
                description: 'Your vehicle is ready for pickup.',
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
                description: 'Pay online or at the counter when you arrive.',
                sortOrder: 7,
                icon: 'credit-card',
                productIds: [],
                skus: [],
                customerCanAct: true
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
                customerCanAct: false
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
                customerCanAct: false
            },
            {
                id: 'decision',
                key: 'decision',
                type: 'decision',
                label: 'Estimate approval',
                description: 'Review the repair estimate and authorize work to begin.',
                sortOrder: 2,
                icon: 'clipboard-check',
                productIds: [],
                skus: [],
                customerCanAct: true
            },
            {
                id: 'work_body',
                key: 'work_body',
                type: 'work',
                label: 'Body repair',
                description: 'Structural and panel repair work is in progress.',
                sortOrder: 3,
                icon: 'hammer',
                productIds: [],
                skus: ['LABOR-BODY'],
                customerCanAct: false
            },
            {
                id: 'work_paint',
                key: 'work_paint',
                type: 'work',
                label: 'Paint & refinish',
                description: 'Paint prep, color match, and refinish in the booth.',
                sortOrder: 4,
                icon: 'spray-can',
                productIds: [],
                skus: ['LABOR-PAINT', 'PAINT-BASE', 'CLEAR'],
                customerCanAct: false
            },
            {
                id: 'complete',
                key: 'complete',
                type: 'complete',
                label: 'Ready for delivery',
                description: 'Repairs are complete and your vehicle is ready.',
                sortOrder: 5,
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
                description: 'Pay your deductible or balance online or at the counter.',
                sortOrder: 6,
                icon: 'credit-card',
                productIds: [],
                skus: [],
                customerCanAct: true
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
                customerCanAct: false
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
                customerCanAct: false
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
                customerCanAct: true
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
                skus: ['SEAT-RECOVER', 'HEADLINER', 'LEATHER-BLK', 'VINYL-TAN'],
                customerCanAct: false
            },
            {
                id: 'work_install',
                key: 'work_install',
                type: 'work',
                label: 'Installation',
                description: 'Finished work is being installed and quality checked.',
                sortOrder: 4,
                icon: 'couch',
                productIds: [],
                skus: [],
                customerCanAct: false
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
                customerCanAct: false
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
                customerCanAct: true
            }
        ]
    }
};

function cloneJson(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function normalizeProcess(p, index = 0) {
    const type = PROCESS_TYPES.includes(p?.type) ? p.type : 'work';
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
        optional: Boolean(p?.optional)
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

function processAppliesToJob(process, job) {
    if (!process.optional) return true;
    if (!process.skus?.length) return true;
    const skus = jobLineSkus(job);
    if (process.key === 'work_align') {
        const t = job?.alignmentType;
        if (t === 'none' || job?.alignmentSkipped) return false;
        if (t === '2wheel' || t === '4wheel') return true;
    }
    return process.skus.some((s) => skus.includes(String(s).toUpperCase()));
}

function resolveProcessesForJob(template, job) {
    return (template?.processes || []).filter((p) => processAppliesToJob(p, job));
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
    if (status === 'ready') return pick('payment') || pick('complete');
    if (status === 'in_progress') {
        const workKeys = processes.filter((p) => p.type === 'work').map((p) => p.key);
        if (job?.alignmentDone && keys.includes('work_align')) {
            const idx = workKeys.indexOf('work_align');
            if (idx >= 0 && idx < workKeys.length - 1) return workKeys[idx + 1];
        }
        return workKeys[0] || pick('work_repair') || pick('work_mount');
    }
    if (status === 'waiting_parts' || approved) return pick('decision') || pick('work_parts');
    if (status === 'estimate' && job?.lines?.length) return pick('decision');
    if (status === 'estimate') return pick('inspection');
    return pick('waiting');
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
    return {
        job: {
            id: job.id,
            roNumber: job.roNumber,
            customerName: job.customerName,
            vehicle: job.vehicle,
            concern: job.concern,
            total: job.total,
            status: job.status,
            lines: job.lines || [],
            approved: Boolean(job.approved),
            customerWorkflow: job.customerWorkflow || {}
        },
        store: {
            name: store.storeName || store.name || 'Your shop',
            phone: store.phone || store.storePhone || '',
            paymentLinkEnabled: template?.paymentLinkEnabled !== false
        },
        workflow: {
            vertical: job.jobType || job.mode,
            currentProcessKey: currentKey,
            completedKeys: Array.from(completed),
            processes: processes.map((p) => ({
                ...p,
                state:
                    completed.has(p.key) ? 'done' : p.key === currentKey ? 'current' : 'upcoming',
                customerCanAct: Boolean(p.customerCanAct) && p.key === currentKey
            }))
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

async function createShopJobPaymentLink(pool, opts) {
    const payments = require('./shopJobPayments');
    return payments.createShopJobPaymentLink(pool, opts);
}

module.exports = {
    SETTING_CUSTOMER_WORKFLOWS,
    SETTING_PAYMENT_LINK_ENABLED,
    PROCESS_TYPES,
    DEFAULT_WORKFLOWS,
    normalizeProcess,
    mergeVerticalWorkflow,
    loadCustomerWorkflowConfig,
    saveCustomerWorkflowConfig,
    resolveProcessesForJob,
    inferCurrentProcessKey,
    buildPortalPayload,
    createPortalToken,
    sendCustomerPortalLink,
    createShopJobPaymentLink,
    buildCustomerPortalUrl
};
