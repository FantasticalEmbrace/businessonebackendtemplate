'use strict';

const { loadPosSettings } = require('./posSettings');
const { loadMerchantLicense, isLicenseWritable } = require('./posMerchantLicense');
const { buildRegisterHardwareProfile } = require('./posRegisterHardware');
const { buildTroubleshootStatusReport } = require('./posStoreTroubleshoot');

function slugId(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 48);
}

function sanitizeLocalChecks(localChecks) {
    return (Array.isArray(localChecks) ? localChecks : [])
        .filter((c) => c && c.id)
        .slice(0, 24)
        .map((c) => ({
            id: String(c.id).slice(0, 64),
            status: ['ok', 'warn', 'bad'].includes(c.status) ? c.status : 'warn',
            title: String(c.title || '').slice(0, 200),
            detail: String(c.detail || '').slice(0, 500),
            fix: String(c.fix || '').slice(0, 500)
        }));
}

function sanitizeSituation(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
        openedFrom: String(raw.openedFrom || '').slice(0, 64),
        screen: String(raw.screen || '').slice(0, 64),
        online: Boolean(raw.online),
        signedIn: Boolean(raw.signedIn),
        employeeName: raw.employeeName ? String(raw.employeeName).slice(0, 80) : null,
        shiftOpen: Boolean(raw.shiftOpen),
        cart: raw.cart
            ? {
                  lineCount: Number(raw.cart.lineCount) || 0,
                  total: raw.cart.total != null ? Number(raw.cart.total) : null
              }
            : null,
        pendingSalesToSync: raw.pendingSalesToSync != null ? Number(raw.pendingSalesToSync) : null,
        hardwareMode: String(raw.hardwareMode || '').slice(0, 32),
        hardwareDriver: raw.hardwareDriver ? String(raw.hardwareDriver).slice(0, 32) : null,
        cardCheckoutEnabled: Boolean(raw.cardCheckoutEnabled),
        paymentDriver: raw.paymentDriver ? String(raw.paymentDriver).slice(0, 64) : null,
        recentMessages: Array.isArray(raw.recentMessages)
            ? raw.recentMessages.map((m) => String(m).slice(0, 200)).slice(0, 8)
            : []
    };
}

function localCheckToAction(checkId) {
    const map = {
        setup: 'openSetup',
        server: 'reloadStore',
        'store-config': 'reloadStore',
        'catalog-api': 'refreshCatalog',
        'catalog-cache': 'refreshCatalog',
        'gift-cards': 'refreshCatalog',
        outbox: 'syncOutbox',
        employee: 'clearExpiredSession',
        'employee-api': 'clearExpiredSession',
        shift: 'refreshShift',
        hardware: 'reinitHardware',
        'payment-override': 'clearPaymentOverride',
        'service-worker': 'reloadApp',
        payments: 'reinitPayment',
        license: 'openBilling'
    };
    return map[checkId] || null;
}

async function buildRegisterTroubleshootReport(pool, deviceRecordId, options = {}) {
    const deviceId = Number(deviceRecordId);
    const deviceLabel = String(options.deviceLabel || 'This register').trim();
    const localChecks = sanitizeLocalChecks(options.localChecks);
    const situation = sanitizeSituation(options.situation);
    const posSettings = await loadPosSettings(pool);
    const hasDevice = Number.isInteger(deviceId) && deviceId > 0;
    const [license, hardware] = await Promise.all([
        loadMerchantLicense(pool),
        hasDevice
            ? buildRegisterHardwareProfile(pool, deviceId, {
                  globalPrinter: posSettings.pos_hardware_printer || 'auto',
                  globalCheckout: { poiDeviceId: posSettings.pos_poi_device_id || '' }
              })
            : Promise.resolve({ ready: false, issues: ['Register not linked on server — ask your manager to pair this device.'], runtime: {} })
    ]);

    const issues = [];
    const okItems = [];

    const summary = localChecks.find((c) => c.id === 'summary');
    for (const check of localChecks) {
        if (check.id === 'summary' || check.status === 'ok') {
            if (check.id !== 'summary' && check.status === 'ok') {
                okItems.push(check.title);
            }
            continue;
        }
        issues.push({
            id: `local_${check.id}`,
            severity: check.status === 'bad' ? 'error' : 'warning',
            category: 'register',
            label: check.title,
            detail: check.detail || check.fix || '',
            actionId: localCheckToAction(check.id),
            source: 'local'
        });
    }

    for (const issueText of hardware.issues || []) {
        issues.push({
            id: `server_hw_${slugId(issueText)}`,
            severity: issueText.toLowerCase().includes('no pos register') ? 'error' : 'warning',
            category: 'hardware',
            label: issueText,
            detail: 'Ask your manager to fix this under Admin → POS → Equipment for this register.',
            actionId: null,
            managerRequired: true,
            source: 'server'
        });
    }

    if (!hardware.issues?.length) {
        okItems.push('Equipment wiring on file looks complete');
    }

    const licenseGate = isLicenseWritable(license);
    if (!licenseGate.ok) {
        issues.push({
            id: 'server_license',
            severity: 'error',
            category: 'license',
            label: 'POS subscription needs attention',
            detail: licenseGate.message || 'Sales may not sync until billing is updated.',
            actionId: 'openBilling',
            source: 'server'
        });
    } else if (licenseGate.warningMessage) {
        issues.push({
            id: 'server_license_warn',
            severity: 'warning',
            category: 'license',
            label: 'Subscription warning',
            detail: licenseGate.warningMessage,
            actionId: 'openBilling',
            source: 'server'
        });
    } else {
        okItems.push(`Subscription active (${license.status})`);
    }

    const snapshot = {
        register: { id: deviceId, label: deviceLabel },
        localChecks,
        situation,
        hardwareProfile: {
            ready: hardware.ready,
            issues: hardware.issues || [],
            printerDriver: hardware.runtime?.printerDriver || '',
            cardTerminalConfigured: Boolean(hardware.runtime?.poiDeviceId)
        },
        license: {
            status: license.status,
            warningMessage: license.warningMessage || null
        },
        localSummary: summary
            ? { status: summary.status, title: summary.title, detail: summary.detail }
            : null,
        issues,
        okItems: [...new Set(okItems)],
        counts: {
            issues: issues.length,
            errors: issues.filter((i) => i.severity === 'error').length,
            warnings: issues.filter((i) => i.severity !== 'error').length,
            localChecks: localChecks.length
        }
    };

    snapshot.statusReport = buildTroubleshootStatusReport(snapshot);
    return snapshot;
}

module.exports = {
    buildRegisterTroubleshootReport,
    sanitizeLocalChecks
};
